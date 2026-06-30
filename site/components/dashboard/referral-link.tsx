"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { RiClipboardLine, RiCheckLine, RiShareLine } from "@remixicon/react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export function ReferralLink({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const url =
    typeof window === "undefined"
      ? `https://voidbunny.xyz/r/${code}`
      : `${window.location.origin.replace(/^https?:\/\/[^/]+$/, "https://voidbunny.xyz")}/r/${code}`;

  async function copy() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    toast.success("Link copied");
    setTimeout(() => setCopied(false), 1600);
  }

  async function share() {
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({
          title: "Voidbunny — free subdomain for your self-hosted box",
          text: "I'm using Voidbunny to host my Claude Code agent on my own server. Grab a free .box.voidbunny.xyz subdomain:",
          url,
        });
      } catch {
        /* user canceled */
      }
    } else {
      copy();
    }
  }

  return (
    <Card className="overflow-hidden">
      <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:gap-4">
        <div className="flex flex-1 items-center gap-3 overflow-hidden rounded-lg border border-border bg-muted/40 px-4 py-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            Your link
          </span>
          <code className="flex-1 truncate font-mono text-sm">{url}</code>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <motion.div whileTap={{ scale: 0.96 }}>
            <Button variant="outline" onClick={copy} className="rounded-full">
              {copied ? (
                <RiCheckLine data-icon="inline-start" />
              ) : (
                <RiClipboardLine data-icon="inline-start" />
              )}
              {copied ? "Copied" : "Copy"}
            </Button>
          </motion.div>
          <motion.div whileTap={{ scale: 0.96 }}>
            <Button onClick={share} className="rounded-full">
              <RiShareLine data-icon="inline-start" />
              Share
            </Button>
          </motion.div>
        </div>
      </CardContent>
    </Card>
  );
}
