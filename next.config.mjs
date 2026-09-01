/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Statements + invoices can be large; the process route streams, but the
    // multipart body still lands in one piece.
    serverActions: { bodySizeLimit: "60mb" },
  },
};
export default nextConfig;
