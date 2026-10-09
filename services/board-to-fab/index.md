# Board-to-Fab

> Schematic to fabrication-ready, owned by you.

Schematic capture, PCB layout, custom symbol and footprint libraries drawn from datasheets, an orderable BOM and a complete fabrication package. Everything needed to build it again without us.

- **Price:** quoted per project after a call — er@epsilon-labs.co
- **What moves the price above that floor:** Layer count, part count, mechanical and enclosure constraints, and whether firmware is in scope. Firmware alongside the board is cheaper than firmware after it, because the person who drew the board writes the driver.
- **Typical duration:** 6–10 weeks
- **Category:** Engagements
- **Page:** https://epsilon-labs.co/services/board-to-fab/
- **Enquiries:** er@epsilon-labs.co

## The problem

Contract layout houses give you a board. They rarely give you the libraries, the reasoning, or a BOM you can actually order from — so the second revision costs as much as the first and you are still dependent.

And footprints copied from a parts site rather than drawn from the mechanical drawing are how a board comes back from the fab 0.4 mm wrong.

## What you get

- Schematic, in KiCad 9 and as a readable PDF
- PCB layout, routed to clean DRC, with power on a widened netclass
- Custom symbol and footprint libraries drawn from manufacturer datasheets
- Orderable BOM with distributor part numbers and qualified alternates
- Fabrication package — Gerbers, Excellon drill, assembly notes
- Pin-to-pin netlist documentation written for someone who was not in the room
- Power protection specified, not assumed — fusing, reverse polarity, TVS

## How it runs

- **Weeks 1–2** — Requirements, block diagram, part selection and lifecycle check. One-way doors named before anything is drawn.
- **Weeks 3–5** — Schematic capture and library work. Datasheet review as we go.
- **Weeks 6–8** — Layout, DRC, 3D mechanical check for collisions and courtyards.
- **Weeks 9–10** — Fabrication outputs, BOM, documentation, handover.

## This is for you if

- An embedded product that needs a real board rather than a stack of dev kits
- A prototype on perfboard that has to become something manufacturable
- A team with firmware skills and no hardware engineer
- Small-batch industrial products, 10 to 1,000 units

## This is NOT for you if

- High-speed digital — DDR, multi-gigabit SERDES, RF front ends. Not our discipline and we will say so on the first call.
- Boards needing more than four layers, usually
- Safety-critical or certified medical hardware

## Proof

Epsilon1 is 120 × 120 mm of 2-layer FR4 carrying five peripherals across two SPI buses, I²C, two UARTs and USB-CDC, with ground pours on both layers and an orderable BOM. It is in the field, not in a drawer.

See: https://epsilon-labs.co/work/efuelpro/

## Questions

### Do you handle assembly?

We produce the fabrication package and work with your assembler, or point you at one. We do not run a production line.

### Can you do the firmware too?

Yes, and it is usually cheaper together — the person who drew the board writes the driver. Quoted as a separate line.

### What if the first revision needs changes?

Expected, and planned for. One revision cycle after bring-up is included.
