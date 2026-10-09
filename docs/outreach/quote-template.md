# Quote template

Source of truth for every figure: `tools/offers.py`. Do not quote an offer
that is not in that file. Do not quote below `price_from` without founder
sign-off. `SHOW_PRICES` is False: these figures go in the quote only, never
on a public page or in an unsolicited email.

How to fill the price line: take the offer's `slug`, read `price_from`,
`currency` and `price_note`, then read `price_drivers` and decide where the
scope lands above the floor. Say why in one sentence.

---

# Quote {{quote_no}}: {{client_company}}

Date: {{date}}  
Valid until: {{date + 14 days}}  
Prepared by: Ehab Riaz, Epsilon Labs

## Scope summary
{{2-4 sentences: what the work has to do, in the client's words.}}

Offer: {{offer.name}} (`{{offer.slug}}`)  
Not included: {{pick from offer.not_for that apply, plus anything agreed out of scope}}

## Deliverables
- {{from offer.deliverables, edited to this job}}
- {{...}}

## Timeline
Start: on receipt of the first payment (and written authorisation, where the
offer requires it).  
Duration: {{offer.duration, adjusted}}  
Milestones:
- Midpoint: {{what the client can see by then}}
- Delivery: {{date or week count}}

## Price
{{currency}} {{amount}}, {{offer.price_note}}.  
Why this figure: {{one sentence, tied to offer.price_drivers}}

## Payment
| When | Share | Amount |
|---|---|---|
| To start work | 40% | {{amount}} |
| At midpoint | 40% | {{amount}} |
| On delivery | 20% | {{amount}} |

Pay by Wise, Payoneer or local bank transfer. Details on the invoice. Work
does not start until the deposit clears.

## Terms
- This quote is valid for 14 days from the date above.
- Intellectual property in the deliverables transfers to you on final payment.
  Until then it stays with Epsilon Labs.
- NDA signed before any files or captures are sent.
- Changes to scope are quoted in writing before work on them starts.
- {{Security offers only: written authorisation to test is required before
  anything starts. Epsilon Labs is not an accredited firm.}}

To accept, reply "accepted" and we will send the first invoice.
