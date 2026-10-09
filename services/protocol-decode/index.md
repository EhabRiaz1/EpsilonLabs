# Protocol Decode Sprint

> Your machine is already talking. We work out what it is saying.

A serial bus with no published specification, no vendor support and no integration partner willing to return a call. We capture it, decode it, and hand you a validated parser plus the written specification nobody else has.

- **Price:** quoted per project after a call — er@epsilon-labs.co
- **What moves the price above that floor:** How many genuinely distinct protocols there are, whether we can get physical access for the capture phase, and how much other traffic shares the bus. One vendor across several model years is almost always one protocol; separate vendors are separate sprints.
- **Typical duration:** 2–4 weeks
- **Category:** Engagements
- **Page:** https://epsilon-labs.co/services/protocol-decode/
- **Enquiries:** er@epsilon-labs.co

## The problem

Most integration work stops at the API. When there is no API — an industrial machine speaking an undocumented serial protocol to a console the vendor will not open — the project usually stops with it.

The machine is not the problem. It is broadcasting everything you need, continuously. What is missing is somebody willing to sit with a logic analyser and a controlled stimulus matrix until the bytes give themselves up.

## What you get

- Written protocol specification — framing, delimiters, field map, encoding, checksums
- Validated parser in C/C++ or Python, with the capture set it was verified against
- Raw captures and the stimulus matrix used to produce them, so you can re-derive it
- Resynchronisation strategy for a shared or noisy bus
- A go/no-go call at the halfway point — if it is no-go you stop there and we refund the balance

## How it runs

- **Week 1** — Tap the bus, capture continuously, build the stimulus matrix. Framing separated from payload.
- **Week 2** — Field mapping. One quantity varied at a time until each byte is accounted for. Halfway go/no-go call lands here.
- **Weeks 3–4** — Parser, validation against held-back captures, written spec, handover.

## This is for you if

- Fuel dispensers, industrial meters, weighbridges, PLCs, medical or lab instruments
- RS485, RS232, Modbus, CAN, or something proprietary on top of one of them
- A vendor who will not share the specification, or no longer exists
- A mixed fleet where every machine speaks slightly differently

## This is NOT for you if

- Encrypted or cryptographically authenticated protocols — that is a different problem and usually the wrong one to solve
- Any equipment you do not own or have written authorisation from the owner to interface with. We ask in writing before we start, every time, and we will decline without it.
- Wireless or network protocols. This is wires.

## Proof

For eFuelPro we recovered 25-byte frames at 38400 8N1 with 0x04/0x06 delimiters and BCD fields off a fuel dispenser with no documentation — then built a decode engine that works the field map out by itself on each new site.

See: https://epsilon-labs.co/work/efuelpro/

## Questions

### What if the protocol turns out to be undecodable?

You get a go/no-go call at the halfway point. If it is no-go you stop there and we refund the balance. We would rather lose half a fee than sell you a quarter you cannot use.

### Do you need physical access to the machine?

Usually yes, at least for the capture phase. Where that is impossible we can work from captures you take with a rig we specify and ship.

### Who owns the result?

You do. Specification, parser, captures, all of it.

### I have a mixed fleet. Is that one sprint or several?

Usually one. Machines from one vendor across a few model years are nearly always the same protocol with fields in different places, and the decode engine handles that variation by itself. Genuinely different vendors are separate protocols and we price them separately — we will tell you which you have on the first call, before you commit to anything.
