# Remote Protocol Decode

> You capture it. We decode it. Nobody gets on a plane.

The decode half of a Protocol Decode Sprint, without the site visit. We specify a capture rig, you run the stimulus matrix on your own machine, and we turn the resulting logs into a written specification and a working parser.

- **Price:** quoted per project after a call — er@epsilon-labs.co
- **What moves the price above that floor:** How complete your captures are. A full stimulus matrix run to our instructions decodes quickly; a single log of idle traffic often cannot be decoded at all, and we will tell you that before you pay.
- **Typical duration:** 1–2 weeks
- **Category:** Desk work
- **Page:** https://epsilon-labs.co/services/remote-decode/
- **Enquiries:** er@epsilon-labs.co

## The problem

The reason protocol work is expensive is usually travel. The machine is on a forecourt in one country and the person who can read it is in another, and half the fee is aeroplanes and hotel rooms.

But the capture phase does not need us. It needs a cheap logic analyser, a precise list of what to vary, and somebody on site willing to follow it.

## What you get

- A capture protocol: exactly what hardware to buy, where to clip it, what to vary and in what order
- A free feasibility check on your first sample capture before you commit
- Written protocol specification — framing, delimiters, field map, encoding, checksums
- Validated parser in C/C++ or Python against your captures
- Everything you need to re-derive it yourself

## How it runs

- **Before we start** — Written authorisation that you may interface with the equipment. Then we send the capture protocol and a parts list — typically under $150 of kit.
- **Day 1–3** — You capture. Send us the first sample and we tell you free whether it is decodable before you go further.
- **Week 1–2** — Decode, parser, written specification, handover call.

## This is for you if

- A machine anywhere in the world with somebody on site who can clip on a probe
- Budgets that will not carry international travel
- A first step before committing to the full on-site sprint
- Anyone who has captures already and needs them read

## This is NOT for you if

- Any equipment you do not own or have written authorisation from the owner to interface with. We ask for that authorisation in writing before we send the capture protocol, every time, and we will decline without it.
- Encrypted or cryptographically authenticated protocols. We will not attempt to defeat an authentication scheme, and we would decline if asked.
- Situations where nobody on site can safely attach a probe — take the full sprint instead

## Proof

The eFuelPro decode came out of captures and a controlled stimulus matrix: nozzle up and down, 1 to 400 litres, both pump sides, every dip-switch variant. The matrix is the method, and it travels.

See: https://epsilon-labs.co/services/protocol-decode/

## Questions

### What if my captures turn out to be useless?

We check your first sample free and tell you before you commit. That check is the whole reason this offer exists.

### How is this different from the full sprint?

We are not in the room. You do the capture work to our instructions, which is most of the cost and none of the skill.

### What happens to our captures?

NDA before you send anything. Captures are held encrypted, never shared outside the engagement, and deleted 30 days after handover unless you ask otherwise.

### Who owns the specification and the parser?

You do — specification, parser and captures, the same as the full sprint. We keep no claim over the protocol or anything you build on it.
