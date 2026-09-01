/**
 * The generate half of the flow: schedule JSON → real .xlsx (sandbox) →
 * .pdf preview (converter). Emits progress as it goes.
 */
import type { AgentEvent } from "./events";
import type { Schedule } from "./schema";
import { buildXlsxScript, OUTPUT_NAME } from "./xlsx";
import { exec, download, sandboxConfigured } from "./sandbox";
import { convert, converterConfigured } from "./converter";
import { put, type Session } from "./store";

export async function generateArtifacts(
  session: Session,
  schedule: Schedule,
  emit: (e: AgentEvent) => void,
): Promise<void> {
  session.schedule = schedule;
  put(session);
  emit({ type: "schedule", schedule });

  if (!sandboxConfigured()) {
    emit({
      type: "error",
      message: "Code sandbox not configured — the schedule is on screen, but no .xlsx was produced.",
      fatal: false,
    });
    emit({ type: "artifacts", xlsx: false, pdf: false });
    return;
  }

  emit({ type: "stage", stage: "build", label: "Writing the FIRS workbook" });
  emit({ type: "tool", name: "execute_code", detail: `openpyxl → ${OUTPUT_NAME}`, status: "start" });

  let xlsx: Buffer | undefined;
  try {
    const result = await exec(buildXlsxScript(schedule), session.sandboxSession);
    session.sandboxSession = result.session_id || session.sandboxSession;

    if (result.stderr?.trim()) {
      emit({ type: "log", text: lastLine(result.stderr), tone: "warn" });
    }
    const file =
      result.files.find((f) => f.name === OUTPUT_NAME) ??
      result.files.find((f) => f.name.endsWith(".xlsx"));
    if (!file) {
      throw new Error(
        result.stderr?.trim()
          ? `The workbook script failed: ${lastLine(result.stderr)}`
          : "The sandbox ran but produced no workbook.",
      );
    }
    xlsx = await download(session.sandboxSession!, file.id);
    session.xlsx = xlsx;
    put(session);
    emit({
      type: "artifact",
      kind: "xlsx",
      name: OUTPUT_NAME,
      mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      data: xlsx.toString("base64"),
    });
    emit({
      type: "tool",
      name: "execute_code",
      detail: `${OUTPUT_NAME} · ${kb(xlsx.byteLength)} · ${schedule.rows.length} rows`,
      status: "ok",
    });
  } catch (e) {
    emit({ type: "tool", name: "execute_code", detail: (e as Error).message, status: "fail" });
    emit({ type: "error", message: (e as Error).message, fatal: false });
    emit({ type: "artifacts", xlsx: false, pdf: false });
    return;
  }

  // Preview is a nicety. Losing it must never cost the user their workbook.
  emit({ type: "stage", stage: "preview", label: "Rendering a preview" });
  if (!converterConfigured()) {
    emit({ type: "log", text: "Converter not configured — download the .xlsx to view it.", tone: "warn" });
    emit({ type: "artifacts", xlsx: true, pdf: false });
    return;
  }
  emit({ type: "tool", name: "convert_file", detail: "xlsx → pdf", status: "start" });
  try {
    const pdf = await convert(
      { name: OUTPUT_NAME, bytes: xlsx, type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
      "pdf",
    );
    session.pdf = pdf;
    put(session);
    emit({
      type: "artifact",
      kind: "pdf",
      name: OUTPUT_NAME.replace(/\.xlsx$/, ".pdf"),
      mime: "application/pdf",
      data: pdf.toString("base64"),
    });
    emit({ type: "tool", name: "convert_file", detail: `preview.pdf · ${kb(pdf.byteLength)}`, status: "ok" });
    emit({ type: "artifacts", xlsx: true, pdf: true });
  } catch (e) {
    session.pdf = undefined;
    put(session);
    emit({ type: "tool", name: "convert_file", detail: (e as Error).message, status: "fail" });
    emit({ type: "log", text: `No inline preview: ${(e as Error).message}`, tone: "warn" });
    emit({ type: "artifacts", xlsx: true, pdf: false });
  }
}

function lastLine(s: string): string {
  const lines = s.trim().split("\n").filter(Boolean);
  return lines[lines.length - 1]?.slice(0, 300) ?? "";
}

function kb(n: number) {
  return `${(n / 1024).toFixed(0)} KB`;
}
