# Epsilon1

> A terminal that reads machines with undocumented protocols.

The board behind eFuelPro, pointed at any RS485 or Modbus machine. Generator, mill, chiller, weighbridge, loom — live readings into a ledger you can audit, on a terminal that keeps working when the network does not.

- **Price:** quoted per project after a call — er@epsilon-labs.co
- **What moves the price above that floor:** Whether your machine class is one we have decoded before. If it is Modbus or otherwise documented, this is fast. If it is undocumented, a Protocol Decode Sprint comes first.
- **Typical duration:** 2–6 weeks to first vertical
- **Category:** Platform
- **Page:** https://epsilon-labs.co/products/epsilon1/
- **Enquiries:** er@epsilon-labs.co

## The problem

Industrial machines are full of data that never leaves the machine. The console shows it, the operator writes it on a sheet, and by the time it reaches a spreadsheet it is a day old and has been through two people.

The blocker is almost never the cloud half. It is that the machine speaks a protocol nobody has written down.

## What you get

- Epsilon1 terminal — ESP32-S3, 4″ touch TFT, RS485, RFID, thermal printer, SD
- Self-calibrating decode engine, so each site configures itself
- Offline-first queue with idempotent event IDs
- Cloud ledger and dashboard, or an API into yours
- OTA configuration and firmware
- Board files, libraries and firmware source under OEM terms

## How it runs

- **Weeks 1–2** — Protocol work on your machine class, if it is one we have not met.
- **Weeks 3–4** — Vertical configuration — what a transaction means for your machine.
- **Weeks 5–6** — Pilot on one site, then a rollout plan that does not need us.

## This is for you if

- Flour mills, generators, cold storage, weighbridges, textile plant
- Anyone running a fleet of machines they cannot see in real time
- Integrators who want to build on a proven terminal rather than design one

## This is NOT for you if

- Machines with a supported, documented API already — use it
- Consumer or home automation
- Anything needing certified safety instrumentation

## Proof

eFuelPro is Epsilon1 pointed at a fuel dispenser. The board, the decode engine and the offline ledger are the same; only the vertical changes.

See: https://epsilon-labs.co/work/efuelpro/

## Questions

### Is this a dev kit?

No. It is a finished terminal with an enclosure, a screen and a ledger behind it. OEM terms exist if you want the board and the source to build your own.

### What if my machine uses Modbus?

Then it is documented and we can skip the decode work, which makes it faster and cheaper. The hard cases are the ones that are not Modbus but pretend to be.
