import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/*": ["./maestros/**/*", "./solicitudes/**/*"],
  },
};

export default nextConfig;
