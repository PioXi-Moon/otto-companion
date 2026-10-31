"""HTTP to BLE bridge for the Otto Nano controller.

The XiaoZhi server talks to this bridge on port 7790. The bridge keeps a
single BLE connection to the HM-10 style serial characteristic and forwards
line-oriented Otto commands.
"""

from __future__ import annotations

import asyncio
import json
import os
import threading
import time
from concurrent.futures import TimeoutError as FutureTimeoutError
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Callable

from bleak import BleakClient, BleakScanner


BLE_NAME = os.getenv("OTTO_BLE_NAME", "OTTO")
BLE_UART = os.getenv(
    "OTTO_BLE_UART_UUID", "0000ffe1-0000-1000-8000-00805f9b34fb"
)
HTTP_HOST = os.getenv("OTTO_BLE_HTTP_HOST", "0.0.0.0")
HTTP_PORT = int(os.getenv("OTTO_BLE_HTTP_PORT", "7790"))

MOTION = {
    "HOME",
    "SWING",
    "WAVE",
    "TWIST",
    "STOMP",
    "BOW",
    "SHAKE",
    "SIT",
    "DANCE",
    "HAPPY",
    "GREET",
    "WALK",
    "BACK",
    "LEFT",
    "RIGHT",
    "BOUNCE",
    "WIGGLE",
}

ACTION_COMMANDS = {
    "immersed": ["FACE CALM"],
    "happy": ["FACE HAPPY", "SFX HAPPY"],
    "surprise": ["FACE SURPRISE", "SFX ALERT"],
    "sleepy": ["FACE SLEEP"],
    "doze": ["FACE SLEEP"],
    "wronged": ["FACE CALM", "SFX SAD"],
    "angry": ["FACE ANGRY", "STOMP"],
    "proud": ["FACE HAPPY", "WAVE"],
    "wave": ["FACE SMILE", "WAVE"],
    "welcome": ["GREET"],
    "welcome_back": ["GREET"],
    "peek": ["FACE WINK"],
    "shy": ["FACE WINK"],
    "celebrate": ["DANCE"],
    "sit": ["SIT"],
    "think": ["MATRIX SCAN"],
    "listening": ["FACE CALM"],
    "speaking": ["FACE TALKING"],
    "studying": ["MATRIX SPIN"],
    "done": ["FACE STAR", "SFX SUCCESS"],
    "confused": ["FACE SURPRISE", "SFX ERROR"],
    "stretch": ["BOW"],
    "fidget": ["SHAKE"],
    "tsundere": ["TWIST"],
    "nuzzle": ["FACE HAPPY"],
    "guilty": ["FACE SLEEP"],
    "sulk": ["FACE ANGRY"],
    "alert": ["FACE SURPRISE", "SFX ALERT"],
    "droop": ["FACE SLEEP"],
    "turn_away": ["TWIST"],
    "lie_down": ["SIT"],
    "shake": ["SHAKE"],
    "offline": ["FACE OFF"],
    "walk": ["WALK"],
    "back": ["BACK"],
    "left": ["LEFT"],
    "right": ["RIGHT"],
    "bounce": ["BOUNCE"],
    "wiggle": ["WIGGLE"],
    "heart": ["FACE HEART"],
    "star": ["FACE STAR"],
    "wink": ["FACE WINK"],
    "sleep": ["FACE SLEEP"],
}


