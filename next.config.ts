import type { NextConfig } from "next";
const config: NextConfig = {
  output: "standalone",
  devIndicators: false,
  distDir: process.env.HOUSE_OPS_TEST_BUILD_DIR ?? ".next",
  agentRules: false,
  outputFileTracingExcludes: {
    "*": [
      "./.env*",
      "./.private/**",
      "./data/**",
      "./secrets/**",
      "./.venv/**",
      "./tests/**",
      "./dbt/**",
    ],
  },
  serverExternalPackages: ["pdf-parse", "@napi-rs/canvas"],
  experimental: { serverActions: { bodySizeLimit: "22mb" } },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};
export default config;
