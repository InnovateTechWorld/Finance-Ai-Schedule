"use client";

import { useCallback, useId, useRef, useState } from "react";

const ACCEPTED =
  ".pdf,.png,.jpg,.jpeg,.webp,.gif,.heic,.heif,.tif,.tiff,.bmp,.svg,.docx,.doc,.xlsx,.xls,.pptx,.ppt,.odt,.ods,.rtf,.csv,.tsv,.txt,.md,.html";

const FORMATS = ["PDF", "JPG / PNG", "HEIC", "DOCX", "XLSX", "CSV", "TXT"];

const MAX_FILES = 20;
const MAX_FILE_BYTES = 50 * 1024 * 1024;

export function Dropzone({
  onRun,
  busy,
}: {
  onRun: (files: File[]) => void;
  busy: boolean;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();

  const add = useCallback((incoming: FileList | File[] | null) => {
    if (!incoming) return;
    const list = Array.from(incoming);
    if (list.length === 0) return;

    setFiles((current) => {
      const merged = [...current];
      const rejected: string[] = [];

      for (const f of list) {
        if (f.size === 0) {
          rejected.push(`${f.name} is empty`);
          continue;
        }
        if (f.size > MAX_FILE_BYTES) {
          rejected.push(`${f.name} is over 50 MB`);
          continue;
        }
        // Same name and size twice is a double-drop, not two documents.
        if (merged.some((m) => m.name === f.name && m.size === f.size)) continue;
        if (merged.length >= MAX_FILES) {
          rejected.push(`only the first ${MAX_FILES} files were kept`);
          break;
        }
        merged.push(f);
      }

      setProblem(rejected.length ? rejected.join(" · ") : null);
      return merged;
    });
  }, []);

  const remove = (index: number) => {
    setFiles((f) => f.filter((_, i) => i !== index));
    setProblem(null);
  };

  const openPicker = () => {
    if (!busy) inputRef.current?.click();
  };

  return (
    <section className="intake">
      <p className="intake__eyebrow">Withholding tax &amp; VAT · FIRS schedule</p>
      <h1>Give it the paperwork. Get back a schedule.</h1>
      <p className="intake__lede">
        Drop in bank statements and the invoices behind them. Every line is matched, rated, and
        totalled into the FIRS format — with anything uncertain flagged for you before you file.
      </p>

      <div
        className={`drop${dragging ? " is-dragging" : ""}`}
        role="button"
        tabIndex={busy ? -1 : 0}
        aria-disabled={busy}
        aria-describedby={inputId}
        onClick={openPicker}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openPicker();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!busy) add(e.dataTransfer.files);
        }}
      >
        <p className="drop__title">{dragging ? "Let go" : "Drop your documents here"}</p>
        <p className="drop__hint" id={inputId}>
          or click to browse · up to {MAX_FILES} files, 50 MB each
        </p>
        <div className="drop__formats">
          {FORMATS.map((f) => (
            <span className="chip" key={f}>
              {f}
            </span>
          ))}
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPTED}
          className="sr"
          disabled={busy}
          onChange={(e) => {
            add(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {problem && (
        <div className="notice notice--warn" role="status">
          <span>{problem}</span>
        </div>
      )}

      {files.length > 0 && (
        <>
          <ul className="queue" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {files.map((f, i) => (
              <li className="queue__item" key={`${f.name}-${f.size}-${i}`}>
                <span className="chip">{ext(f.name)}</span>
                <span className="queue__name">{f.name}</span>
                <span className="queue__size">{size(f.size)}</span>
                <button
                  type="button"
                  className="iconbtn"
                  onClick={() => remove(i)}
                  disabled={busy}
                  aria-label={`Remove ${f.name}`}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>

          <div className="actions">
            <button
              type="button"
              className="btn"
              onClick={() => onRun(files)}
              disabled={busy}
              data-state={busy ? "loading" : undefined}
            >
              {busy && <span className="spinner" aria-hidden />}
              {busy ? "Working…" : `Build schedule · ${files.length}`}
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => setFiles([])} disabled={busy}>
              Clear
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function ext(name: string) {
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "file";
}

function size(n: number) {
  return n > 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}
