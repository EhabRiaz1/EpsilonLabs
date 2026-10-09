# Firmware Rescue

> It half-works, and whoever wrote it is gone.

We take over an embedded codebase nobody understands any more and make it reliable: bring-up, fault detection, watchdogs, automatic recovery, and an update path so the next fix does not need a site visit.

- **Price:** quoted per project after a call — er@epsilon-labs.co
- **What moves the price above that floor:** How reproducible the failure is and how much of the original build survives. A codebase that builds on one laptop costs less to rescue than one that builds nowhere.
- **Typical duration:** 3–6 weeks
- **Category:** Engagements
- **Page:** https://epsilon-labs.co/services/firmware-rescue/
- **Enquiries:** er@epsilon-labs.co

## The problem

The device works on the bench and fails in the field. It locks up once a week and somebody drives out to power-cycle it. The original developer left, the build only runs on one laptop, and nobody wants to touch it.

This is rarely a rewrite. It is almost always missing fault detection, missing recovery, and a handful of states nobody designed for.

## What you get

- Reproducible build, documented, running on more than one machine
- Fault detection and automatic recovery for the failures you actually see
- Watchdogs, brownout handling and a defined behaviour for every reset cause
- Offline tolerance — local commit first, sync second, no lost transactions
- OTA update path so the next fix is a push, not a two-hour drive
- A written map of the firmware for whoever comes after us

## How it runs

- **Week 1** — Paid assessment. We reproduce the failure and write down the cause chain. You get that document whether or not you continue.
- **Weeks 2–4** — Fixes, instrumented and verified against the reproduction.
- **Weeks 5–6** — Recovery paths, OTA, documentation, handover.

## This is for you if

- ESP32, STM32, RP2040, Arduino and PlatformIO codebases
- Devices already deployed that are costing you support visits
- A product that works until the network drops
- Teams who inherited firmware with no author and no documentation

## This is NOT for you if

- Ground-up firmware for a board that does not exist yet — that is Board-to-Fab
- Linux or Android embedded systems. This is bare metal and RTOS.
- Codebases we cannot build or hardware we cannot get hold of

## Proof

The eFuelPro framing layer resynchronises byte by byte through corruption on a bus shared with legacy equipment, where fixed-offset parsing had been silently returning garbage that looked like data.

See: https://epsilon-labs.co/work/efuelpro/

## Questions

### Why a paid assessment first?

Because quoting a rescue without reproducing the failure is guesswork, and you would be paying for the guess. The assessment is credited against the work if you proceed.

### What if the right answer is a rewrite?

Then the assessment says so, with the reasoning, and you can take that document anywhere. It is the honest outcome maybe one time in five.
