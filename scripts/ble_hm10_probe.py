"""Query an HM-10 module over its FFE1 UART characteristic."""

from __future__ import annotations

import argparse
import asyncio

from bleak import BleakClient, BleakScanner

UART_UUID = "0000ffe1-0000-1000-8000-00805f9b34fb"


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--name", default="OTTO")
    parser.add_argument("--scan-timeout", type=float, default=15)
    parser.add_argument("--wait-before-scan", type=float, default=0)
    parser.add_argument("--without-response", action="store_true")
    parser.add_argument(
        "commands",
        nargs="*",
        default=["AT", "AT+NAME?", "AT+BAUD?", "AT+ROLE?", "AT+RESET"],
    )
    args = parser.parse_args()

    if args.wait_before_scan > 0:
        print(f"WAIT {args.wait_before_scan:.1f}s before scanning", flush=True)
        await asyncio.sleep(args.wait_before_scan)
    device = await BleakScanner.find_device_by_name(
        args.name, timeout=args.scan_timeout
    )
    if device is None:
        print(f"NOT_FOUND {args.name}")
        return 2

    received: asyncio.Queue[bytes] = asyncio.Queue()

    def on_notify(_sender, data: bytearray) -> None:
        raw = bytes(data)
        if raw:
            received.put_nowait(raw)

    async with BleakClient(device, timeout=20) as client:
        for service in client.services:
            print(f"SERVICE {service.uuid} {service.description}")
            for char in service.characteristics:
                print(f"  CHAR {char.uuid} {char.properties}")
                if service.uuid.startswith("0000180a"):
                    try:
                        value = await client.read_gatt_char(char)
                        print(f"  VALUE {value.decode('utf-8', 'replace')!r}")
                    except Exception as exc:
                        print(f"  READ_ERROR {exc}")
        await client.start_notify(UART_UUID, on_notify)
        for command in args.commands:
            print(f"TX {command}")
            await client.write_gatt_char(
                UART_UUID,
                (command + "\r\n").encode("ascii"),
                response=not args.without_response,
            )
            await asyncio.sleep(0.8)
            while not received.empty():
                raw = received.get_nowait()
                safe = "".join(
                    chr(byte) if 32 <= byte <= 126 else f"\\x{byte:02x}"
                    for byte in raw
                )
                print(f"RX {raw.hex(' ')}  {safe}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
