# eFuelPro

> Every litre has a record, and the record has a receipt.

A forecourt terminal that reads the dispenser directly off the bus — not from a person typing numbers into a phone. Verifiable receipts, RFID loyalty and attendance, and a ledger that keeps working when the link drops.

- **Price:** quoted per project after a call — er@epsilon-labs.co
- **What moves the price above that floor:** Number of pumps, and whether we already hold your dispenser's protocol. If we do not, a Protocol Decode Sprint comes first and is quoted separately.
- **Typical duration:** install in a day
- **Category:** Products
- **Page:** https://epsilon-labs.co/products/efuelpro/
- **Enquiries:** er@epsilon-labs.co

## The problem

A forecourt runs on trust and a clipboard. The dispenser knows exactly what it dispensed; the owner finds out later, from a total that has been through several hands. There is no dispute to resolve because there is no record to dispute.

Pakistan's regulator now requires digital monitoring across more than 12,000 pumps, reported through an approved app. eFuelPro does not replace that reporting — it makes the numbers you report true, by taking them off the dispenser instead of off a clipboard.

## What you get

- Epsilon1 terminal, installed and reading your dispenser directly
- Self-calibrating decode — the device works out your pump's field map on site
- Thermal receipts with a QR code that resolves to the online record
- RFID loyalty per vehicle and per card, and staff attendance on the same reader
- Offline-first ledger — sales never block on the network
- Live dashboard: per-nozzle, per-shift, per-day, readable from anywhere
- OTA configuration, including price per litre, with no site visit

## How it runs

- **Week 0** — We confirm your dispenser make and model and whether we already have its protocol. If not, a Protocol Decode Sprint comes first.
- **Install day** — Terminal mounted, bus tapped, decode engine calibrated on site.
- **Week 1** — Attendants trained, receipts live, ledger reconciled against your books.

## This is for you if

- Independent stations and small chains who cannot see what they sold until the shift ends
- Dealers under a digital-monitoring obligation
- Sites with old or mixed dispenser fleets that other integrators have turned down
- OMCs wanting real telemetry rather than typed returns

## This is NOT for you if

- Anyone who wants manual entry software — that market is well served and cheaper
- Stations whose dispensers already expose a documented, supported integration
- Single-pump sites where the monthly will not pay for itself

## Proof

Running in production on live dispenser hardware: 8,700 lines of C++ on ESP32-S3, a 120 mm board we designed, and a protocol nobody had documented.

See: https://epsilon-labs.co/work/efuelpro/

## Questions

### My pumps are old and nobody will integrate them.

That is the case we built this for. If we have not seen your protocol before, a Protocol Decode Sprint comes first and the terminal follows.

### What happens when the internet goes down?

Nothing. Every transaction commits locally to a crash-safe queue with idempotent event IDs and drains when the link returns. The sale never waits.

### Can we resell this?

Yes. Dealer and OMC terms are how we prefer to sell. Ask.
