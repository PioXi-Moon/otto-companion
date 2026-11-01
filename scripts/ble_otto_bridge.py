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
import sys
import threading
import time
from concurrent.futures import TimeoutError as FutureTimeoutError
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Callable

from bleak import BleakClient, BleakScanner
import serial
from serial.tools import list_ports

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

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
    # 开心是“先亮起来，再弹一下”，不是机械连摆。
    "happy": ["FACE HAPPY", "WAIT 140", "BOUNCE", "SWING", "FACE CALM"],
    "excited": ["FACE STAR", "MATRIX HEARTBEAT", "BOUNCE", "WIGGLE", "FACE HAPPY", "FACE CALM"],
    "laugh": ["FACE HAPPY", "WAIT 100", "BOUNCE", "SWING", "FACE SMILE", "FACE CALM"],
    "content": ["FACE SMILE", "WAIT 180", "SWING", "FACE CALM"],
    # 得意：弹一下、左右展示，再收住。
    "proud": ["FACE STAR", "WAIT 160", "BOUNCE", "WIGGLE", "FACE HAPPY", "FACE CALM"],
    # 害羞：缩下去、露出爱心，再恢复。
    "shy": ["FACE WINK", "WAIT 180", "SIT", "FACE HEART", "WAIT 220", "FACE CALM"],
    "surprise": ["FACE SURPRISE", "WAIT 120", "BOUNCE", "MATRIX SCAN", "FACE WINK"],
    "curious": ["FACE CALM", "MATRIX SCAN", "WAIT 120", "SWING", "FACE WINK"],
    "lean_in": ["FACE CALM", "SWING", "WAIT 180", "MATRIX SCAN", "FACE CALM"],
    "think": ["FACE CALM", "MATRIX SPIN", "SIT", "FACE CALM"],
    "think_hard": ["FACE SLEEP", "MATRIX SPIN", "SIT", "MATRIX SCAN", "FACE CALM"],
    "listening": ["FACE CALM", "WAIT 220", "FACE CALM"],
    "speaking": ["FACE TALKING", "MATRIX WAVE", "FACE CALM"],
    "confirm": ["FACE CALM", "BOUNCE", "WAIT 240", "FACE CALM"],
    "confused": ["FACE SURPRISE", "WIGGLE", "WAIT 140", "MATRIX SCAN", "FACE CALM"],
    "alert": ["FACE SURPRISE", "MATRIX WAVE", "BOUNCE", "FACE STAR"],
    "angry": ["FACE ANGRY", "STOMP", "WAIT 140", "STOMP", "FACE CALM"],
    "annoyed": ["FACE ANGRY", "STOMP", "WAIT 160", "FACE CALM"],
    # 赌气：停下来坐下，用姿态拉开距离。
    "sulk": ["FACE ANGRY", "WAIT 260", "SIT", "FACE CALM"],
    "wronged": ["FACE SLEEP", "SIT", "WAIT 280", "FACE CALM"],
    "sad": ["FACE SLEEP", "SIT", "FACE CALM"],
    "droop": ["FACE SLEEP", "SIT", "FACE CALM"],
    "lonely": ["FACE SLEEP", "SIT", "MATRIX HEARTBEAT", "FACE CALM"],
    "sleepy": ["FACE SLEEP", "SIT", "MATRIX STOP"],
    "doze": ["FACE SLEEP", "SIT"],
    "wake": ["FACE BLINK", "WAIT 100", "FACE CALM", "BOUNCE", "MATRIX SCAN"],
    "stretch": ["FACE SLEEP", "SWING", "WAIT 160", "SWING", "FACE CALM"],
    # 亲近：爱心、弹一下、摆动收尾。
    "nuzzle": ["FACE HEART", "WAIT 150", "SWING", "BOUNCE", "FACE HAPPY", "FACE CALM"],
    "approach": ["FACE HEART", "BOUNCE", "SWING", "FACE CALM"],
    "grateful": ["FACE HEART", "SWING", "BOUNCE", "FACE SMILE", "FACE CALM"],
    "relieved": ["FACE CALM", "SIT", "FACE SMILE", "FACE CALM"],
    "nervous": ["FACE SURPRISE", "SHAKE", "WAIT 120", "WIGGLE", "FACE CALM"],
    "guilty": ["FACE WINK", "WAIT 140", "SIT", "FACE SLEEP", "FACE CALM"],
    # 傲娇没有“扭头”自由度：用缩短摆动、赌气表情和重新亮起来表达。
    "tsundere": ["FACE WINK", "WIGGLE", "WAIT 300", "FACE ANGRY", "FACE HAPPY", "FACE CALM"],
    "mischievous": ["FACE WINK", "WIGGLE", "WAIT 100", "MATRIX WAVE", "FACE STAR"],
    "playful": ["FACE STAR", "BOUNCE", "WIGGLE", "FACE HAPPY", "FACE CALM"],
    "bored": ["FACE CALM", "MATRIX SCAN", "SHAKE", "SIT", "FACE CALM"],
    "impatient": ["FACE ANGRY", "STOMP", "WAIT 100", "STOMP", "FACE CALM"],
    "expect": ["FACE STAR", "BOUNCE", "WIGGLE", "MATRIX HEARTBEAT", "FACE HAPPY"],
    "celebrate": ["FACE STAR", "DANCE", "MATRIX WAVE", "WIGGLE", "HOME", "FACE HAPPY", "FACE CALM"],
    "done": ["FACE STAR", "SWING", "MATRIX HEARTBEAT", "FACE HAPPY", "FACE CALM"],
    "welcome": ["FACE HEART", "GREET", "BOUNCE", "FACE HAPPY"],
    "welcome_back": ["FACE HEART", "GREET", "SWING", "FACE HAPPY", "FACE CALM"],
    "nod": ["FACE CALM", "BOUNCE", "WAIT 120", "BOUNCE"],
    "shake_head": ["FACE CALM", "WIGGLE", "WAIT 100", "WIGGLE"],
    "look_around": ["FACE CALM", "MATRIX SCAN", "WIGGLE", "FACE WINK", "HOME"],
    "goodbye": ["FACE SMILE", "WAVE", "FACE CALM"],
    "turn_away": ["FACE ANGRY", "SIT", "WAIT 300", "FACE SLEEP"],
    "hide": ["FACE WINK", "SIT", "MATRIX STOP"],
    "shake": ["FACE SURPRISE", "SHAKE", "WAIT 100", "SHAKE", "FACE CALM"],
    "sit": ["FACE CALM", "SIT"],
    "lie_down": ["SIT", "FACE SLEEP"],
    "peek": ["FACE CALM", "WAIT 240", "FACE WINK", "FACE CALM"],
    "fidget": ["FACE CALM", "SHAKE", "WIGGLE", "FACE CALM"],
    "dance": ["FACE STAR", "DANCE", "WIGGLE", "DANCE", "FACE HAPPY", "HOME"],
    # 回访：先闹一下，再重新亮起来。
    "growth_callback": ["FACE WINK", "WIGGLE", "WAIT 260", "FACE HAPPY", "FACE CALM"],
    "bounce": ["FACE HAPPY", "BOUNCE", "FACE CALM"],
    "wiggle": ["FACE WINK", "WIGGLE", "WIGGLE", "FACE CALM"],
    "heart": ["FACE HEART", "SWING", "FACE CALM"],
    "star": ["FACE STAR", "BOUNCE", "FACE CALM"],
    "wink": ["FACE WINK", "WIGGLE", "FACE CALM"],
    "sleep": ["FACE SLEEP", "SIT"],
    "offline": ["FACE OFF", "MATRIX STOP", "SIT"],
})

