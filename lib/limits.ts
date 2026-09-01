/**
 * Upload limits, shared by the dropzone and the route that receives it — so
 * the UI never promises a size the platform will refuse.
 *
 * `NEXT_PUBLIC_VERCEL_ENV` is injected by Vercel at build time and is readable
 * in the browser; `VERCEL` is server-only. Either one means we are subject to
 * the 4.5 MB serverless request-body cap.
 */
const ON_VERCEL =
  Boolean(process.env.VERCEL) || Boolean(process.env.NEXT_PUBLIC_VERCEL_ENV);

export const MAX_FILES = 20;
export const MAX_FILE_BYTES = ON_VERCEL ? 4 * 1024 * 1024 : 50 * 1024 * 1024;
export const MAX_TOTAL_BYTES = ON_VERCEL ? 4 * 1024 * 1024 : 120 * 1024 * 1024;
export const HOSTED = ON_VERCEL;

export function mb(n: number): string {
  const value = n / 1_048_576;
  return `${value < 10 ? value.toFixed(1) : value.toFixed(0)} MB`;
}
