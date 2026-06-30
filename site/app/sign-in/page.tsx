import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { DitherShader } from "@/components/dither-shader";

export const metadata: Metadata = {
  title: "Sign in — Voidbunny",
  robots: { index: false, follow: false },
};

const DEFAULT_NEXT = "/dashboard";

function safeNext(value: string | string[] | undefined): string {
  if (typeof value !== "string") return DEFAULT_NEXT;
  if (!value.startsWith("/") || value.startsWith("//")) return DEFAULT_NEXT;
  if (/[\x00-\x1f\x7f]/.test(value)) return DEFAULT_NEXT;
  return value;
}

interface PageProps {
  searchParams: Promise<{ next?: string | string[] }>;
}

export default async function SignInPage({
  searchParams,
}: PageProps): Promise<ReactNode> {
  const params = await searchParams;
  const next = safeNext(params.next);
  const continueHref = `/auth/sign-in?next=${encodeURIComponent(next)}`;

  return (
    <main
      className="relative grid min-h-dvh place-items-center overflow-hidden bg-background"
      style={{
        paddingLeft: "max(1.5rem, env(safe-area-inset-left))",
        paddingRight: "max(1.5rem, env(safe-area-inset-right))",
        paddingTop: "max(1.5rem, env(safe-area-inset-top))",
        paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))",
      }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-90"
      >
        <DitherShader
          tone={{ r: 0.7607, g: 0.2549, b: 0.0471 }}
        />
      </div>

      <div className="relative z-10 flex w-full max-w-sm flex-col">
        <div className="rounded-xl border border-border bg-background/95 shadow-lg backdrop-blur supports-backdrop-filter:bg-background/80">
          <div className="flex flex-col gap-2 px-6 pt-6 pb-4 text-center">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              Welcome back
            </h1>
            <p className="text-sm text-muted-foreground">
              Sign in to manage your Voidbunny subdomains
            </p>
          </div>

          <div className="flex flex-col gap-4 px-6 pb-6">
            <Link
              href={continueHref}
              className="focus-ring inline-flex h-10 w-full items-center justify-center rounded-md bg-foreground text-sm font-semibold tracking-wide text-background transition-opacity hover:opacity-90"
            >
              Continue with email
            </Link>
            <p className="text-center text-xs text-muted-foreground">
              We email you a one-time code via{" "}
              <span className="font-medium text-foreground">libraryyy.com</span>{" "}
              — no password to remember.
            </p>
            <p className="text-center text-xs text-muted-foreground">
              New to Voidbunny? Continue with email — we'll create your
              account on first sign-in.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
