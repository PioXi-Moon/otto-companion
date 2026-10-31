"""Drive a low-amplitude Otto gait directly over the Nano USB serial port.

This is a bench tool for finding a gait that moves without brownout resetting
the Nano. It does not touch the app database or the BLE bridge.
"""

from __future__ import annotations

import argparse
import math
import time

import serial


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", default="COM5")
    parser.add_argument("--hip", type=float, default=24)
    parser.add_argument("--foot", type=float, default=16)
    parser.add_argument("--delay-ms", type=int, default=100)
    parser.add_argument("--cycles", type=int, default=1)
    parser.add_argument("--direction", choices=("forward", "back"), default="forward")
    args = parser.parse_args()

    with serial.Serial(args.port, 115200, timeout=0.2) as port:
        port.dtr = True
        port.rts = True
        time.sleep(2.5)
        port.reset_input_buffer()
        port.write(b"HOME\n")
        time.sleep(0.9)
        port.reset_input_buffer()

        try:
            for cycle in range(args.cycles):
                for frame in range(16):
                    phase = 2 * math.pi * frame / 16
                    hip = round(args.hip * math.sin(phase))
                    direction = -1 if args.direction == "back" else 1
                    foot_phase = phase + direction * (-math.pi / 2)
                    foot_l = round(4 + args.foot * math.sin(foot_phase))
                    foot_r = round(-4 + args.foot * math.sin(foot_phase))
                    angles = (
                        90 + hip,
                        90 + hip,
                        90 + foot_l,
                        90 + foot_r,
                    )
                    for index, angle in enumerate(angles):
                        port.write(f"SERVO {index} {angle}\n".encode("ascii"))
                        time.sleep(args.delay_ms / 1000)
            port.write(b"HOME\n")
            time.sleep(0.9)
        except serial.SerialException as exc:
            print(
                f"PORT_CLOSED at cycle={cycle} frame={frame}: {exc}",
                flush=True,
            )
            return 2

    print(
        f"GAIT_OK hip={args.hip} foot={args.foot} "
        f"delay={args.delay_ms}ms cycles={args.cycles} direction={args.direction}",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
