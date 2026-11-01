"""HTTP to BLE bridge for the Otto Nano controller.

The XiaoZhi server talks to this bridge on port 7790. The bridge keeps a
single BLE connection to the HM-10 style serial characteristic and forwards
line-oriented Otto commands.
"""

from __future__ import annotations

import asyncio
import json
import math
import os
import threading
import time
from concurrent.futures import TimeoutError as FutureTimeoutError
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Callable

from bleak import BleakClient, BleakScanner
import serial
from serial.tools import list_ports


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


def build_gait(action: str, cycles: int = 1) -> list[str]:
    """用固件公开的 SERVO 指令发一遍 OttoDIY 的 16 帧步态。

    旧固件里的 WALK 数组幅度被压得太小，只会原地晃。这里按官方振荡器参数
    重新采样，桥发完一帧等一小会儿，再发下一帧，不改固件也能先恢复真实位移。
    """
    direction = -1 if action == "back" else 1
    hip_amp = [24, 24]
    foot_amp = [16, 16]
    if action == "left":
        hip_amp = [24, 8]
    elif action == "right":
        hip_amp = [8, 24]
    elif action not in {"walk", "back"}:
        return []

    commands: list[str] = ["HOME"]
    for _ in range(cycles):
        for frame in range(16):
            phase = 2 * math.pi * frame / 16
            hip_l = round(hip_amp[0] * math.sin(phase))
            hip_r = round(hip_amp[1] * math.sin(phase))
            foot_phase = phase + direction * (-math.pi / 2)
            foot_l = round(4 + foot_amp[0] * math.sin(foot_phase))
            foot_r = round(-4 + foot_amp[1] * math.sin(foot_phase))
            for index, angle in enumerate((hip_l, hip_r, foot_l, foot_r)):
                commands.append(f"SERVO {index} {max(60, min(120, 90 + angle))}")
                # Waiting after every servo keeps the current peak below the
                # Nano reset threshold on USB power and on a fresh battery.
                commands.append("WAIT 100")
    commands.append("HOME")
    return commands


def commands_for_action(action: str) -> list[str]:
    # Walking is generated by the firmware's synchronized interpolation loop.
    # Sending four SERVO commands from Python produces visibly jerky motion.
    return ACTION_COMMANDS.get(action, [])


def log(message: str) -> None:
    print(f"{time.strftime('%H:%M:%S')} {message}", flush=True)


class BleRobot:
    def __init__(self) -> None:
        self.transport = "ble"
        self.loop: asyncio.AbstractEventLoop | None = None
        self.client: BleakClient | None = None
        self.connected = threading.Event()
        self.ready = threading.Event()
        self.device_address: str | None = None
        self.last_error: str | None = None
        self.armed = False
        self._op_lock: asyncio.Lock | None = None
        self._play_lock = threading.Lock()
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
                    if not await self._link_handshake():
                        log("BLE warning: UART handshake did not return PONG")
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

    async def _link_handshake(self) -> bool:
        """Nano 会在常见波特率间轮换，持续 PING 直到收到 PONG。"""
        if self._op_lock is None:
            return False
        async with self._op_lock:
            for _ in range(36):
                await self._write("PING")
                ack = await self._read_until(
                    lambda line: line.startswith("PONG")
                    or line.startswith("READY"),
                    0.45,
                )
                if ack and ack.startswith("PONG"):
                    log("BLE UART handshake: PONG")
                    return True
                await asyncio.sleep(0.2)
        return False

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
                    lambda line: line.startswith("OK HOME")
                    or line.startswith("ERR ")
                    or line.startswith("READY"),
                    12,
                )
                if home is not None and home.startswith("READY"):
                    raise RuntimeError("firmware rebooted before motion")
                if home is None or not home.startswith("OK HOME"):
                    raise RuntimeError(home or "HOME acknowledgement timeout")
            await self._write(command)
            if not wait_ok:
                return {"ok": True, "command": command, "ack": None}
            timeout = 14 if base in MOTION else 3
            if base == "PING":
                ack = await self._read_until(
                    lambda line: line.startswith("PONG")
                    or line.startswith("ERR ")
                    or line.startswith("READY"),
                    timeout,
                )
            else:
                ack = await self._read_until(
                    lambda line: line.startswith(f"OK {base}")
                    or line.startswith("ERR ")
                    or line.startswith("READY"),
                    timeout,
                )
            if ack is None:
                raise RuntimeError(f"acknowledgement timeout: {command}")
            if ack.startswith("READY"):
                raise RuntimeError(f"firmware rebooted during {command}")
            if ack.startswith("ERR "):
                raise RuntimeError(ack)
            if base in {"STOP", "REST"}:
                self.armed = False
            self.last_error = None
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
        # 动作组合必须整体串行，但不阻塞 HTTP 请求。否则一段 3–6 秒的动作
        # 会让语音工具超时，用户听到“没连上”，机器人其实已经走完了。
        with self._play_lock:
            for command in commands:
                if command.startswith("WAIT "):
                    time.sleep(max(0, int(command.split(" ", 1)[1])) / 1000)
                    continue
                try:
                    self.command(command)
                except RuntimeError as exc:
                    if command.startswith("SFX ") and (
                        "SFX_NAME" in str(exc) or "SFX_DISABLED" in str(exc)
                    ):
                        log(f"optional sound skipped: {command} ({exc})")
                        continue
                    raise