# ---------------------------------------------------------------
# 动作 = 一串基础指令的组合，而不是单条 FACE。
#
# 固件里可用的原语：
#   FACE   CALM/BLINK/SMILE/TALKING/OFF/HAPPY/ANGRY/SLEEP/SURPRISE/HEART/STAR/WINK
#   MATRIX SCAN/WAVE/SPIN/HEARTBEAT/STOP
#   SFX    BOOT/HAPPY/SAD/ALERT/CLICK
#   动作   HOME/SWING/WAVE/TWIST/STOMP/BOW/SHAKE/SIT/DANCE/GREET/WALK/BACK/LEFT/RIGHT/BOUNCE/WIGGLE
#
# play() 是逐条等 ACK 的，所以写成一串就是"有先后、有停顿"的组合动作。
# 幅度上优先用 SWING(25°)/BOW(20°)/TWIST(15°)，重复两次比单次更像真的。
# 注意：固件没有 SUCCESS/ERROR 这两个音效，只能用 HAPPY/SAD/ALERT。
# ---------------------------------------------------------------
ACTION_COMMANDS.update({
    "idle": ["FACE CALM"],
    "immersed": ["FACE CALM", "MATRIX STOP"],
    "happy": ["FACE HAPPY", "SFX HAPPY", "SWING", "SWING", "FACE CALM"],
    "excited": ["FACE STAR", "MATRIX HEARTBEAT", "BOUNCE", "BOUNCE", "SWING", "FACE CALM"],
    "laugh": ["FACE HAPPY", "SHAKE", "SHAKE", "SWING", "FACE SMILE"],
    "content": ["FACE SMILE", "BOW", "FACE CALM"],
    "proud": ["FACE STAR", "WAVE", "TWIST", "SWING", "HOME"],
    "shy": ["FACE WINK", "TWIST", "BOW", "FACE CALM"],
    "surprise": ["FACE SURPRISE", "MATRIX SCAN", "BOUNCE", "SFX ALERT"],
    "curious": ["FACE CALM", "MATRIX SCAN", "WAVE", "FACE WINK"],
    "think": ["FACE CALM", "MATRIX SPIN", "SIT", "FACE CALM"],
    "think_hard": ["MATRIX SPIN", "FACE SLEEP", "SIT", "MATRIX SCAN"],
    "listening": ["FACE CALM", "BOW"],
    "speaking": ["FACE TALKING", "MATRIX WAVE"],
    "confused": ["FACE SURPRISE", "TWIST", "MATRIX SCAN", "SFX SAD"],
    "alert": ["FACE SURPRISE", "MATRIX WAVE", "SFX ALERT", "BOUNCE"],
    "angry": ["FACE ANGRY", "STOMP", "STOMP", "TWIST", "FACE ANGRY"],
    "annoyed": ["FACE ANGRY", "TWIST", "FACE CALM"],
    "sulk": ["FACE ANGRY", "TWIST", "SIT", "FACE SLEEP"],
    "wronged": ["FACE SLEEP", "BOW", "SFX SAD", "FACE CALM"],
    "sad": ["FACE SLEEP", "BOW", "SIT"],
    "droop": ["FACE SLEEP", "SIT", "BOW"],
    "lonely": ["FACE SLEEP", "SIT", "MATRIX HEARTBEAT"],
    "sleepy": ["FACE SLEEP", "SIT", "MATRIX STOP"],
    "doze": ["FACE SLEEP", "SIT"],
    "wake": ["FACE BLINK", "FACE CALM", "SWING", "MATRIX SCAN"],
    "stretch": ["BOW", "BOW", "SWING", "FACE CALM"],
    "nuzzle": ["FACE HEART", "SWING", "BOW", "FACE HAPPY"],
    "grateful": ["FACE HEART", "BOW", "BOW", "FACE SMILE"],
    "relieved": ["FACE CALM", "BOW", "SIT", "FACE SMILE"],
    "nervous": ["FACE SURPRISE", "SHAKE", "SHAKE", "FACE CALM"],
    "guilty": ["FACE SLEEP", "BOW", "TWIST"],
    "tsundere": ["FACE WINK", "TWIST", "FACE ANGRY", "FACE CALM"],
    "mischievous": ["FACE WINK", "WIGGLE", "WIGGLE", "MATRIX WAVE"],
    "playful": ["WIGGLE", "BOUNCE", "WIGGLE", "FACE HAPPY"],
    "bored": ["FACE CALM", "MATRIX SCAN", "SHAKE", "SIT"],
    "impatient": ["STOMP", "TWIST", "STOMP"],
    "expect": ["FACE STAR", "WAVE", "BOUNCE", "MATRIX HEARTBEAT"],
    "celebrate": ["FACE STAR", "MATRIX WAVE", "DANCE", "WIGGLE", "SFX HAPPY", "HOME"],
    "done": ["FACE STAR", "MATRIX HEARTBEAT", "SWING", "SFX HAPPY"],
    "welcome": ["GREET", "FACE HAPPY", "BOW"],
    "welcome_back": ["FACE HEART", "GREET", "SWING", "FACE HAPPY"],
    "nod": ["BOW", "BOW"],
    "shake_head": ["TWIST", "TWIST", "TWIST"],
    "look_around": ["MATRIX SCAN", "TWIST", "FACE CALM"],
    "goodbye": ["FACE SMILE", "WAVE", "BOW"],
    "turn_away": ["TWIST", "SIT", "FACE SLEEP"],
    "hide": ["FACE WINK", "SIT", "MATRIX STOP"],
    "shake": ["SHAKE", "SHAKE"],
    "sit": ["SIT"],
    "lie_down": ["SIT", "FACE SLEEP"],
    "peek": ["FACE WINK", "BOW", "MATRIX SCAN"],
    "fidget": ["SHAKE", "WIGGLE", "SHAKE"],
    "dance": ["DANCE", "WIGGLE", "DANCE", "HOME"],
    # 回访：先转开（嘴硬），再转回来（其实没走）
    "growth_callback": ["FACE WINK", "TWIST", "HOME", "FACE CALM"],
    "bounce": ["BOUNCE", "BOUNCE"],
    "wiggle": ["WIGGLE", "WIGGLE"],
    "sleep": ["FACE SLEEP", "SIT"],
    "offline": ["FACE OFF", "MATRIX STOP", "SIT"],
})


