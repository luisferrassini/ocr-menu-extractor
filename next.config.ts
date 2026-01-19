import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  basePath: "/ocr-menu-extractor",
  images: {
    unoptimized: true,
  },
  trailingSlash: true,
};

export default nextConfig;
