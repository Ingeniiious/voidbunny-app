"use client";

import type { ReactNode } from "react";

// Real framework stack. SVG marks are Simple Icons (CC0) stored in
// /public/brands and rendered via CSS mask-image so each chip paints the
// glyph in Voidbunny's brand orange — `<img src>` would lock in the
// upstream fill we can't re-tint. One color for the whole set keeps the
// marquee feeling like a single product surface instead of a logo zoo.
type Glyph = {
  id: string;
  file: string;
};

const glyphs: Glyph[] = [
  { id: "nextjs",      file: "/brands/nextdotjs.svg"  },
  { id: "react",       file: "/brands/react.svg"      },
  { id: "vite",        file: "/brands/vite.svg"       },
  { id: "typescript",  file: "/brands/typescript.svg" },
  { id: "tailwindcss", file: "/brands/tailwindcss.svg"},
  { id: "node",        file: "/brands/nodedotjs.svg"  },
  { id: "shadcn",      file: "/brands/shadcnui.svg"   },
  { id: "caddy",       file: "/brands/caddy.svg"      },
];

function LogoChip({ glyph }: { glyph: Glyph }): ReactNode {
  // mask-image draws the SVG silhouette; background-color (var(--brand))
  // paints it the same orange used by `.text-brand` elsewhere on the page,
  // and auto-flips between light/dark via the CSS variable.
  return (
    <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-background ring-1 ring-border transition-transform duration-300 hover:scale-105 sm:h-24 sm:w-24">
      <span
        aria-hidden="true"
        title={glyph.id}
        className="block h-10 w-10 sm:h-11 sm:w-11"
        style={{
          backgroundColor: "var(--brand)",
          WebkitMaskImage: `url(${glyph.file})`,
          maskImage: `url(${glyph.file})`,
          WebkitMaskRepeat: "no-repeat",
          maskRepeat: "no-repeat",
          WebkitMaskPosition: "center",
          maskPosition: "center",
          WebkitMaskSize: "contain",
          maskSize: "contain",
        }}
      />
    </div>
  );
}

// Two stacked copies of the glyph list ensure -50% translation lands on the
// start of the duplicate, making the loop seamless.
function MarqueeColumn({
  direction,
  duration,
  glyphSet,
}: {
  direction: "up" | "down";
  duration: string;
  glyphSet: typeof glyphs;
}): ReactNode {
  const animation = direction === "up" ? "marquee-up" : "marquee-down";

  const renderCopy = (key: string): ReactNode => (
    <div key={key} className="flex shrink-0 flex-col items-center gap-4">
      {glyphSet.map((g) => (
        <LogoChip key={g.id} glyph={g} />
      ))}
    </div>
  );

  return (
    <div
      className="flex flex-col items-center gap-4"
      style={{ animation: `${animation} ${duration} linear infinite` }}
    >
      {renderCopy("a")}
      {renderCopy("b")}
    </div>
  );
}

export function LogoMarquee(): ReactNode {
  const colA = glyphs.filter((_, i) => i % 2 === 0);
  const colB = glyphs.filter((_, i) => i % 2 === 1);

  return (
    <div
      className="relative h-full min-h-[360px] w-full overflow-hidden"
      style={{
        maskImage:
          "linear-gradient(to bottom, transparent, black 18%, black 82%, transparent)",
        WebkitMaskImage:
          "linear-gradient(to bottom, transparent, black 18%, black 82%, transparent)",
      }}
    >
      <div className="absolute inset-0 mx-auto grid max-w-[220px] grid-cols-2 place-items-center gap-1 sm:max-w-[260px]">
        <MarqueeColumn direction="up" duration="22s" glyphSet={colA} />
        <MarqueeColumn direction="down" duration="26s" glyphSet={colB} />
      </div>
    </div>
  );
}
