# Sandbox + Converter — Build Spec

Wekoya's Agent V2 backend calls **two separate HTTP services**. Today both happen to live
on the same host (`sandbox.wekoya.tech`), but they are independent and can be deployed
separately. Everything below is what the backend already sends and expects — build to it
exactly and nothing in the backend needs to change.

---

## 1. Code Sandbox (`execute_code`)

This is the open-source **librecodeinterpreter** contract (the same service LibreChat uses).
If you deploy that project as-is, it already matches.

**Config the backend reads:**

```
AGENT_V2_CODE_BASEURL=https://<API_KEY>@sandbox.wekoya.tech
```

The API key is embedded as the URL *username*. The backend strips it out and sends it as
**HTTP Basic auth** — username = the API key, password = empty.
No key in the URL ⇒ the whole tool is treated as unconfigured and disabled.

### Endpoints

**`POST /exec`** — run code
```jsonc
// request
{ "code": "print(1+1)", "lang": "py", "session_id": "optional", "user_id": "optional" }
// response
{ "session_id": "abc", "stdout": "2\n", "stderr": "", "files": [ { "id": "f1", "name": "chart.png" } ] }
```
- `lang` is a short code: `py`, `js`, `ts`, `bash`.
- `session_id` reuses a previous session so variables and files persist across turns in a
  chat. If a session has expired, return **404 or 410** — the backend then transparently
  retries once with a brand-new session.
- `files` must list any file the code wrote to `/mnt/data/` (that's the working dir the
  agent is instructed to write to).

**`GET /download/{session_id}/{file_id}`** — raw file bytes. No query params.
The backend then uploads those bytes to its own S3 storage and hands the user a signed URL.

**`POST /upload`** — multipart, so the backend can seed a session with a user's attachment
before code runs. Fields: `files` (the file) and optional `session_id`.

**Also expected:** `GET /openapi.json` describing the above (used to verify the deployment).

### Runtime notes
- Python is the main workload: pandas, matplotlib, reportlab, python-docx, python-pptx,
  openpyxl should be installed.
- Default execution timeout is the service's own — the backend does not send one.
- Backend HTTP timeout: **30s**.
- Known limitation on the current box: `soffice` (LibreOffice) is installed but fails with
  `/proc not mounted`, so document→PDF conversion **cannot** happen inside the sandbox.
  That's exactly why service #2 exists. If you can mount `/proc` in the container, say so.

---

## 2. File Converter (`convert_file`)

A small, separate service. One job: take a file in, give a converted file back.

**Config the backend reads:**

```
FILE_CONVERT_API_URL=https://sandbox.wekoya.tech   # optional, this is the default
FILE_CONVERT_API_KEY=<key>                         # required, else conversion is disabled
FILE_CONVERT_MAX_BYTES=52428800                    # optional, default 50MB
FILE_CONVERT_TIMEOUT_MS=60000                      # optional, default 60s
```

### Endpoint

**`POST /convert`** — multipart
- `file` — the source file bytes (original filename is sent; sniff format from it)
- `to`   — target extension, lowercase, no dot (`pdf`, `docx`, `html`, `png`, `txt`, `csv`, `xlsx`, `pptx`)
- Header `x-api-key: <FILE_CONVERT_API_KEY>`

**Success:** HTTP 2xx, body = raw converted bytes.
**Failure:** non-2xx with a JSON body `{ "error": "human readable reason" }` — the backend
surfaces that message to the user verbatim, so make it readable.

Two rules that matter:
- **Never return a JSON error body with a 200 status.** The backend guards against it, but
  it's ambiguous.
- Content-Type on success is ignored for known formats (the backend maps it itself), so
  `application/octet-stream` is acceptable — but returning the correct one is better.

This service needs a *working* LibreOffice/headless converter (plus whatever else for
images), which is the piece the sandbox container can't provide.

### Where it's used
1. The AI's `convert_file` tool, when a user asks to convert something.
2. Automatic PDF preview generation on upload and on AI-generated `.docx`/`.pptx` files,
   so the frontend can show an inline preview. This runs fire-and-forget in the background.

---

## Quick acceptance checklist

- [ ] `POST /exec` with `{code:"print(1)",lang:"py"}` + basic auth → stdout `1`
- [ ] Second `/exec` with the returned `session_id` sees the previous run's variables
- [ ] Code writing to `/mnt/data/out.png` → the file appears in `files[]`
- [ ] `GET /download/{session_id}/{file_id}` → those exact bytes
- [ ] Expired `session_id` → 404 or 410 (not 500)
- [ ] `POST /upload` with `files` + `session_id` → file readable from `/mnt/data/`
- [ ] `POST /convert` with a `.docx` and `to=pdf` + `x-api-key` → valid PDF bytes
- [ ] `POST /convert` with a bad key → 401 `{ "error": "..." }`
