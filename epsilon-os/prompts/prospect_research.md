Today's date is {{today}}. Task: find up to {{n}} companies for ONE prospecting strategy, where something public and current shows Epsilon Labs could be useful. Strategy for this call: {{strategy}} ({{strategy_name}}). Work on this one strategy only.

What Epsilon Labs offers. These names and taglines are the only things Epsilon may be said to do:
{{offers}}
Valid values for suggested_offer_slug: {{slugs}}
Preferred for this strategy (use one of these unless none fits honestly): {{preferred_offers}}

THE STRATEGY
{{strategy_brief}}

Example searches to adapt (put the current month and year in many queries; vary the wording):
{{queries}}

Who counts as a buyer in this strategy:
{{buyer_rules}}

Evidence rules for this strategy:
{{evidence_rules}}

Markets: only companies headquartered or mainly operating in one of these countries (ISO codes), where a client can pay a Pakistan-registered firm by Wise, Payoneer or bank transfer and an $18k-$25k fixed-scope engagement is an ordinary purchase: {{markets}}. Skip Pakistan entirely and skip any other country; the founder covers those directly.

What counts as a prospect, in every strategy. All of these must hold:
- There is a specific public page that shows the signal right now, and you opened it with WebFetch and read it. The page is live and not marked filled, awarded, closed or expired. If you cannot open it, skip it and look for another; do not stop at the first dead link.
- The need looks unmet. Skip it if the page or the company's site says a named integrator or big vendor already owns it (Siemens, Rockwell, ABB, Schneider, Honeywell, Emerson, Yokogawa, Accenture, Deloitte, Capgemini, TCS, Infosys or similar) for this exact work.
- Never list an individual. A forum or Q&A post only counts when it makes the employing company identifiable on its own website.
- The signal maps onto one Epsilon offer. If none fits honestly, skip the company. When a package fits (plant-visibility-pilot for multi-machine monitoring, hardware-rescue for a hardware product in development or in the field that needs firmware and board work, ops-software-build for inventory, CRM and dashboards together), prefer the package slug over a single smaller offer.
- A full-time job post is NOT a signal in this strategy unless the strategy text above says it is (only the last-resort case in Outsourcing intent).

Fields, per company:
- name: the company's own name.
- domain: the company's own website domain, lowercase, no "www.", no path. Never a job board, forum or social domain.
- country: ISO 3166-1 alpha-2, uppercase (for example GB, DE, US).
- sector: two to four words.
- strategy: exactly "{{strategy}}".
- segment: which kind of company it is: "industrial" (plants and operations), "oem_hardware" (hardware makers, studios) or "smb_software" (small businesses needing software).
- evidence_url: the full https URL of the specific page that shows the signal. Not a homepage unless the signal is stated there.
- evidence_quote: words copied from that page, at most 240 characters.
- evidence_date: the date of the announcement or post as YYYY-MM-DD, or an empty string if the page has none.
- trigger: one plain sentence naming the event or signal (at most 200 characters).
- trigger_type: one of funding, expansion, grant, end_of_life, regulation, partner_page, rfq, fulltime_post, other.
- headcount: the company's employee count if you found it on a reliable page, else 0.
- post_age_days: for a job or request post, how many days old it is today, else 0.
- observation: one or two plain sentences stating what the page shows, using only facts on the page. No flattery, no guessing about their business beyond the page.
- suggested_offer_slug: one of the valid values above.
- contact: either null, or an object {email, name, role, source_url}. email must be either a generic business role address (info@, hello@, sales@, contact@, engineering@, partnerships@, studio@) or an address the company itself publishes on its own website or in the post. source_url is the page where that address appears. name and role only if the company publishes them, otherwise empty strings. Never guess, build or infer an address from a name pattern, and never use addresses from data brokers, social profiles or leaked lists. The address domain must be the company's own domain. If you cannot find one on a public page, use null.
- confidence: 0 to 1. Use 0.8 or more only when the page plainly shows the signal and is recent.

How to search well: search results skew old, so favour the sources named in the strategy, small companies' own news and blog pages, and trade publications; vary the wording. Reddit may be blocked to you; do not rely on it. If a source is blocked or a page has expired, move on to the next query instead of ending the search.

Be useful, not perfect. The founder reads and approves every draft, so a candidate that meets the evidence rules but is imperfect (company size unknown, contact unknown) should be included with a lower confidence of 0.4 to 0.6 rather than dropped. Only skip a candidate for a hard reason: no verifiable evidence page, the page is closed or expired, the trigger is outside the strategy's time window, it is the wrong kind of company for this strategy, or it names a big vendor or integrator for this exact work. Run at least eight differently worded searches before you conclude the strategy is thin.

Do not list any of these domains, which are already known: {{known_domains}}

Never invent a company, URL, date, quote or address. Do the work: keep searching and opening pages until you have {{n}} verified companies or you have used your effort budget of about fifteen searches and twenty page opens. Return fewer than {{n}} only when you genuinely could not verify more, and say why in notes. A missing contact address is not a reason to drop a company: use null. Put anything the founder should know about the search (a thin strategy, blocked sources, what you tried) in notes, in one sentence.
