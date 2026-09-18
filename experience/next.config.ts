import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    // Spline's runtime is large; keep barrel imports from leaking into first load.
    optimizePackageImports: ["framer-motion"],
  },
};

export default nextConfig;