def log(message: str) -> None:
    print(f"{time.strftime('%H:%M:%S')} {message}", flush=True)


class BleRobot:
    def __init__(self) -> None:
        self.loop: asyncio.AbstractEventLoop | None = None
        self.client: BleakClient | None = None
        self.connected = threading.Event()
        self.ready = threading.Event()
        self.device_address: str | None = None
        self.last_error: str | None = None
        self.armed = False
        self._op_lock: asyncio.Lock | None = None
        self._notifications: asyncio.Queue[str] | None = None
        self._rx_buffer = ""
        threading.Thread(target=self._run, daemon=True, name="otto-ble").start()

    def _run(self) -> None:
        self.loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self.loop)
        self._op_lock = asyncio.Lock()
        self._notifications = asyncio.Queue()
        self.ready.set()
        try:
            self.loop.run_until_complete(self._connection_loop())
        finally:
            self.loop.close()

    async def _connection_loop(self) -> None:
        while True:
            try:
                device = await BleakScanner.find_device_by_name(BLE_NAME, timeout=12)
                if device is None:
                    raise RuntimeError(f"BLE device {BLE_NAME!r} not found")
                self.device_address = device.address
                client = BleakClient(device, timeout=20)
                async with client:
                    self.client = client
                    self.armed = False
                    self._rx_buffer = ""
                    await client.start_notify(BLE_UART, self._on_notification)
                    self.connected.set()
                    self.last_error = None
                    log(f"BLE connected: {device.address}")
                    while client.is_connected:
                        await asyncio.sleep(1)
            except Exception as exc:
                self.last_error = f"{type(exc).__name__}: {exc}"
                log(f"BLE disconnected: {self.last_error}")
            finally:
                self.connected.clear()
                self.client = None
                self.armed = False
            await asyncio.sleep(2)

    def _on_notification(self, _sender, data: bytearray) -> None:
        if self.loop is None or self._notifications is None:
            return
        text = bytes(data).decode("utf-8", "replace")

        def enqueue() -> None:
            self._rx_buffer += text
            while "\n" in self._rx_buffer:
                line, self._rx_buffer = self._rx_buffer.split("\n", 1)
                line = line.strip("\r")
                if line:
                    if line.startswith("READY"):
                        self.armed = False
                    elif line.startswith("OK HOME"):
                        self.armed = True
                    log(f"BLE RX: {line}")
                    self._notifications.put_nowait(line)

        self.loop.call_soon_threadsafe(enqueue)

    async def _read_until(
        self, predicate: Callable[[str], bool], timeout: float
    ) -> str | None:
        if self._notifications is None:
            return None
        deadline = asyncio.get_running_loop().time() + timeout
        while True:
            remaining = deadline - asyncio.get_running_loop().time()
            if remaining <= 0:
                return None
            try:
                line = await asyncio.wait_for(
                    self._notifications.get(), timeout=remaining
                )
            except asyncio.TimeoutError:
                return None
            if predicate(line):
                return line
            if line.startswith("READY"):
                self.armed = False

    async def _execute(self, command: str, wait_ok: bool = True) -> dict:
        if self._op_lock is None:
            raise RuntimeError("BLE worker is not ready")
        async with self._op_lock:
            client = self.client
            if client is None or not client.is_connected:
                raise RuntimeError("Otto BLE is offline")
            base = command.split(" ", 1)[0]
            if base in MOTION and base not in {"HOME"} and not self.armed:
                await self._write("HOME")
                home = await self._read_until(
                    lambda line: line.startswith("OK HOME") or line.startswith("ERR "),
                    12,
                )
                if home is None or not home.startswith("OK HOME"):
                    raise RuntimeError(home or "HOME acknowledgement timeout")
            await self._write(command)
            if not wait_ok:
                return {"ok": True, "command": command, "ack": None}
            timeout = 14 if base in MOTION else 3
            ack = await self._read_until(
                lambda line: line.startswith(f"OK {base}")
                or line.startswith("ERR "),
                timeout,
            )
            if ack is None:
                raise RuntimeError(f"acknowledgement timeout: {command}")
            if ack.startswith("ERR "):
                raise RuntimeError(ack)
            if base in {"STOP", "REST"}:
                self.armed = False
            return {"ok": True, "command": command, "ack": ack}

    async def _write(self, command: str) -> None:
        client = self.client
        if client is None or not client.is_connected:
            raise RuntimeError("Otto BLE is offline")
        payload = (command.rstrip() + "\n").encode("utf-8")
        await client.write_gatt_char(BLE_UART, payload, response=True)
        log(f"BLE TX: {command}")

    def command(self, command: str, timeout: float = 20) -> dict:
        command = command.strip().upper()
        if not command:
            raise ValueError("empty command")
        if not self.ready.wait(10):
            raise RuntimeError("BLE worker did not initialize")
        if not self.connected.wait(12):
            raise RuntimeError(self.last_error or "Otto BLE is offline")
        if self.loop is None:
            raise RuntimeError("BLE worker is not running")
        future = asyncio.run_coroutine_threadsafe(
            self._execute(command), self.loop
        )
        try:
            return future.result(timeout=timeout)
        except FutureTimeoutError as exc:
            future.cancel()
            raise RuntimeError("BLE command timeout") from exc

    def play(self, commands: list[str]) -> None:
        for command in commands:
            self.command(command)


