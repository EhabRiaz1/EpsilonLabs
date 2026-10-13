# Hardware Rescue

> Your product half-works. We get it to a board and firmware you can ship.

For a hardware product stuck between prototype and production: we take over the firmware nobody can maintain, fix the faults that show up in the field, review and respin the board, and hand back a build you can manufacture and update.

- **Price:** quoted per project after a call — er@epsilon-labs.co
- **What moves the price above that floor:** How much of the original firmware build survives, how reproducible the field failures are, and the layer and part count of the board. A two-layer sensor board with a buildable codebase sits near the floor.
- **Typical duration:** 8 weeks
- **Category:** Engagements
- **Page:** https://epsilon-labs.co/services/hardware-rescue/
- **Enquiries:** er@epsilon-labs.co

## The problem

Units lock up in the field, the developer who wrote the firmware has left, and the next production run is waiting on a board revision nobody has finished.

Fixing firmware on a board with a design fault, or respinning a board for firmware that is still broken, wastes both.

## What you get

- Paid assessment: the failure reproduced and its cause chain written down
- A reproducible firmware build that runs on more than one machine
- Fault detection, watchdogs and automatic recovery for the failures you see
- Pre-fab design review of the board with a ranked findings list
- One board respin taken to fabrication-ready files
- An update path, so the next fix does not need a site visit

## How it runs

- **Weeks 1–2** — Assessment and board review. You get both documents whether or not you continue.
- **Weeks 3–6** — Firmware fixes and the respin, in parallel, tested together.
- **Weeks 7–8** — Fabrication files, update path, handover.

## This is for you if

- Hardware startups between prototype and first production run
- OEMs with a deployed product that costs them support visits
- Teams hiring a firmware engineer who need the fix before the hire starts

## This is NOT for you if

- Linux or Android embedded systems. This is bare metal and RTOS.
- Certification work (UL, CE) beyond design-for-compliance advice
- Products with no hardware yet. That is Board-to-Fab.

## Proof

The eFuelPro framing layer resynchronises byte by byte through corruption on a shared legacy bus, on a 120 mm board designed and brought up in-house.

See: https://epsilon-labs.co/work/efuelpro/

## Questions

### Can we do firmware only?

Yes. That is Firmware Rescue, from $8,000. This package is for when the board needs to change too.
