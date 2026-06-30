"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { RiClipboardLine, RiCheckLine, RiRefreshLine, RiTerminalLine } from "@remixicon/react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface IssuedCode {
  code: string;
  expiresAt: string;
  installCommand: string;
}

export function ClaimCodeIssuer({ remaining }: { remaining: number }) {
  const [issued, setIssued] = useState<IssuedCode | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState<"command" | "code" | null>(null);

  async function generate() {
    setLoading(true);
    try {
      const res = await fetch("/api/subdomain/code", { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as IssuedCode;
      setIssued(data);
      toast.success("Install code ready — paste it on your server within 10 minutes.");
    } catch (err) {
      toast.error("Could not generate code. Try again.");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function copy(kind: "command" | "code", value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      setTimeout(() => setCopied(null), 1600);
    } catch (err) {
      toast.error("Couldn't copy. Try selecting the text manually.");
      console.error(err);
    }
  }

  return (
    <Card className="relative overflow-hidden">
      <CardHeader>
        <CardTitle className="text-lg">One-time install code</CardTitle>
        <CardDescription>
          {remaining} slot{remaining === 1 ? "" : "s"} available. Each generated code can claim one
          subdomain and expires in 10 minutes.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <AnimatePresence mode="wait">
          {issued ? (
            <motion.div
              key="issued"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
              className="flex flex-col gap-4"
            >
              <div className="rounded-lg border border-border bg-muted/40 p-4">
                <div className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                  <RiTerminalLine size={12} />
                  Run on your fresh Ubuntu box
                </div>
                <div className="flex items-start gap-3">
                  <pre className="flex-1 overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs leading-relaxed text-foreground">
                    {issued.installCommand}
                  </pre>
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0 rounded-full"
                    onClick={() => copy("command", issued.installCommand)}
                  >
                    {copied === "command" ? (
                      <RiCheckLine data-icon="inline-start" />
                    ) : (
                      <RiClipboardLine data-icon="inline-start" />
                    )}
                    {copied === "command" ? "Copied" : "Copy"}
                  </Button>
                </div>
              </div>
              <div className="text-xs text-muted-foreground">
                Code expires {new Date(issued.expiresAt).toLocaleTimeString()}. Generate a new one
                anytime — the old one becomes useless.
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="rounded-lg border border-dashed border-border bg-muted/30 p-6 text-center"
            >
              <p className="text-sm text-muted-foreground">
                Click Generate Code to get your install command.
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </CardContent>

      <CardFooter className="justify-end">
        <Button onClick={generate} disabled={loading} className="rounded-full px-5">
          {loading ? (
            <>
              <RiRefreshLine data-icon="inline-start" className="animate-spin" />
              Generating…
            </>
          ) : issued ? (
            <>
              <RiRefreshLine data-icon="inline-start" />
              Generate New Code
            </>
          ) : (
            <>
              <RiTerminalLine data-icon="inline-start" />
              Generate Code
            </>
          )}
        </Button>
      </CardFooter>
    </Card>
  );
}
