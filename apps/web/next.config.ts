import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@surveynt/domain", "@surveynt/ui", "@surveynt/db", "@surveynt/property-data", "@surveynt/assistant"],
  serverExternalPackages: ["@neondatabase/serverless"],
};

export default nextConfig;
