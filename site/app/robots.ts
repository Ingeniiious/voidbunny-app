import type { MetadataRoute } from "next";
import { siteConfig } from "@/lib/metadata";

// /api/ is disallowed for crawl efficiency (just /api/stats — a JSON
// endpoint, no SEO value). /stats is left allowed so crawlers can read its
// page-level <meta robots="noindex"> rather than being blocked at the
// sitemap layer (a blocked URL can still get indexed from inbound links).
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/"],
      },
    ],
    sitemap: `${siteConfig.url}/sitemap.xml`,
    host: siteConfig.url,
  };
}