# 固件动作本身是确定的时长。语音动作链按这个节拍推进，不把 HM-10 的
# 通知回执当成“动作是否继续”的唯一依据，避免一次漏报把整段动作卡死。
COMMAND_DURATION_MS = {
    "HOME": 1200,
    "SWING": 3200,
    "WAVE": 3360,
    "TWIST": 1800,
    "STOMP": 1040,
    "BOW": 1000,
    "SHAKE": 600,
    "SIT": 600,
    "DANCE": 3360,
    "HAPPY": 3200,
    "GREET": 3360,
    "WALK": 5390,
    "BACK": 5390,
    "LEFT": 5390,
    "RIGHT": 5390,
    "BOUNCE": 1280,
    "WIGGLE": 1400,
    "FACE": 60,
    "MATRIX": 80,
    "SFX": 60,
}
ACKED_TRAVEL_ACTIONS = {"WALK", "BACK", "LEFT", "RIGHT"}


def command_duration_ms(command: str) -> int:
    base = command.split(" ", 1)[0]
    return COMMAND_DURATION_MS.get(base, 80)


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


def wait_face_dwell(face_at: float, minimum: float = 0.42) -> None:
    """Keep a matrix expression visible before the next one replaces it."""
    if face_at <= 0:
        return
    remaining = minimum - (time.monotonic() - face_at)
    if remaining > 0:
        time.sleep(remaining)


