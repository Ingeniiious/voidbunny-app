"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { RiArrowRightLine } from "@remixicon/react";
import { SectionCorners } from "@/components/section-corners";
import DecryptedText from "@/components/react-bits/decrypted-text";

const SUBDOMAINS: ReadonlyArray<string> = [
  "alice",
  "thumper",
  "midnight",
  "warren",
  "cosmos",
  "atelier",
  "prism",
  "hackday",
  "atlas",
  "weekend",
  "briar",
  "lab",
];

const SHUFFLE_MS = 2600;

export function SubdomainShowcase(): ReactNode {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const t = window.setInterval(() => {
      setIndex((i) => (i + 1) % SUBDOMAINS.length);
    }, SHUFFLE_MS);
    return () => window.clearInterval(t);
  }, []);

  const current = SUBDOMAINS[index] ?? SUBDOMAINS[0]!;

  return (
    <section
      id="install"
      className="relative border-b border-border"
    >
      <div className="px-6 pb-16 pt-14 sm:px-10 sm:pb-20 sm:pt-20 lg:px-14 lg:pb-24 lg:pt-24">
        <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Free subdomains
        </span>
        <h2 className="mt-3 max-w-2xl text-3xl font-medium leading-[1.05] tracking-tighter text-foreground sm:text-4xl lg:text-[3.5rem]">
          Bring the box. We bring the <span className="text-brand">URL</span>.
        </h2>
        <p className="mt-5 max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">
          Claim a free <code className="font-mono text-foreground">name.voidbunny.xyz</code>, point it at your server&apos;s
          IP, and Caddy plus Let&apos;s Encrypt give you HTTPS in under a minute.
          Your phone-driven sandbox lives at a real, shareable URL on day one.
        </p>

        {/* Animated showcase. `.voidbunny.xyz` is the anchor — site heading
            font, fixed position. The subdomain to its left decrypts in
            brand orange (Fliege Mono) inside a fixed-width box sized for
            the longest example, so cycling through different lengths can't
            push the main domain around. */}
        <div className="mt-12 sm:mt-16 lg:mt-20">
          <div className="flex items-baseline whitespace-nowrap text-2xl font-medium tracking-tighter text-foreground sm:text-4xl lg:text-6xl xl:text-7xl">
            <span className="inline-block w-[9ch] overflow-hidden text-right font-mono font-normal tracking-normal text-brand">
              <DecryptedText
                key={current}
                text={current}
                animateOn="view"
                speed={42}
                maxIterations={14}
                sequential={false}
                useOriginalCharsOnly={false}
                characters="abcdefghijklmnopqrstuvwxyz0123456789-"
                className="text-brand"
                encryptedClassName="text-brand/55"
              />
            </span>
            <span aria-hidden="true">.voidbunny.xyz</span>
            <span className="sr-only">.voidbunny.xyz — your free subdomain</span>
          </div>
          <p className="mt-6 max-w-md font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            This is your subdomain to host — and yours, and yours.
          </p>

          <div className="mt-10 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:gap-4">
            <Link
              href="/sign-in"
              className="focus-ring inline-flex items-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-sm font-semibold text-background transition-opacity hover:opacity-90"
            >
              Claim your subdomain
              <RiArrowRightLine size={16} aria-hidden="true" />
            </Link>
            <span className="text-xs text-muted-foreground">
              Free, one-time email sign-in via libraryyy.com — no password.
            </span>
          </div>
        </div>
      </div>
      <SectionCorners />
    </section>
  );
}
