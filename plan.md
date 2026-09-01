Good spec — this maps cleanly onto your two services. Here's the plan.

## The demo flow (what the room sees)

1. **Upload screen** (not chat) — drag in bank statement(s) + invoices (PDF/images). No chat box visible yet.
2. **Processing state** — short, satisfying progress messages: "Reading bank statement…" → "Matching invoices…" → "Calculating WHT/VAT…" → "Populating FIRS schedule…"
3. **Review screen** — the real showpiece. Split view: source docs on the left (thumbnails), auto-populated FIRS-format schedule on the right, as an editable table. Rows the AI is unsure about are visibly flagged (amber, with a confidence tag) — this is your trust-building beat, not a weakness to hide.
4. **Download** — a real `.xlsx` in the exact FIRS template structure, plus an inline PDF preview so the room can see it rendered without opening Excel live.
5. **"Ask AI to change something"** — chat box appears only now, after the first result exists. E.g. "this WHT rate should be 5%, not 10%" → row updates live, file regenerates. This is your second "wow" beat — proves it's not a one-shot script, it's an assistant.

That sequencing (upload-first, chat-second) is deliberate: it matches how Finance actually works (build the schedule, then review/correct it) and it avoids the "empty chat box, what do I even type" problem at the start of a live demo.

## How your two services map to this

- **Sandbox (`execute_code`)** does the real work: a Python script using `openpyxl` writes extracted values into the FIRS template structure (formulas, formatting, cell positions) and returns it via `/exec` → `files[]` → `/download`. This is your actual `.xlsx` deliverable.
- **Converter (`convert_file`)** solves a problem you'd otherwise hit: browsers can't preview `.xlsx` inline. After the sandbox produces the file, convert it `xlsx → pdf` so the review screen can show a rendered preview without a heavy spreadsheet viewer library.
- **Bedrock + Claude Sonnet 5** does two jobs: (1) multimodal extraction — read the bank statement/invoice images/PDFs and return structured JSON matching your FIRS column schema, with a confidence score per field; (2) the follow-up chat — takes the current extracted JSON plus the user's correction request and returns an updated JSON, which triggers regeneration via the sandbox.

One correction on your ask: the **new Bedrock API key** (`AWS_BEARER_TOKEN_BEDROCK`) isn't a new model feature — it's a simpler auth mode AWS added, a bearer token you drop in an `Authorization: Bearer <key>` header instead of doing SigV4 request-signing. That's genuinely useful for you here because your Sandbox/Converter services already use a bearer-style key pattern, so your whole backend ends up using one consistent auth style. Set it as an env var (`AWS_BEARER_TOKEN_BEDROCK`) and call it directly — no AWS SDK credential chain needed. Model ID on Bedrock is `anthropic.claude-sonnet-5`.

## Architecture (single Next.js project)

**Client (App Router pages):**
- `/` — upload screen
- Result view rendered in the same page via state transition (upload → processing → review), keeps it feeling like one fluid app, not a multi-page wizard

**Server (API routes, all server-only — sandbox/converter keys never touch the client):**

| Route | Job |
|---|---|
| `POST /api/upload` | Receives files, forwards to Sandbox `/upload` with a new `session_id`, stores `session_id` + file list server-side keyed to a demo session |
| `POST /api/extract` | Calls Claude Sonnet 5 (Bedrock, multimodal) with the uploaded docs → returns structured JSON: line items, VAT/WHT amounts, confidence per field |
| `POST /api/generate` | Takes current JSON, runs a Python/openpyxl script via Sandbox `/exec` (reusing `session_id`) → downloads the `.xlsx` via `/download` → calls Converter `/convert` (`xlsx→pdf`) for the preview |
| `POST /api/revise` | Takes a user chat instruction + current JSON, calls Claude to produce an updated JSON diff, then re-invokes `/api/generate` logic |

**State:** no DB needed for a demo — keep the current extracted JSON + sandbox `session_id` in a simple in-memory server map keyed by a demo-session cookie. Good enough for one laptop, one presenter, one session.

## Build order for today (given the clock)

1. Upload UI + `/api/extract` returning JSON you can `console.log` — prove extraction works on real sample docs first, before touching the sandbox at all.
2. `/api/generate` — hardcode the openpyxl script against your known FIRS template columns, get one real `.xlsx` downloading end to end.
3. Review screen — table view + confidence flags + PDF preview via Converter.
4. Chat/revise loop — only once 1–3 are solid; it's the flashiest part but the least essential if time runs out (a static polished result with the flag/download beats a half-working chat).

Want me to scaffold the actual Next.js project now, starting with steps 1–2?