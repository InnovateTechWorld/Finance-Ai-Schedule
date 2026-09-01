# Schedule — FIRS WHT & VAT preparation

Drop in bank statements and invoices. The app reads them with Claude, builds a
FIRS-format withholding-tax and VAT schedule, writes a real `.xlsx` in the code
sandbox, renders a PDF preview through the converter, and lets you correct the
result — by hand in the table, or by asking in plain English.

## Run it

```bash
cp .env.example .env.local   # fill in the keys
npm install
npm run dev
```

Open http://localhost:3000.

## Configuration

| Variable | Purpose |
| --- | --- |
| `AWS_BEARER_TOKEN_BEDROCK` + `AWS_REGION` | Bedrock bearer auth. Takes precedence when set. |
| `BEDROCK_MODEL_ID` | Defaults to `anthropic.claude-sonnet-5`. A bare model ID is automatically given the cross-region inference-profile prefix for your region (`us.` / `eu.` / `apac.` / `au.` / `jp.` / `global.`); an already-prefixed ID or a profile ARN is passed through untouched. |
| `MODEL_THINKING` | `off` (default) or `adaptive`. Off is markedly faster; extraction is transcription rather than reasoning. |
| `BEDROCK_INFERENCE_GEO` | Override the derived geo prefix. Only needed in regions with no obvious mapping (`ca-`, `sa-`, `me-`, `af-`, `il-`). |
| `ANTHROPIC_API_KEY` + `ANTHROPIC_MODEL_ID` | First-party fallback when no bearer token is present. |
| `AGENT_V2_CODE_BASEURL` | `https://<API_KEY>@sandbox.wekoya.tech` — the key is the Basic-auth username. |
| `FILE_CONVERT_API_KEY` (+ `_URL`, `_MAX_BYTES`, `_TIMEOUT_MS`) | Converter service. |

Nothing but the model is strictly required to see the flow: with no sandbox the
schedule still renders on screen (without a workbook), and with no converter the
workbook still downloads (without an inline preview). Every degradation is
announced in the run log rather than failing silently.

## Saved sessions

Every completed run is saved in the browser: the schedule, sources and log go to
`localStorage`, the `.xlsx` / `.pdf` bytes to IndexedDB (a rendered PDF is easily
300 KB and would exhaust the ~5 MB localStorage budget in two runs). The five
most recent runs are listed on the upload screen.

Restoring is not cosmetic — the artifacts come back as blob URLs, so download,
preview and expand all work, and `revise` / `regenerate` send the schedule with
the request so they work even when the server has forgotten the session.

Storage is best-effort throughout. Private windows, blocked site data, a full
quota and entries written by an older build all degrade to "no saved sessions".

## Deploying to Vercel

```bash
vercel                       # link the project
vercel env add               # add each variable from .env.example
vercel --prod
```

`vercel.json` gives the three streaming routes `maxDuration: 300` — **this needs
a Pro plan**; Hobby caps functions at 60s, which a multi-document extraction can
exceed. On Hobby, lower it to 60 and demo with two or three files.

**Upload size is the other platform limit.** A Vercel serverless function accepts
a request body of at most 4.5 MB, well under the 50 MB-per-file the app allows
when self-hosted. `lib/limits.ts` detects the platform (`VERCEL` server-side,
`NEXT_PUBLIC_VERCEL_ENV` in the browser) and clamps both the dropzone's stated
limit and the server's validation to 4 MB, so an oversized batch is refused with
an explanation instead of a bare 413 from the edge. Bank statement PDFs are
usually well under this; high-resolution scans are not. To lift it, upload
straight to blob storage from the browser and pass the app a URL.

The server session store is an in-process `Map`, which on serverless means a
follow-up request may land on an instance that has never seen your session. That
is why artifact bytes travel inline on the SSE stream and are held client-side,
and why the revise and regenerate routes accept a schedule in the request body.
The `/api/artifact/...` route still exists and still works within one instance;
nothing in the UI depends on it. For anything beyond a demo, move the store to
Redis or Vercel KV — `lib/store.ts` is the only file that would change.

## Shape

```
app/
  page.tsx                     upload → stream → review → chat, one state machine
  api/process/route.ts         SSE: ingest, extract, compute, build, preview
  api/revise/route.ts          SSE: natural-language correction, then rebuild
  api/regenerate/route.ts      SSE: rebuild from hand edits in the table
  api/artifact/[sid]/[kind]    serves the .xlsx and .pdf bytes
lib/
  ingest.ts    whatever was dropped → model-readable blocks
  llm.ts       Bedrock-bearer (raw HTTP) or first-party SDK, one interface
  sandbox.ts   /exec · /upload · /download, with session-expiry retry
  converter.ts /convert, with the JSON-error-on-200 guard
  xlsx.ts      the openpyxl script the sandbox runs
  schema.ts    row shape, per-cell confidence, derived money, totals
  events.ts    the SSE event union, shared by server and client
```

### File handling

PDFs, PNG/JPEG/GIF/WebP and text/CSV go straight to the model. DOCX, XLSX,
PPTX, ODT, RTF and HTML are converted to PDF first; HEIC, TIFF, BMP, SVG and
AVIF are converted to PNG. Files with no extension are sniffed by magic bytes.
Limits: 20 files, 50 MB each, 120 MB per batch, and a 28 MB model-request budget
that drops the largest files first so a single huge scan cannot evict the
invoices. Anything skipped is named, with the reason, in the sidebar.

### Confidence

Every extracted field carries its own 0–1 confidence. Below 0.75 the cell is
amber in the table, shaded in the workbook, and listed on the workbook's
"Review notes" sheet. Editing a cell — by hand or through the chat — sets its
confidence to 1, because a preparer who typed a value has decided it.

## Design

Hallmark · genre modern-minimal · macrostructure Workbench · theme Quiet ·
nav N9 · footer Ft2. Tokens live in `tokens.css`; page CSS references them by
name only.
