# War story 1: eFuelPro protocol decode

Format: technical write-up, founder-voiced, ~1,000 words plus captures.
Venues: LinkedIn, Hacker News, r/embedded, r/PLC, GitHub (decode artifacts).
Ends with a link to Remote Protocol Decode (`/services/remote-decode/`).

**Fact boundary.** Use only what is already published in `llms.txt`, README
and the `offers.py` proof text. Anything marked FOUNDER below is not
published yet. Do not invent it. Do not name the dispenser manufacturer or
model unless the founder confirms it is cleared to name.

Published facts:
- Fuel dispenser with no specification and no vendor support.
- Frames are 25 bytes.
- Serial at 38400 baud, 8N1.
- Frames use 0x04 and 0x06 delimiters.
- Fields are BCD-encoded.
- Controlled stimulus matrix: nozzle up and down, 1 to 400 litres, both pump
  sides, every dip-switch variant.
- The result is a decode engine that works out the field layout by itself at
  each new site.

---

## 1. Hook (2-3 sentences)
A dispenser was talking on a serial line and nobody would tell us what it
said. Open with the situation, not with us.
*Draft line:* "The pump had been sending data every second for years. No one
had written down what it meant."

## 2. The mystery
- What we had: a machine, a wire, no documentation, no vendor help.
- Why it matters: without the protocol, every litre sold is invisible to
  the owner.
- FOUNDER: what happened when you first looked. How long it took to find the
  baud rate. What you tried that failed.

## 3. The decode process
1. Find the framing: 38400 8N1, 25-byte frames, 0x04 and 0x06 delimiters.
   Show how the fixed length and delimiters showed up.
2. Run the stimulus matrix. Change one thing at a time: nozzle up or down,
   volume from 1 to 400 litres, each pump side, each dip-switch setting.
3. Diff the frames. Show which bytes move with which change.
4. Work out the encoding: fields are BCD. Show one number in raw bytes and
   as read.
5. Dip-switch variants moved the field layout, which is why a fixed parser
   was not enough.
- FLAG: **capture needed.** One raw hex dump of a single frame, annotated.
- FLAG: **capture needed.** Two frames side by side with the changed bytes
  highlighted (for example nozzle up vs down).
- FLAG: **screenshot needed.** Logic analyser trace showing the delimiters.
- FLAG: **founder to confirm** any capture is cleared to publish and has no
  customer-identifying data.

## 4. The payoff
- Result: the decode engine works out the field layout itself at each new
  site, so each install does not need a new decode.
- What it enabled: a record for every litre, with a receipt (eFuelPro).
- FOUNDER: a real number if one exists and is published (time saved, sites
  running). If none, leave it out.

## 5. What did not work / limits (keeps it honest)
- Encrypted or authenticated protocols are out of scope. We do not try to
  defeat them.
- Authorisation from the equipment owner is needed first.
- FOUNDER: one real dead end.

## 6. CTA
Short. Not a pitch.
"If you have a machine like this and cannot fly anyone out, the method
travels. You run a capture matrix to our instructions, we read the logs.
We check your first sample for free before you commit: Remote Protocol Decode,
https://epsilon-labs.co/services/remote-decode/"

Do not state a price in the post.

## Publishing checklist
- [ ] Founder rewrote in his own voice
- [ ] Every number matches llms.txt/README or a founder-supplied capture
- [ ] Captures and screenshots added and cleared
- [ ] Posted to at least 3 named venues
- [ ] GitHub decode artifact linked, if published
