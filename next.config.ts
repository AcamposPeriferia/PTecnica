import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/*": ["./fixtures/**/*", "./agent/**/*", "./src/knowledge/**/*"],
  },
};

export default nextConfig;
