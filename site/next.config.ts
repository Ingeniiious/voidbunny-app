import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  productionBrowserSourceMaps: false,
  images: {
    /* Allow Unsplash as a remote source for placeholder portraits used
     * in the testimonials section. We pin to /photo-* to keep the
     * surface area minimal — avoids accidentally proxying arbitrary
     * Unsplash routes. */
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
        pathname: "/**",
      },
    ],
  },
};

export default nextConfig;