class OttoHandler(BaseHTTPRequestHandler):
    robot: BleRobot

    def _reply(self, code: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path == "/health":
            self._reply(
                200,
                {
                    "ok": self.robot.connected.is_set(),
                    "transport": "ble",
                    "device": self.robot.device_address,
                    "connected": self.robot.connected.is_set(),
                    "armed": self.robot.armed,
                    "error": self.robot.last_error,
                },
            )
            return
        self._reply(404, {"error": "not found"})

    def do_POST(self) -> None:
        try:
            length = int(self.headers.get("content-length", 0))
            body = json.loads(self.rfile.read(length) or b"{}")
        except Exception:
            self._reply(400, {"error": "bad json"})
            return

        if self.path == "/cmd":
            command = str(body.get("command", "")).strip()
            if not command:
                self._reply(400, {"error": "empty command"})
                return
            try:
                result = self.robot.command(command)
            except Exception as exc:
                self._reply(503, {"ok": False, "error": str(exc)})
                return
            self._reply(200, result)
            return

        if self.path == "/otto":
            action = str(body.get("action", "")).strip()
            commands = ACTION_COMMANDS.get(action)
            if not commands:
                self._reply(404, {"error": "unknown action", "action": action})
                return
            try:
                self.robot.play(commands)
            except Exception as exc:
                self._reply(503, {"ok": False, "error": str(exc)})
                return
            self._reply(200, {"ok": True, "action": action})
            return

        self._reply(404, {"error": "not found"})

    def log_message(self, *_args) -> None:
        pass


def main() -> None:
    robot = BleRobot()
    OttoHandler.robot = robot
    server = ThreadingHTTPServer((HTTP_HOST, HTTP_PORT), OttoHandler)
    log(f"HTTP listening on {HTTP_HOST}:{HTTP_PORT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
