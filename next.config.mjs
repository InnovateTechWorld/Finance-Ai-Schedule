/** @type {import('next').NextConfig} */
const nextConfig = {
  // Uploads arrive at a route handler, not a Server Action, so the
  // serverActions.bodySizeLimit knob does nothing here — it only printed an
  // "Experiments (use with caution)" line on every build.
};
export default nextConfig;