class BleRobot:
    def __init__(self) -> None:
        self.transport = "ble"
        self.loop: asyncio.AbstractEventLoop | None = None
        self.client: BleakClient | None = None
        self.connected = threading.Event()
        self.voice_active = threading.Event()
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
                    if await self._link_handshake():
                        try:
                            await self._execute("SOUND OFF")
                            log("Firmware local sound actions disabled")
                        except Exception as exc:
                            log(f"Firmware sound-action setup skipped: {exc}")
                    else:
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
                if wait_ok:
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
                else:
                    await asyncio.sleep(COMMAND_DURATION_MS["HOME"] / 1000)
                self.armed = True
            await self._write(command)
            if not wait_ok:
                await asyncio.sleep(0.04)
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
        base = command.split(" ", 1)[0]
        if (
            base not in {"FACE", "VOICE"}
            and self.voice_active.is_set()
        ):
            self.wait_for_voice_idle(command)
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
        except RuntimeError as exc:
            if "acknowledgement timeout" in str(exc):
                self.reconnect()
            raise

    def reconnect(self) -> None:
        """Recover the HM-10 notification channel after a lost UART reply."""
        client = self.client
        if client is None or self.loop is None:
            return

        async def disconnect() -> None:
            try:
                await client.disconnect()
            except Exception as exc:
                log(f"BLE reconnect request failed: {exc}")

        log("BLE notification stalled; reconnecting")
        asyncio.run_coroutine_threadsafe(disconnect(), self.loop)

    def control(self, command: str, timeout: float = 3) -> dict:
        """Send state-only commands without depending on a UART reply."""
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
            self._execute(command, wait_ok=False), self.loop
        )
        try:
            return future.result(timeout=timeout)
        except FutureTimeoutError as exc:
            future.cancel()
            raise RuntimeError("BLE control timeout") from exc

    def play(self, commands: list[str]) -> None:
        # 动作组合必须整体串行，但不阻塞 HTTP 请求。否则一段 3–6 秒的动作
        # 会让语音工具超时，用户听到“没连上”，机器人其实已经走完了。
        with self._play_lock:
            face_at = 0.0
            for command in commands:
                if command.startswith("WAIT "):
                    time.sleep(max(0, int(command.split(" ", 1)[1])) / 1000)
                    continue
                if command.startswith("FACE "):
                    wait_face_dwell(face_at)
                elif not command.startswith("WAIT "):
                    self.wait_for_voice_idle(command)
                try:
                    travel = command.split(" ", 1)[0] in ACKED_TRAVEL_ACTIONS
                    if travel:
                        self.command(command)
                    else:
                        self.control(command)
                    if command.startswith("FACE "):
                        face_at = time.monotonic()
                    if not travel:
                        time.sleep(command_duration_ms(command) / 1000)
                except RuntimeError as exc:
                    if command.startswith("SFX ") and (
                        "SFX_NAME" in str(exc) or "SFX_DISABLED" in str(exc)
                    ):
                        log(f"optional sound skipped: {command} ({exc})")
                        continue
                    raise

    def wait_for_voice_idle(self, command: str, timeout: float = 45) -> None:
        """Do not let the firmware drop body motion during TTS playback."""
        if not self.voice_active.is_set():
            return
        log(f"VOICE_ACTIVE hold: {command}")
        deadline = time.monotonic() + timeout
        while self.voice_active.is_set():
            if time.monotonic() >= deadline:
                raise RuntimeError(f"VOICE_ACTIVE timeout before {command}")
            time.sleep(0.05)


