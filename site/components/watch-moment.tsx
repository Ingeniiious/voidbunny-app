"use client";

import { useEffect, useState, type ReactNode } from "react";
import { DitherShader } from "@/components/dither-shader";
import DeviceWatch from "@/components/react-bits/device-watch";
import { RiMic2Fill } from "@remixicon/react";

// Full-bleed cinematic section: an Apple Watch frame centered with the
// panel's voice-bridge UI rendered inside it, large display headline,
// no CTA. The "wait, what?" moment that gets screenshotted.
//
// Why voice-bridge on the watch instead of a terminal screenshot: at
// watch size (~16×20rem before scaling) text is illegible, but the
// mic-tap-to-dictate flow IS the realistic watch use case — you tell
// your agent what to do, it does it on the box. The button reads
// instantly and matches the panel's actual mobile/native voice UI.

const BRAND_TONE = { r: 0.92, g: 0.36, b: 0.06 } as const;

function useWatchScale(): number {
  const [scale, setScale] = useState<number>(0.95);
  useEffect(() => {
    const compute = (): void => {
      const w = typeof window === "undefined" ? 1024 : window.innerWidth;
      if (w < 480) setScale(0.6);
      else if (w < 768) setScale(0.78);
      else if (w < 1280) setScale(0.95);
      else setScale(1.15);
    };
    compute();
    window.addEventListener("resize", compute, { passive: true });
    return () => window.removeEventListener("resize", compute);
  }, []);
  return scale;
}

function WatchPanelScreen(): ReactNode {
  // Mock of the panel's voice-bridge UI sized for a watch face: minimal
  // header, big mic button, single-line transcript hint.
  return (
    <div className="relative flex h-full w-full flex-col items-center justify-between bg-black px-3 py-5">
      {/* Top chrome — clock + brand mark */}
      <div className="flex w-full items-center justify-between text-[0.7rem] font-mono text-white/80">
        <span className="tabular-nums">9:41</span>
        <span className="inline-flex items-center gap-1 text-brand">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-brand animate-pulse" />
          <span className="text-[0.6rem] uppercase tracking-[0.14em]">live</span>
        </span>
      </div>

      {/* Mic button — centered, brand orange, soft glow */}
      <div
        className="relative flex items-center justify-center rounded-full"
        style={{
          width: "5rem",
          height: "5rem",
          background:
            "radial-gradient(circle at 30% 30%, #ff8a3d 0%, #ea580c 55%, #b8430a 100%)",
          boxShadow:
            "0 0 0 0.4rem rgba(234, 88, 12, 0.18), 0 0 1.8rem rgba(234, 88, 12, 0.55)",
        }}
      >
        <RiMic2Fill className="h-9 w-9 text-white" />
      </div>

      {/* Transcript hint */}
      <p className="text-center text-[0.7rem] leading-tight text-white/60">
        Tap and tell the agent what to build.
      </p>
    </div>
  );
}

export function WatchMoment(): ReactNode {
  const scale = useWatchScale();

  return (
    <section
      aria-labelledby="watch-heading"
      className="relative isolate overflow-hidden border-b border-border bg-black"
    >
      {/* Brand-tinted dither, low opacity — atmosphere not decoration */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 opacity-35"
      >
        <DitherShader variant="hero" tone={BRAND_TONE} />
      </div>
      {/* Center spotlight gradient that pulls focus toward the watch */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(ellipse 60% 50% at 50% 55%, rgba(234,88,12,0.2) 0%, transparent 60%), linear-gradient(180deg, #000 0%, #050505 100%)",
        }}
      />

      <div className="relative mx-auto flex min-h-[100vh] max-w-6xl flex-col items-center justify-center px-6 py-24 text-center sm:px-10">
        {/* Eyebrow */}
        <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-brand/80">
          works on anything with a browser
        </p>

        {/* Display headline — big, tight, two-line */}
        <h2
          id="watch-heading"
          className="mt-6 max-w-3xl text-5xl font-medium leading-[0.95] tracking-tighter text-white sm:text-7xl lg:text-[6.5rem]"
        >
          From your <span className="text-brand">wrist.</span>
        </h2>
        <p className="mt-6 max-w-xl text-base leading-relaxed text-white/60 sm:text-lg">
          If it loads a webpage, it runs Voidbunny. Tap the mic, tell the
          agent what to ship, watch the commit land while you wait for
          your coffee.
        </p>

        {/* The watch itself */}
        <div className="relative mt-16 flex items-center justify-center">
          {/* Soft brand halo */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute h-[28rem] w-[28rem] rounded-full bg-brand/15 blur-3xl"
          />
          <DeviceWatch scale={scale} autoAnimate>
            <WatchPanelScreen />
          </DeviceWatch>
        </div>

        {/* Sub-tagline below */}
        <p className="mt-16 font-mono text-xs uppercase tracking-[0.24em] text-white/40">
          Yes, even watchOS Safari counts.
        </p>
      </div>
    </section>
  );
}
