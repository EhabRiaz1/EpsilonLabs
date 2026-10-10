Today's date is {{today}}. Task: find up to {{n}} companies that have a visible, current, unmet need Epsilon Labs could meet. Segment for this call: {{segment}}. Work on this one segment only.

What Epsilon Labs offers. These names and taglines are the only things Epsilon may be said to do:
{{offers}}
Valid values for suggested_offer_slug: {{slugs}}

What to look for in this segment:
{{segment_brief}}

What counts as a prospect. All of these must hold:
- There is a specific public page that shows the need right now, and you opened it with WebFetch and read it. The page is live, was posted or updated in roughly the last 120 days (check its date against today's date above), and the need is not marked filled, awarded or closed. If you cannot open it, or it has expired, skip it and look for another; do not stop at the first expired post.
- The need looks unmet. Skip it only if the page or the company's site says a named integrator or big vendor already owns it, for example where the company announces Siemens, Rockwell, ABB, Schneider, Honeywell, Emerson, Yokogawa, Accenture, Deloitte, Capgemini, TCS, Infosys or a similar large vendor or integrator for this exact work.
- Prefer small and mid-sized companies (roughly 5 to 500 people) where a founder or engineering lead decides. Skip large enterprises, listed multinationals, governments, universities, recruiters, job boards, software agencies and consultancies (they are competitors or intermediaries, not buyers). A forum or Q&A post only counts when the post or profile makes the employing company identifiable on its own website; never list an individual as a prospect.
- The need maps onto one Epsilon offer. If none fits honestly, skip the company.

Fields, per company:
- name: the company's own name.
- domain: the company's own website domain, lowercase, no "www.", no path. Never a job board, forum or social domain.
- country: ISO 3166-1 alpha-2, uppercase (for example PK, GB, DE, US).
- sector: two to four words.
- segment: exactly "{{segment}}".
- evidence_url: the full https URL of the specific page that shows the need. Not a homepage unless the need is stated there.
- evidence_quote: words copied from that page, at most 240 characters, that show the need.
- observation: one or two plain sentences stating what they need, using only facts on the page. No flattery, no guessing about their business beyond the page.
- suggested_offer_slug: one of the valid values above.
- contact: either null, or an object {email, name, role, source_url}. email must be either a generic business role address (info@, hello@, sales@, contact@, engineering@, support@) or an address the company itself publishes on its own website or in the post. source_url is the page where that address appears. name and role only if the company publishes them, otherwise empty strings. Never guess, build or infer an address from a name pattern, and never use addresses from data brokers, social profiles or leaked lists. The address domain must be the company's own domain. If you cannot find one on a public page, use null.
- confidence: 0 to 1. Use 0.8 or more only when the page plainly states the need and is recent.

How to search well: your search results skew old, so put the current month and year in many queries, favour small companies' own careers or news pages, trade-forum threads (for example PLCTalk, Stack Exchange, EEVblog, Hacker News "Who is hiring") and smaller public tender portals, and vary the wording. Reddit may be blocked to you; do not rely on it. If a source is blocked or a post has expired, move on to the next query instead of ending the search.

Be useful, not perfect. The founder reads and approves every draft, so a candidate that meets the evidence rules but is imperfect (company size unknown, need only partly matching an offer, contact unknown) should be included with a lower confidence of 0.4 to 0.6 rather than dropped. Only skip a candidate for a hard reason: no verifiable evidence page, the page is closed or expired, it is a big enterprise or intermediary, or it names a big vendor or integrator for this exact work. Commit to a plan: run at least ten differently worded searches before you conclude the segment is thin.

Do not list any of these domains, which are already known: {{known_domains}}

Never invent a company, URL, quote or address. Do the work: keep searching and opening pages until you have {{n}} verified companies or you have used your effort budget of about fifteen searches and twenty page opens. Return fewer than {{n}} only when you genuinely could not verify more, and say why in notes. A missing contact address is not a reason to drop a company: use null. Put anything the founder should know about the search (a thin segment, blocked sources, what you tried) in notes, in one sentence.
