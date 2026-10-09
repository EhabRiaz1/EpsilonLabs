# Authorisation Model Review

> Can tenant A read tenant B's row? We find out properly.

Multi-tenant isolation testing against your real schema and policies. Most testing proves you cannot log in as someone else. This proves that once you are legitimately logged in, you still cannot reach what is not yours.

- **Price:** quoted per project after a call — er@epsilon-labs.co
- **What moves the price above that floor:** Number of roles, number of tables under policy, and whether there is a service-role key path that bypasses row-level security. Applications with one admin role are quick; ones with delegated per-organisation permissions are where the time goes.
- **Typical duration:** 1 week
- **Category:** Security
- **Page:** https://epsilon-labs.co/services/authz-review/
- **Enquiries:** er@epsilon-labs.co

## The problem

Authentication gets tested. Authorisation usually does not. The result is an application where every login works exactly as designed and one unparameterised query, one missing policy, or one service-role key on the client exposes every tenant to every other tenant.

Row-level security written after the schema rather than with it is the usual cause. Policies added late are policies nobody can reason about, and the gaps are invisible until somebody goes looking.

## What you get

- Per-table, per-role matrix of what is actually reachable, tested against a live instance
- Cross-tenant read and write attempts from a legitimately authenticated session
- Row-level security policy review against the schema, not against the documentation
- Service-role and key-handling audit — anything that bypasses policy, and where it is exposed
- Storage and file-access isolation, which is usually where it leaks
- API and edge-function authorisation checks
- Written findings with the failing query for each one, so a fix can be verified

## How it runs

- **Day 0** — Scope and written authorisation. Access to a staging instance with representative data — never production.
- **Days 1–3** — Policy and schema review, then the reachability matrix built by testing.
- **Days 4–5** — Findings written up with reproductions, then a call.

## This is for you if

- Postgres and Supabase applications using row-level security
- Any B2B product where two customers share a database
- A team that inherited an application and does not know what its policies allow
- You are about to sign an enterprise customer who will ask this question

## This is NOT for you if

- Any system you do not own or have written authorisation from the owner to test. We ask in writing before we start and will decline without it.
- Stacks other than Postgres. This offer is built on Postgres row-level security — MySQL, Mongo and DynamoDB tenancy models are a different problem and we do not cover them.
- Testing against production data. Staging with representative data, always.
- Full web application penetration testing — this is one deep slice, not broad coverage
- Compliance certification

## Proof

Fabricport runs four role-scoped portals — public catalogue, buyer, supplier and admin — over row-level-secured Postgres. We write these policies alongside the schema because policies bolted on afterwards are the ones that leak.

See: https://epsilon-labs.co/software/

## Questions

### Why not just run a scanner?

A scanner does not know that order 4471 belongs to a different tenant. Authorisation bugs are semantic — they need somebody who has read your schema and understands what the data means.

### What happens to our data and our firmware?

NDA signed before you send anything. Everything you give us — images, captures, schemas, credentials — is held encrypted, never shared outside the engagement, and deleted 30 days after the report unless you ask us to keep it for a retest. Credentials are staging-only and we ask you to rotate them when we finish.

### Do you need production access?

No, and we will decline it. A staging instance with representative data is what we work against.
