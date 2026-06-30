import type { MetadataRoute } from "next";
import { siteConfig } from "@/lib/metadata";

// Sitemap is intentionally single-entry: voidbunny.xyz is a one-page site.
// /stats is omitted because its <meta robots="noindex"> excludes it from
// search; the install/showcase/faq sections are anchors on / and don't get
// separate sitemap entries (Google ignores #fragments anyway).
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: siteConfig.url,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}
