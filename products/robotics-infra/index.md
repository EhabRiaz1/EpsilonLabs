# Robot-Learning Infrastructure

> Your training runs should fail for research reasons, not DevOps ones.

Distributed training infrastructure for embodied AI — reinforcement learning and vision-language-action models — provisioned on rented GPUs, kept running, and monitored, so your researchers do research.

- **Price:** quoted per project after a call — er@epsilon-labs.co
- **What moves the price above that floor:** Cluster size, and how many frameworks and simulators you run.
- **Typical duration:** 3–6 weeks
- **Category:** Frontier
- **Page:** https://epsilon-labs.co/products/robotics-infra/
- **Enquiries:** er@epsilon-labs.co

## The problem

Robot-learning frameworks are research code. They assume a cluster configured exactly like the authors' cluster, and they break in ways that eat a week of a researcher's time before a single useful run.

The GPUs are rented by the hour whether the run works or not.

## What you get

- Environment build for your framework and simulators, reproducible
- Distributed training across multi-GPU rented instances
- Launch-path and configuration fixes, maintained on a branch you own
- Monitoring across runs, so a dead run is noticed in minutes
- Cost controls so idle GPUs are not billed overnight

## How it runs

- **Week 1** — Your framework, simulators and target hardware.
- **Weeks 2–4** — Environment built, first distributed run reproduced.
- **Weeks 5–6** — Monitoring, cost controls, handover or ongoing operation.

## This is for you if

- Robotics startups and university labs training embodied policies
- Teams running open-source RL or VLA frameworks on rented GPUs
- Researchers losing weeks to infrastructure

## This is NOT for you if

- Model research itself — we run the infrastructure, you own the science
- Large-language-model pretraining at frontier scale
- Physical robot hardware integration — that is a separate engagement

## Proof

Our founder provisioned and ran distributed training for RLinf, an open-source reinforcement-learning framework for vision-language-action models, on rented multi-GPU instances: environment build, launch-path and config fixes on a dedicated branch, and monitoring across runs. It is one framework, run as our own work rather than for a client.

See: https://epsilon-labs.co/about/

## Questions

### Which clouds?

Your own cloud account by default, so your data and checkpoints never leave it. If you have no preference we will suggest where the GPUs are cheapest.
