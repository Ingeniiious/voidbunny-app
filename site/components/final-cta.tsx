import { DitherShader } from "@/components/dither-shader";
import type { ReactNode } from "react";

export function FinalCTA(): ReactNode {
  return (
    <section className="bg-background p-6 sm:p-10 lg:p-14">
      <div className="overflow-hidden rounded-3xl border border-border bg-neutral-50 text-neutral-950 dark:bg-neutral-950 dark:text-neutral-50">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_minmax(0,420px)]">
          <div className="flex min-h-80 flex-col justify-center px-8 py-12 sm:px-12 sm:py-16 lg:border-r lg:border-neutral-200 lg:px-14 lg:py-20 dark:lg:border-neutral-800">
            <h2 className="max-w-md text-3xl font-medium leading-[1.1] tracking-tight sm:text-4xl lg:text-[2.5rem]">
              Leave your laptop at home{" "}
              <span className="text-brand">tomorrow</span>.
            </h2>
            <p className="mt-6 max-w-md text-sm leading-relaxed text-neutral-400 sm:text-base dark:text-neutral-500">
              Voidbunny is free, MIT-licensed open source. Bring any
              Ubuntu box (~€15/mo at Hetzner), run one install command,
              add Voidbunny to your home screen — code from anywhere by
              tonight.
            </p>
            <div className="mt-10">
              <a
                href="#install"
                className="focus-ring inline-flex items-center gap-2 rounded-full bg-brand px-5 py-3.5 font-mono text-xs font-medium uppercase tracking-[0.12em] text-white transition-opacity hover:opacity-90"
              >
                Get the install line
                <span aria-hidden="true">→</span>
              </a>
            </div>
          </div>

          <div className="relative min-h-80 p-2 lg:min-h-90">
            <div className="relative h-full w-full overflow-hidden rounded-2xl border border-neutral-200 dark:border-neutral-800">
              <DitherShader
                variant="cta"
                tone={{ r: 0.7607, g: 0.2549, b: 0.0471 }}
                logo="/logo-512.png"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
