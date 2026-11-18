import type { NextConfig } from "next";

// Di Coolify (Dockerfile) type-check dilewati biar build cepat;
// pengecekan TypeScript jalan di GitHub Actions (.github/workflows/typecheck.yml).
const skipChecks = process.env.SKIP_TYPECHECK === "1";

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: { ignoreBuildErrors: skipChecks },
  allowedDevOrigins: ["14.14.14.150"],
  experimental: {
    serverActions: {
      // Default 1mb is too small for SOH staging chunks (10k rows/request).
      bodySizeLimit: "4mb",
    },
  },
};

export default nextConfig;
