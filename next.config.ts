import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Default 1mb is too small for SOH staging chunks (10k rows/request).
      bodySizeLimit: "4mb",
    },
  },
};

export default nextConfig;
