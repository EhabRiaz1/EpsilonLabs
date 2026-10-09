# Sensing & Calibration

> Sensors that stay accurate after the first week.

Instrumentation that has to be trusted — force, pressure, tactile, motion — designed, calibrated and characterised, with drift correction and a calibration pipeline that survives a re-flash.

- **Price:** quoted per project after a call — er@epsilon-labs.co
- **What moves the price above that floor:** Number of channels, required accuracy, and whether the sensor exists or has to be designed and fabricated.
- **Typical duration:** 4–8 weeks
- **Category:** Frontier
- **Page:** https://epsilon-labs.co/products/sensing/
- **Enquiries:** er@epsilon-labs.co

## The problem

A sensor is accurate the day it is calibrated. After that it drifts with temperature, age and handling, and most products have no way to notice — so the numbers look fine long after they stopped being true.

Calibration done once, by hand, on one unit, does not scale to a hundred.

## What you get

- Sensor selection or custom sensing hardware
- Characterisation across temperature and load
- Automated calibration fitting, per unit
- Drift detection and correction in firmware
- Versioned calibration profiles that survive a re-flash
- Test tooling so production calibration does not need an engineer

## How it runs

- **Weeks 1–2** — Accuracy target, sensor choice, characterisation plan.
- **Weeks 3–6** — Hardware, firmware and the calibration pipeline.
- **Weeks 7–8** — Production test tooling and handover.

## This is for you if

- Tactile and force sensing, load cells, pressure, IMUs and motion
- Products where a wrong reading costs money or safety
- Teams calibrating units by hand and losing a day per batch

## This is NOT for you if

- Certified metrology or legal-for-trade calibration
- Medical diagnostic devices
- Sensors you cannot physically access or test

## Proof

eFuelPro calibrates itself: it samples an idle baseline, scores every candidate field mapping against measured price-per-unit within 1% tolerance, and persists versioned calibration profiles as JSON so a device can be re-flashed and restored. A 1,500-line Python toolchain drives the fitting.

See: https://epsilon-labs.co/work/efuelpro/

## Questions

### Can you work with our existing sensors?

Yes — most of the value is usually in characterisation and calibration, not in replacing the sensor.