class SerialRobot:
    """Same bridge interface, backed by the Nano's USB serial port."""

    def __init__(self, port_name: str | None = None) -> None:
        self.transport = "usb"
        self.port_name = port_name or self._find_port()
        if not self.port_name:
            raise RuntimeError("CH340 USB serial port not found")
        self.device_address = self.port_name
        self.connected = threading.Event()
        self.ready = threading.Event()
        self.last_error: str | None = None
        self.armed = False
        self._port: serial.Serial | None = None
        self.baud = 115200
        self._op_lock = threading.Lock()
        self._play_lock = threading.Lock()
        self._open()
        self.ready.set()

    @staticmethod
    def _find_port() -> str | None:
        candidates = []
        for item in list_ports.comports():
            desc = f"{item.description or ''} {item.product or ''}".upper()
            if item.vid == 0x1A86 and item.pid == 0x7523:
                candidates.append(item.device)
            elif "CH340" in desc:
                candidates.append(item.device)
        return candidates[0] if candidates else None

    def _open(self) -> None:
        try:
            port = serial.Serial(self.port_name, self.baud, timeout=0.1)
            port.dtr = True
            port.rts = True
            time.sleep(1.5)
            port.reset_input_buffer()
            self._port = port
            self._handshake()
            self.connected.set()
            self.last_error = None
            log(f"SERIAL connected: {self.port_name}")
        except Exception as exc:
            self._port = None
            self.connected.clear()
            self.last_error = f"{type(exc).__name__}: {exc}"
            log(f"SERIAL disconnected: {self.last_error}")

    def _handshake(self) -> None:
        """Match the Nano's temporary baud scan before normal traffic."""
        if self._port is None:
            return
        candidates = (115200, 9600, 57600, 38400, 19200)
        deadline = time.monotonic() + 24
        while time.monotonic() < deadline:
            for baud in candidates:
                try:
                    self._port.baudrate = baud
                    self._port.reset_input_buffer()
                    for _ in range(3):
                        self._port.write(b"PING\n")
                        self._port.flush()
                        reply_deadline = time.monotonic() + 0.4
                        while time.monotonic() < reply_deadline:
                            line = (
                                self._port.readline()
                                .decode("utf-8", "replace")
                                .strip()
                            )
                            if line == "PONG":
                                self.baud = baud
                                log(f"SERIAL handshake: PONG at {baud}")
                                return
                except serial.SerialException:
                    return

    def _ensure_open(self) -> serial.Serial:
        if self._port is not None and self._port.is_open:
            return self._port
        self._open()
        if self._port is None:
            raise RuntimeError(self.last_error or "Otto USB serial is offline")
        return self._port

    def _write(self, command: str) -> None:
        port = self._ensure_open()
        port.write((command.rstrip() + "\n").encode("utf-8"))
        port.flush()
        log(f"SERIAL TX: {command}")

    def _read_until(
        self, predicate: Callable[[str], bool], timeout: float
    ) -> str | None:
        port = self._ensure_open()
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            line = port.readline().decode("utf-8", "replace").strip()
            if not line:
                continue
            if line.startswith("READY"):
                self.armed = False
            elif line.startswith("OK HOME"):
                self.armed = True
            log(f"SERIAL RX: {line}")
            if predicate(line):
                return line
        return None

    def _execute(self, command: str, wait_ok: bool = True) -> dict:
        with self._op_lock:
            base = command.split(" ", 1)[0]
            if base in MOTION and base != "HOME" and not self.armed:
                self._write("HOME")
                home = self._read_until(
                    lambda line: line.startswith("OK HOME")
                    or line.startswith("ERR ")
                    or line.startswith("READY"),
                    12,
                )
                if home is None:
                    raise RuntimeError("HOME acknowledgement timeout")
                if home.startswith("READY"):
                    raise RuntimeError("firmware rebooted before motion")
                if home.startswith("ERR "):
                    raise RuntimeError(home)

            self._write(command)
            if not wait_ok:
                return {"ok": True, "command": command, "ack": None}
            timeout = 14 if base in MOTION else 3
            if base == "PING":
                ack = self._read_until(
                    lambda line: line.startswith("PONG")
                    or line.startswith("ERR ")
                    or line.startswith("READY"),
                    timeout,
                )
            else:
                ack = self._read_until(
                    lambda line: line.startswith(f"OK {base}")
                    or line.startswith("ERR ")
                    or line.startswith("READY"),
                    timeout,
                )
            if ack is None:
                raise RuntimeError(f"acknowledgement timeout: {command}")
            if ack.startswith("READY"):
                raise RuntimeError(f"firmware rebooted during {command}")
            if ack.startswith("ERR "):
                raise RuntimeError(ack)
            self.last_error = None
            return {"ok": True, "command": command, "ack": ack}

    def command(self, command: str, timeout: float = 20) -> dict:
        command = command.strip().upper()
        if not command:
            raise ValueError("empty command")
        try:
            return self._execute(command)
        except serial.SerialException as exc:
            self.connected.clear()
            self.last_error = str(exc)
            raise RuntimeError(f"Otto USB serial disconnected: {exc}") from exc

    def play(self, commands: list[str]) -> None:
        with self._play_lock:
            for command in commands:
                if command.startswith("WAIT "):
                    time.sleep(max(0, int(command.split(" ", 1)[1])) / 1000)
                    continue
                try:
                    self.command(command)
                except RuntimeError as exc:
                    if command.startswith("SFX ") and (
                        "SFX_NAME" in str(exc) or "SFX_DISABLED" in str(exc)
                    ):
                        log(f"optional sound skipped: {command} ({exc})")
                        continue
                    raise


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
                    "transport": self.robot.transport,
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
            commands = commands_for_action(action)
            if not commands:
                self._reply(404, {"error": "unknown action", "action": action})
                return

            def run_action() -> None:
                try:
                    self.robot.play(commands)
                    log(f"ACTION complete: {action}")
                except Exception as exc:
                    self.robot.last_error = str(exc)
                    log(f"ACTION failed: {action}: {exc}")

            threading.Thread(
                target=run_action,
                daemon=True,
                name=f"otto-action-{action}",
            ).start()
            self._reply(202, {"ok": True, "accepted": True, "action": action})
            return

        self._reply(404, {"error": "not found"})

    def log_message(self, *_args) -> None:
        pass


def main() -> None:
    requested_port = os.getenv("OTTO_SERIAL_PORT", "").strip()
    force_ble = os.getenv("OTTO_BRIDGE_TRANSPORT", "auto").strip().lower() == "ble"
    serial_port = None if force_ble else (requested_port or SerialRobot._find_port())
    robot = SerialRobot(serial_port) if serial_port else BleRobot()
    OttoHandler.robot = robot
    server = ThreadingHTTPServer((HTTP_HOST, HTTP_PORT), OttoHandler)
    log(f"HTTP listening on {HTTP_HOST}:{HTTP_PORT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
