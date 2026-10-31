"""Query an HM-10 module over its FFE1 UART characteristic."""

from __future__ import annotations

import argparse
import asyncio

from bleak import BleakClient, BleakScanner

UART_UUID = "0000ffe1-0000-1000-8000-00805f9b34fb"


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--name", default="OTTO")
    parser.add_argument(
        "commands",
        nargs="*",
        default=["AT", "AT+NAME?", "AT+BAUD?", "AT+ROLE?", "AT+RESET"],
    )
    args = parser.parse_args()

    device = await BleakScanner.find_device_by_name(args.name, timeout=15)
    if device is None:
        print(f"NOT_FOUND {args.name}")
        return 2

    received: asyncio.Queue[str] = asyncio.Queue()

    def on_notify(_sender, data: bytearray) -> None:
        text = bytes(data).decode("utf-8", "replace").strip()
        if text:
            received.put_nowait(text)

    async with BleakClient(device, timeout=20) as client:
        await client.start_notify(UART_UUID, on_notify)
        for command in args.commands:
            print(f"TX {command}")
            await client.write_gatt_char(
                UART_UUID,
                (command + "\r\n").encode("ascii"),
                response=True,
            )
            await asyncio.sleep(0.8)
            while not received.empty():
                print(f"RX {received.get_nowait()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
