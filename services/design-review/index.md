# Pre-Fab Design Review

> Find the board-killer before you pay for a hundred of them.

Send us your schematic and BOM before you commit to fabrication. We review it the way we review our own and send back a written findings list, ranked by what it would cost you to discover later.

- **Price:** quoted per project after a call — er@epsilon-labs.co
- **What moves the price above that floor:** Layer count and part count. A four-layer mixed-signal board with 300 components is not a two-layer sensor board, and we will tell you which you have before you pay.
- **Typical duration:** 3–5 days
- **Category:** Engagements
- **Page:** https://epsilon-labs.co/services/design-review/
- **Enquiries:** er@epsilon-labs.co

## The problem

A board respin is four weeks and a fabrication run you have already paid for. The faults that cause it are almost never exotic — a voltage domain crossed, a footprint taken from a parts site instead of a datasheet, a regulator with no margin, protection that was assumed rather than specified.

They are also nearly invisible to the person who drew the board, because they are looking at what they meant rather than at what is on the canvas.

## What you get

- Written findings list, ranked by cost-if-missed
- Power architecture review — rails, margin, protection, thermal
- Voltage-domain check across every interface on the board
- Footprint and land-pattern spot check against manufacturer datasheets
- BOM review — lifecycle risk, lead times, second sources
- DRC readiness and fabrication-output check
- A call to walk through anything you want to argue about

## How it runs

- **Day 0** — You send schematic, board file and BOM. Any format we can open.
- **Days 1–3** — Review. We work from the module datasheets, not from the internet.
- **Days 4–5** — Written findings delivered, then a call to walk through them.

## This is for you if

- You have a board about to go to fabrication and nobody senior has read it
- A previous revision came back wrong and you do not know why
- Your layout was outsourced and you want it checked before you pay the fab
- You are a software team who inherited a hardware product

## This is NOT for you if

- Boards already in production with no revision planned — there is nothing to act on
- Full layout work. That is Board-to-Fab.
- Certification, EMC pre-compliance or safety approval. We are not a test house.

## Proof

On Epsilon1, datasheet review caught a 5 V-only RS485 transceiver that would have driven 5 V into the ESP32's 3.3 V RX pin. A dead board and a four-week respin, found for the cost of an afternoon.

See: https://epsilon-labs.co/hardware/

## Questions

### What do you need from me?

The schematic, the board file and the BOM. KiCad, Altium and Eagle are all fine; PDFs work if that is all you have, though we can say less about the layout.

### Is it confidential?

Yes. We will sign your NDA before you send anything, or provide ours.

### What if you find nothing?

That happens and it is a real result. You get the written review saying so, which is worth having when you sign off the fabrication order.
