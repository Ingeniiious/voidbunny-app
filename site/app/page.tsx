import { AutoTune } from "@/components/auto-tune";
import { Community } from "@/components/community";
import { DitherShader } from "@/components/dither-shader";
import { Faq } from "@/components/faq";
import { FinalCTA } from "@/components/final-cta";
import { Footer } from "@/components/footer";
import { Header } from "@/components/header";
import { InstallCopy } from "@/components/install-copy";
import { LogoMarquee } from "@/components/logo-marquee";
import { MultiDevice } from "@/components/multi-device";
import { Preview } from "@/components/preview";
import { Reveal } from "@/components/reveal";
import { SectionCorners } from "@/components/section-corners";
import { Showcase } from "@/components/showcase";
import { SubdomainShowcase } from "@/components/subdomain-showcase";
import { SubscriptionConnect } from "@/components/subscription-connect";
import type { ReactNode } from "react";

export default function HomePage(): ReactNode {
  return (
    <>
      <Header />
      <main id="main-content" className="flex-1">
        <section className="relative border-b border-border">
          <div className="grid grid-cols-1 lg:grid-cols-2">
            <div className="flex min-h-130 flex-col items-center justify-center px-6 py-16 text-center sm:px-10 sm:py-20 lg:min-h-160 lg:items-stretch lg:border-r lg:border-border lg:px-14 lg:py-24 lg:text-left">
              <h1
                style={{ ["--enter-delay" as string]: "380ms" }}
                className="enter text-balance font-semibold leading-[1.02] tracking-[-0.045em] text-foreground lg:font-medium lg:leading-[1.05] lg:tracking-tighter text-[clamp(3rem,10vw,4rem)] xl:text-[clamp(4rem,8vw,5.5rem)]"
              >
                Stop carrying a laptop. Code from{" "}
                <span className="text-brand">anywhere</span>.
              </h1>
              <div
                style={{ ["--enter-delay" as string]: "520ms" }}
                className="enter mt-10 flex flex-col items-center gap-3 lg:items-start"
              >
                <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  Install
                </span>
                <InstallCopy />
                <span className="text-center text-xs text-muted-foreground lg:text-left">
                  Click to copy — runs on any fresh Ubuntu box.
                </span>
              </div>
            </div>

            <div
              style={{ ["--enter-delay" as string]: "200ms" }}
              className="enter-fade relative min-h-80 overflow-hidden lg:min-h-160"
            >
              <DitherShader
                tone={{ r: 0.7607, g: 0.2549, b: 0.0471 }}
                logo="/logo-512.png"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 border-t border-border lg:grid-cols-2">
            <div className="border-b border-border px-6 py-10 sm:px-10 lg:border-b-0 lg:border-r lg:px-14">
              <p
                style={{ ["--enter-delay" as string]: "680ms" }}
                className="enter max-w-sm text-sm leading-relaxed text-muted-foreground sm:text-base"
              >
                <span className="font-medium text-[#d97757]">Claude</span>,{" "}
                <span className="font-medium text-foreground">Codex</span>,
                or{" "}
                <span className="font-medium text-[#3b82f6]">Gemini</span>{" "}
                in your pocket. Free, open source, self-hosted on any
                Ubuntu box you control.
              </p>
            </div>
            <div className="grid grid-cols-3 px-6 py-10 sm:px-10 lg:px-14">
              {[
                { label: "Price", value: "Free" },
                { label: "Setup", value: "1 cmd" },
                { label: "License", value: "MIT" },
              ].map((stat, i) => (
                <div
                  key={stat.label}
                  style={{ ["--enter-delay" as string]: `${740 + i * 80}ms` }}
                  className="enter"
                >
                  <p className="text-xs font-medium tracking-wide text-muted-foreground sm:text-sm">
                    {stat.label}
                  </p>
                  <p className="mt-3 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                    {stat.value}
                  </p>
                </div>
              ))}
            </div>
          </div>
          <SectionCorners />
        </section>

        <Reveal>
          <SubscriptionConnect />
        </Reveal>

        <Reveal>
          <MultiDevice />
        </Reveal>

        <Reveal>
          <section className="relative border-b border-border p-6 sm:p-10 lg:p-14">
            <div className="relative grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-6">
              <article className="flex min-h-90 flex-col justify-between rounded-2xl border border-border bg-background p-6 sm:p-8 lg:min-h-120">
                <h2 className="max-w-md text-2xl font-semibold leading-[1.15] tracking-tight text-foreground sm:text-3xl lg:text-[2rem]">
                  <span className="text-muted-foreground">Built with</span>{" "}
                  tools you already <span className="text-brand">know</span>
                </h2>
                <p className="mt-12 max-w-md text-sm leading-relaxed text-muted-foreground sm:text-base">
                  Next.js, Vite, React, TypeScript and Tailwind on the
                  client. Node and Caddy on the server. shadcn/ui in the
                  components. No proprietary runtime, no daemon phoning
                  home — your box, your shell, your code.
                </p>
              </article>
              <div className="relative min-h-90 overflow-hidden rounded-2xl bg-muted lg:min-h-120">
                <LogoMarquee />
              </div>
              <div
                aria-hidden="true"
                className="pointer-events-none absolute top-0 bottom-0 hidden w-px -translate-x-1/2 bg-border lg:block"
                style={{ left: "50%" }}
              />
            </div>
            <SectionCorners />
          </section>
        </Reveal>

        {/* Hidden temporarily. To restore: uncomment the <AutoTune /> and
            the #auth ("Sign in the way you already do") section below. */}
        {false && (
          <>
            <Reveal>
              <AutoTune />
            </Reveal>

            <Reveal>
              <section
                id="auth"
                className="relative border-b border-border p-6 sm:p-10 lg:p-14"
              >
                <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:items-center lg:gap-14">
                  <div className="flex flex-col justify-center">
                    <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                      No API keys required
                    </span>
                    <h2 className="mt-3 text-2xl font-semibold leading-[1.1] tracking-tight text-foreground sm:text-3xl lg:text-[2.5rem]">
                      Sign in the way you{" "}
                      <span className="text-brand">already do</span>
                    </h2>
                    <p className="mt-5 max-w-md text-sm leading-relaxed text-muted-foreground sm:text-base">
                      Every agent CLI ships with a real OAuth flow. Run{" "}
                      <code className="font-mono text-foreground">claude</code>,{" "}
                      <code className="font-mono text-foreground">codex</code>, or{" "}
                      <code className="font-mono text-foreground">gemini</code>{" "}
                      inside Voidbunny once and a browser tab opens to
                      the provider's normal login. Every prompt then counts
                      against your{" "}
                      <span className="font-medium text-foreground">Claude Pro / Max</span>,{" "}
                      <span className="font-medium text-foreground">ChatGPT Plus / Pro</span>, or{" "}
                      <span className="font-medium text-foreground">Gemini Advanced</span>{" "}
                      plan.
                    </p>
                    <p className="mt-4 max-w-md text-sm leading-relaxed text-muted-foreground sm:text-base">
                      No keys on disk, no double-billing, revocable instantly
                      from the provider's dashboard. API keys still work as a
                      fallback if you blow through quota.
                    </p>
                  </div>

                  <div className="relative rounded-2xl border border-border bg-neutral-950 p-5 font-mono text-[12px] leading-relaxed text-neutral-300 shadow-sm sm:p-6 sm:text-[13px] lg:p-7">
                    <div className="mb-5 flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full bg-neutral-700" aria-hidden="true" />
                      <span className="h-2.5 w-2.5 rounded-full bg-neutral-700" aria-hidden="true" />
                      <span className="h-2.5 w-2.5 rounded-full bg-neutral-700" aria-hidden="true" />
                      <span className="ml-3 text-[10px] uppercase tracking-[0.14em] text-neutral-500">
                        voidbunny@ubuntu: ~
                      </span>
                    </div>

                    <div className="space-y-5">
                      {[
                        {
                          cmd: "claude",
                          via: "claude.ai",
                          plan: "Claude Pro / Max",
                        },
                        {
                          cmd: "codex",
                          via: "chatgpt.com",
                          plan: "ChatGPT Plus / Pro",
                        },
                        {
                          cmd: "gemini",
                          via: "Google account",
                          plan: "Gemini Advanced",
                        },
                      ].map((row) => (
                        <div key={row.cmd}>
                          <p className="text-neutral-100">
                            <span className="text-brand">$ </span>
                            {row.cmd}
                          </p>
                          <p className="text-neutral-500">
                            ✻ Opening browser to sign in…
                          </p>
                          <p className="text-emerald-400">
                            ✓ Signed in via {row.via}
                          </p>
                          <p className="text-neutral-500">
                            {"  "}Plan:{" "}
                            <span className="text-neutral-100">{row.plan}</span>
                            {"  ·  No API key configured"}
                          </p>
                        </div>
                      ))}

                      <p className="text-neutral-100">
                        <span className="text-brand">$ </span>
                        <span
                          className="inline-block animate-pulse"
                          aria-hidden="true"
                        >
                          ▮
                        </span>
                      </p>
                    </div>
                  </div>
                </div>
                <SectionCorners />
              </section>
            </Reveal>
          </>
        )}

        <Reveal>
          <SubdomainShowcase />
        </Reveal>

        <Reveal>
          <Preview />
        </Reveal>
        {/* Hidden temporarily. Restore by removing the `false &&` wrap. */}
        {false && (
          <Reveal>
            <Showcase />
          </Reveal>
        )}
        <Community />
        <Reveal>
          <Faq />
        </Reveal>
      </main>
      <Reveal>
        <FinalCTA />
      </Reveal>
      <Footer />
    </>
  );
}
