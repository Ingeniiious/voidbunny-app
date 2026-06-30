"use client";

import { SectionCorners } from "@/components/section-corners";
import Device from "@/components/react-bits/device";
import { useEffect, useState, type ReactNode } from "react";

const FEATURES: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: "Same shell, anywhere",
    body: "A real terminal hooked to a real PTY on your box. Run the agent CLIs, edit dotfiles, tail logs — nothing's emulated.",
  },
  {
    title: "Three agents, one app",
    body: "Claude Code, Codex, Gemini — switch per project or use whichever one's on a streak. Sign in with the subscription account for each; no API keys needed.",
  },
  {
    title: "PWA with Web Push",
    body: "Add Voidbunny to your Home Screen and it behaves like a native app — including push when long agent tasks finish.",
  },
];

export function Preview(): ReactNode {
  return (
    <section
      aria-labelledby="preview-heading"
      className="relative border-b border-border"
    >
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_minmax(0,360px)]">
        <div className="flex flex-col justify-center px-6 py-16 sm:px-10 sm:py-20 lg:border-r lg:border-border lg:px-14 lg:py-24">
          <h2
            id="preview-heading"
            className="text-3xl font-medium leading-[1.05] tracking-tighter text-foreground sm:text-4xl lg:text-[3rem]"
          >
            See Voidbunny on your{" "}
            <span className="text-brand">phone</span>
          </h2>
          <p className="mt-6 max-w-md text-sm leading-relaxed text-muted-foreground sm:text-base">
            Three agents, a real terminal, the same git checkout you&rsquo;d
            have over SSH — sitting on a box you fully control, opening from
            your home screen like a native app.
          </p>

          <ul className="mt-10 space-y-6">
            {FEATURES.map((feat) => (
              <li key={feat.title} className="flex gap-4">
                <span
                  aria-hidden="true"
                  className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-brand"
                />
                <div>
                  <p className="text-base font-medium leading-tight tracking-tight text-foreground sm:text-lg">
                    {feat.title}
                  </p>
                  <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
                    {feat.body}
                  </p>
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-12 flex flex-wrap items-center gap-4">
            <a
              href="#install"
              className="focus-ring inline-flex items-center gap-2 rounded-full bg-brand px-5 py-3.5 font-mono text-xs font-medium uppercase tracking-[0.12em] text-white transition-opacity hover:opacity-90"
            >
              Install on your box
              <span aria-hidden="true">→</span>
            </a>
            <a
              href="https://github.com/Ingeniiious/voidbunny-app"
              className="focus-ring inline-flex items-center gap-2 rounded-full px-2 py-3 font-mono text-xs font-medium uppercase tracking-[0.12em] text-foreground transition-colors hover:text-brand"
            >
              Source on GitHub
              <span aria-hidden="true">↗</span>
            </a>
          </div>
        </div>

        <div className="relative flex items-center justify-center overflow-hidden px-6 py-12 sm:px-10 sm:py-16 lg:px-0 lg:py-20">
          <DeviceFrame />
        </div>
      </div>
      <SectionCorners />
    </section>
  );
}

function DeviceFrame(): ReactNode {
  // Half the previous size: the Device wraps the screenshot in a real phone
  // body, brings the parallax-on-hover, and the screen aspect matches the
  // 1290×2796 source almost exactly so the screenshot fills it cleanly.
  const [scale, setScale] = useState<number>(0.32);

  useEffect(() => {
    const compute = (): void => {
      if (typeof window === "undefined") return;
      const w = window.innerWidth;
      if (w < 480) setScale(0.22);
      else if (w < 768) setScale(0.28);
      else if (w < 1280) setScale(0.32);
      else setScale(0.36);
    };
    compute();
    window.addEventListener("resize", compute, { passive: true });
    return () => window.removeEventListener("resize", compute);
  }, []);

  // Unscaled Device is 35.6rem × 72.2rem (= 569.6 × 1155.2 at 16px root).
  // Wrap in a container sized to the visible (scaled) box so the section
  // doesn't blow up vertically.
  const visibleWidth = `${35.6 * scale}rem`;
  const visibleHeight = `${72.2 * scale}rem`;

  return (
    <div
      className="relative flex items-center justify-center"
      style={{ width: visibleWidth, height: visibleHeight }}
    >
      <div
        aria-hidden="true"
        className="absolute -inset-12 -z-10 rounded-[64px] bg-brand/10 blur-3xl"
      />
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <Device scale={scale} autoAnimate enableRotate rotateStrength={3}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/screenshots/panel-mobile.webp"
            alt="Voidbunny running on iPhone — Claude and Codex sessions stacked in the panel."
            className="h-full w-full object-cover object-top"
            draggable={false}
          />
        </Device>
      </div>
    </div>
  );
}
