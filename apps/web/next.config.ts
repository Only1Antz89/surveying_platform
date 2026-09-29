import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@fieldnote/domain", "@fieldnote/ui", "@fieldnote/db"],
  serverExternalPackages: ["@neondatabase/serverless"],
};

export default nextConfig;
