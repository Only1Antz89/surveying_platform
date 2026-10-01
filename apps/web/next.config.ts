import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@surveynt/domain", "@surveynt/ui", "@surveynt/db"],
  serverExternalPackages: ["@neondatabase/serverless"],
};

export default nextConfig;
