import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { StatsDashboard } from "@/components/stats-dashboard";

// Pre-launch: page is reachable by direct URL but invisible to search and
// not linked from the nav. Flip robots to index:true + add a Header link
// once star count crosses the social-proof threshold (~50★).
export const metadata: Metadata = {
  title: "Stats — Voidbunny",
  description:
    "Live Voidbunny growth metrics — GitHub stars, real-world installs, recent activity.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#000000",
};

export default function StatsPage(): ReactNode {
  return <StatsDashboard />;
}