class SerialRobot:
    """Same bridge interface, backed by the Nano's USB serial port."""

    def __init__(self, port_name: str | None = None) -> None:
        self.transport = "usb"
        self.port_name = port_name or self._find_port()
        if not self.port_name:
            raise RuntimeError("CH340 USB serial port not found")
        self.device_address = self.port_name
        self.connected = threading.Event()
        self.voice_active = threading.Event()
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
                if wait_ok:
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
                else:
                    time.sleep(COMMAND_DURATION_MS["HOME"] / 1000)
                self.armed = True

            self._write(command)
            if not wait_ok:
                time.sleep(0.04)
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
        base = command.split(" ", 1)[0]
        if (
            base not in {"FACE", "VOICE"}
            and self.voice_active.is_set()
        ):
            self.wait_for_voice_idle(command)
        try:
            return self._execute(command)
        except serial.SerialException as exc:
            self.connected.clear()
            self.last_error = str(exc)
            raise RuntimeError(f"Otto USB serial disconnected: {exc}") from exc

    def control(self, command: str, timeout: float = 3) -> dict:
        """Send state-only commands without depending on a UART reply."""
        command = command.strip().upper()
        if not command:
            raise ValueError("empty command")
        return self._execute(command, wait_ok=False)

    def play(self, commands: list[str]) -> None:
        with self._play_lock:
            face_at = 0.0
            for command in commands:
                if command.startswith("WAIT "):
                    time.sleep(max(0, int(command.split(" ", 1)[1])) / 1000)
                    continue
                if command.startswith("FACE "):
                    wait_face_dwell(face_at)
                elif not command.startswith("WAIT "):
                    self.wait_for_voice_idle(command)
                try:
                    travel = command.split(" ", 1)[0] in ACKED_TRAVEL_ACTIONS
                    if travel:
                        self.command(command)
                    else:
                        self.control(command)
                    if command.startswith("FACE "):
                        face_at = time.monotonic()
                    if not travel:
                        time.sleep(command_duration_ms(command) / 1000)
                except RuntimeError as exc:
                    if command.startswith("SFX ") and (
                        "SFX_NAME" in str(exc) or "SFX_DISABLED" in str(exc)
                    ):
                        log(f"optional sound skipped: {command} ({exc})")
                        continue
                    raise

    def wait_for_voice_idle(self, command: str, timeout: float = 45) -> None:
        """Do not let the firmware drop body motion during TTS playback."""
        if not self.voice_active.is_set():
            return
        log(f"VOICE_ACTIVE hold: {command}")
        deadline = time.monotonic() + timeout
        while self.voice_active.is_set():
            if time.monotonic() >= deadline:
                raise RuntimeError(f"VOICE_ACTIVE timeout before {command}")
            time.sleep(0.05)


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
            normalized = command.upper()
            try:
                result = (
                    self.robot.control(command)
                    if normalized in {"VOICE SPEAKING", "VOICE IDLE"}
                    else self.robot.command(command)
                )
            except Exception as exc:
                self._reply(503, {"ok": False, "error": str(exc)})
                return
            if normalized == "VOICE SPEAKING":
                self.robot.voice_active.set()
                # 固件收到 SPEAKING 会取消正在执行的肢体动作，并回到未归中状态。
                self.robot.armed = False
            elif normalized == "VOICE IDLE":
                self.robot.voice_active.clear()
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
