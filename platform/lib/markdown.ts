// A deliberately small markdown subset for proposal text, parsed to data (never to HTML), so nothing a proposal
// contains can inject markup. Pure (unit-tested).
//
//   ## Heading            a scope item title, or a timeline step ("Week 1 · Survey and sensor plan")
//   plain lines           paragraph (consecutive lines join)
//   - item / * item       bullet (in the scope: the "From you" checklist)
//   > text                note (in the scope: "Not included"; in the timeline: the milestone pill)
//   **bold**              inline bold

export type Block =
  | { type: "h"; text: string }
  | { type: "p"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "quote"; text: string };

export type Inline = { text: string; bold: boolean };

export function parseBlocks(md: string): Block[] {
  const out: Block[] = [];
  let para: string[] = [];
  let quote: string[] = [];
  let list: string[] | null = null;
  const flush = () => {
    if (para.length) out.push({ type: "p", text: para.join(" ") });
    if (quote.length) out.push({ type: "quote", text: quote.join(" ") });
    if (list) out.push({ type: "ul", items: list });
    para = [];
    quote = [];
    list = null;
  };
  for (const raw of (md ?? "").replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const h = /^#{1,4}\s+(.*)$/.exec(line);
    const li = /^[-*]\s+(.*)$/.exec(line);
    const q = /^>\s?(.*)$/.exec(line);
    if (h) {
      flush();
      out.push({ type: "h", text: h[1].trim() });
    } else if (li) {
      if (para.length || quote.length) flush();
      (list ??= []).push(li[1].trim());
    } else if (q) {
      if (para.length || list) flush();
      quote.push(q[1].trim());
    } else {
      if (quote.length || list) flush();
      para.push(line);
    }
  }
  flush();
  return out;
}

export function inline(text: string): Inline[] {
  const parts: Inline[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index), bold: false });
    parts.push({ text: m[1], bold: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), bold: false });
  return parts;
}

export type ScopeView = { intro: string[]; items: { title: string; body: string[] }[]; notes: string[]; checklist: string[] };

export function scopeView(md: string): ScopeView {
  const v: ScopeView = { intro: [], items: [], notes: [], checklist: [] };
  for (const b of parseBlocks(md)) {
    const cur = v.items[v.items.length - 1];
    if (b.type === "h") v.items.push({ title: b.text, body: [] });
    else if (b.type === "p") (cur ? cur.body : v.intro).push(b.text);
    else if (b.type === "quote") v.notes.push(b.text);
    else v.checklist.push(...b.items);
  }
  return v;
}

export type TimelineStep = { week: string; title: string; meta: string[]; milestone: string | null };

export function timelineView(md: string): { intro: string[]; steps: TimelineStep[] } {
  const intro: string[] = [];
  const steps: TimelineStep[] = [];
  for (const b of parseBlocks(md)) {
    const cur = steps[steps.length - 1];
    if (b.type === "h") {
      const m = /^(.+?)\s+(?:·|—|–|:|\|)\s+(.+)$/.exec(b.text);
      steps.push({ week: m ? m[1] : "", title: m ? m[2] : b.text, meta: [], milestone: null });
    } else if (b.type === "quote") {
      if (cur) cur.milestone = cur.milestone ? `${cur.milestone} ${b.text}` : b.text;
      else intro.push(b.text);
    } else if (b.type === "p") (cur ? cur.meta : intro).push(b.text);
    else (cur ? cur.meta : intro).push(...b.items);
  }
  return { intro, steps };
}
