import { get } from "@/lib/store";
import { OUTPUT_NAME } from "@/lib/xlsx";

export const runtime = "nodejs";

export async function GET(req: Request, ctx: { params: Promise<{ sid: string; kind: string }> }) {
  const { sid, kind } = await ctx.params;
  const session = get(sid);
  if (!session) return new Response("Session expired.", { status: 410 });

  const wantsDownload = new URL(req.url).searchParams.get("download") === "1";

  if (kind === "xlsx") {
    if (!session.xlsx) return new Response("No workbook for this session.", { status: 404 });
    return file(
      session.xlsx,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      OUTPUT_NAME,
      true,
    );
  }
  if (kind === "pdf") {
    if (!session.pdf) return new Response("No preview for this session.", { status: 404 });
    return file(session.pdf, "application/pdf", OUTPUT_NAME.replace(/\.xlsx$/, ".pdf"), wantsDownload);
  }
  return new Response("Unknown artifact.", { status: 404 });
}

function file(bytes: Buffer, type: string, name: string, attach: boolean) {
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": type,
      "content-length": String(bytes.byteLength),
      "content-disposition": `${attach ? "attachment" : "inline"}; filename="${name}"`,
      "cache-control": "no-store",
    },
  });
}
