"use client";

import { useEffect, useState, type ReactNode } from "react";
import { SectionCorners } from "@/components/section-corners";
import { DitherShader } from "@/components/dither-shader";
import Device from "@/components/react-bits/device";
import DeviceLaptop from "@/components/react-bits/device-laptop";
import DeviceTablet from "@/components/react-bits/device-tablet";

// "Run it anywhere" showcase. Apple-style product lineup: iPhone, iPad,
// MacBook in a single bottom-baselined row, no rotation. Sized so the
// screenshot inside each frame is actually readable, not a thumbnail.
// Each Device keeps its own subtle auto-drift so the lineup feels alive
// without being chaotic.
//
// Screenshots: each frame gets a capture at its native aspect — laptop
// uses /screenshots/panel-desktop.webp (16:10, full 2×2 grid), tablet
// uses /screenshots/panel-tablet.webp (3:4 portrait, sidebar + grid),
// phone uses /screenshots/panel-mobile.webp (iPhone-tall, single active
// pane with the KeyBar visible). Source mock at frontend/?mock=1.

const BRAND_TONE = { r: 0.92, g: 0.36, b: 0.06 } as const;

// Native dimensions of each device frame at scale=1 (from the react-bits
// components themselves). Used to compute the post-scale bounding box so
// flex layout sees the *scaled* size, not the 1× one.
const SIZES = {
  laptop: { w: 64, h: 42 },     // 16:10 screen + chin + base bar
  tablet: { w: 36, h: 48 },     // 3:4 portrait
  phone:  { w: 35.6, h: 72.2 }, // iPhone-tall
} as const;

type Scales = { laptop: number; tablet: number; phone: number };

function useDeviceScales(): Scales {
  const [scales, setScales] = useState<Scales>({
    laptop: 0.45, tablet: 0.30, phone: 0.28,
  });

  useEffect(() => {
    const compute = (): void => {
      const w = typeof window === "undefined" ? 1024 : window.innerWidth;
      // Each row sums to ≤ container width (incl. gaps). Phone gets the
      // largest scale relative to its real-world size because its tall
      // 9:19.5 aspect means it'd otherwise read as a sliver between the
      // wider tablet and laptop.
      if (w < 480) {
        setScales({ laptop: 0.16, tablet: 0.12, phone: 0.14 });
      } else if (w < 768) {
        setScales({ laptop: 0.24, tablet: 0.18, phone: 0.20 });
      } else if (w < 1280) {
        setScales({ laptop: 0.42, tablet: 0.30, phone: 0.28 });
      } else {
        setScales({ laptop: 0.55, tablet: 0.38, phone: 0.34 });
      }
    };
    compute();
    window.addEventListener("resize", compute, { passive: true });
    return () => window.removeEventListener("resize", compute);
  }, []);

  return scales;
}

function PanelScreenshot({ src, alt }: { src: string; alt: string }): ReactNode {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className="h-full w-full object-cover object-top"
      draggable={false}
    />
  );
}

// Wrap a Device frame in a box whose layout size matches the scaled
// bounding box. Without this `transform: scale()` shrinks pixels but
// reserves the original 1× footprint, leaving huge gaps in the flex row.
function DeviceSlot({
  scale,
  size,
  className,
  children,
}: {
  scale: number;
  size: { w: number; h: number };
  className?: string;
  children: ReactNode;
}): ReactNode {
  return (
    <div
      className={className}
      style={{
        width: `${size.w * scale}rem`,
        height: `${size.h * scale}rem`,
        flexShrink: 0,
      }}
    >
      <div
        style={{
          width: `${size.w}rem`,
          height: `${size.h}rem`,
          transformOrigin: "top left",
          transform: `scale(${scale})`,
        }}
      >
        {children}
      </div>
    </div>
  );
}

export function MultiDevice(): ReactNode {
  const { laptop, tablet, phone } = useDeviceScales();

  return (
    <section
      aria-labelledby="anywhere-heading"
      className="relative overflow-hidden border-b border-border bg-background"
    >
      {/* Ambient dither, brand-orange tinted — same shader as the hero
          but at lower opacity so it doesn't fight the devices. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-0 opacity-40"
      >
        <DitherShader variant="hero" tone={BRAND_TONE} />
      </div>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-0 bg-gradient-to-b from-background/40 via-transparent to-background/80"
      />

      <div className="relative px-6 py-10 sm:px-10 sm:py-14 lg:px-14 lg:py-16">
        <div className="max-w-3xl">
          <h2
            id="anywhere-heading"
            className="text-3xl font-medium leading-[1.05] tracking-tighter text-foreground sm:text-4xl lg:text-[3.25rem]"
          >
            Same shell.{" "}
            <span className="text-brand">Every screen.</span>
          </h2>
          <p className="mt-6 max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            Your real tmux session, your real git checkout, your real agent
            CLIs — served from your box to whatever's in your hand. Open it
            on your phone at the gym, on a borrowed laptop in a café, on a
            tablet on the couch. Nothing syncs because nothing needs to.
          </p>
        </div>

        {/* Apple-style lineup. Flex row, bottom-baselined, centered, no
            rotation. Each frame's scale is computed so the *whole lineup*
            fits the available width at every breakpoint. */}
        <div className="relative mt-10 sm:mt-14 lg:mt-16">
          {/* Soft brand glow behind the lineup */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute left-1/2 top-1/2 h-[70%] w-[70%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand/10 blur-3xl"
          />

          <div className="relative flex items-end justify-center gap-3 sm:gap-5 lg:gap-8">
            {/* iPhone — left, smallest device but tallest aspect */}
            <DeviceSlot scale={phone} size={SIZES.phone}>
              <Device autoAnimate>
                <PanelScreenshot
                  src="/screenshots/panel-mobile.webp"
                  alt="Voidbunny on iPhone — Codex session with the KeyBar visible."
                />
              </Device>
            </DeviceSlot>

            {/* iPad — middle, portrait */}
            <DeviceSlot scale={tablet} size={SIZES.tablet}>
              <DeviceTablet autoAnimate>
                <PanelScreenshot
                  src="/screenshots/panel-tablet.webp"
                  alt="Voidbunny on iPad — sidebar plus a 2×2 grid of agents."
                />
              </DeviceTablet>
            </DeviceSlot>

            {/* MacBook — right, the visual anchor with the most detail */}
            <DeviceSlot scale={laptop} size={SIZES.laptop}>
              <DeviceLaptop autoAnimate>
                <PanelScreenshot
                  src="/screenshots/panel-desktop.webp"
                  alt="Voidbunny on MacBook — four panes in grid mode: Claude Code, Codex, Gemini, Brave."
                />
              </DeviceLaptop>
            </DeviceSlot>
          </div>
        </div>

        {/* Tagline strip below the lineup — three short callouts. */}
        <div className="relative mt-8 grid grid-cols-1 gap-3 text-sm sm:mt-10 sm:grid-cols-3 sm:gap-6">
          {[
            { label: "Phone", body: "On-call from anywhere there's signal." },
            { label: "Tablet", body: "Couch coding with the sidebar open." },
            { label: "Laptop", body: "Borrowed machine in a café? Same shell." },
          ].map((item) => (
            <div
              key={item.label}
              className="flex items-baseline gap-3 border-t border-border/60 pt-4"
            >
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-brand">
                {item.label}
              </span>
              <span className="text-muted-foreground">{item.body}</span>
            </div>
          ))}
        </div>
      </div>
      <SectionCorners />
    </section>
  );
}
