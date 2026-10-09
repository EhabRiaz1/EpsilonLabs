# Datasheet to Footprint

> A footprint drawn from the mechanical drawing, not from the internet.

Send a datasheet, get back a KiCad symbol, footprint and 3D model built to the manufacturer's mechanical drawing and checked against IPC land pattern rules.

- **Price:** quoted per project after a call — er@epsilon-labs.co
- **What moves the price above that floor:** Pin count and package complexity. A two-pin passive is at the floor; a BGA or a connector with a complex mechanical keepout is more.
- **Typical duration:** 2–3 days
- **Category:** Desk work
- **Page:** https://epsilon-labs.co/services/footprint/
- **Enquiries:** er@epsilon-labs.co

## The problem

Footprints downloaded from a parts site are how a board comes back from the fab 0.4 mm wrong. They are drawn by somebody who did not read the mechanical drawing, and the error is invisible until the parts do not fit.

Drawing one properly takes an hour you do not have, for a part you will use once.

## What you get

- KiCad symbol with correct pin numbering, electrical types and naming
- Footprint built to the manufacturer mechanical drawing, IPC-7351 land pattern
- Courtyard and keepout, including antenna keepouts where the part needs one
- 3D model aligned to the footprint origin
- A note of every assumption we had to make where the datasheet was ambiguous

## How it runs

- **Day 0** — You send the datasheet link or PDF and say which density level you want.
- **Days 1–2** — Drawn and checked against the drawing.
- **Day 3** — Library files delivered, with the assumptions noted.

## This is for you if

- An industrial module or connector with no decent library anywhere
- Teams who have been burned by a downloaded footprint
- Anyone standardising a house library they can actually trust

## This is NOT for you if

- Parts with a good manufacturer-supplied KiCad library already — use it and save the money
- Altium or Eagle native formats. We work in KiCad and export.
- Footprint checking without the datasheet. We need the mechanical drawing.

## Proof

Every footprint on Epsilon1 was drawn from the module datasheets — the ESP32-S3-DevKitC-1 mechanical drawing, the MSP4031 display, the RC522 — rather than from whatever a parts site had lying around.

See: https://epsilon-labs.co/hardware/

## Questions

### Can I send you ten at once?

Yes, and it gets cheaper per part. Send the list and we will quote it.
