"use client";

import { RiMenuLine, RiCloseLine } from "@remixicon/react";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { ThemeSwitch } from "@/components/theme-switch";

const primaryLinks = [
  { label: "Why", href: "#why" },
  { label: "Install", href: "#install" },
  { label: "FAQ", href: "#faq" },
];

const mobileLinks = [
  { label: "Homepage", href: "#main-content" },
  ...primaryLinks,
  { label: "Sign in", href: "/sign-in" },
];

const utilityLinks = [
  { label: "GitHub", href: "https://github.com/Ingeniiious/voidbunny-app" },
  { label: "Install script", href: "/install.sh" },
  { label: "License", href: "https://github.com/Ingeniiious/voidbunny-app/blob/main/LICENSE" },
];

function Logo(): ReactNode {
  return (
    <Link
      href="#main-content"
      className="focus-ring enter inline-flex items-center gap-2 rounded-sm text-foreground"
      aria-label="Voidbunny home"
    >
      <img
        src="/logo-128.webp"
        alt=""
        width={28}
        height={28}
        className="h-7 w-7 shrink-0"
        aria-hidden="true"
      />
      <span className="text-lg font-semibold leading-none tracking-tight">
        Voidbunny
      </span>
    </Link>
  );
}

export function Header(): ReactNode {
  const [isOpen, setIsOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);

  const closeMenu = (): void => setIsOpen(false);

  useEffect(() => {
    const handleScroll = (): void => {
      setIsScrolled(window.scrollY > 8);
    };

    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.body.classList.add("nav-open");

    return () => {
      document.body.style.overflow = originalOverflow;
      document.body.classList.remove("nav-open");
    };
  }, [isOpen]);

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/80">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute bottom-0 left-0 z-10 h-[7px] w-[7px] -translate-x-1/2 translate-y-1/2 border border-border bg-background"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute bottom-0 right-0 z-10 h-[7px] w-[7px] translate-x-1/2 translate-y-1/2 border border-border bg-background"
      />

      <div className="flex h-16 items-center justify-between px-4 sm:h-20 sm:px-6 lg:px-8">
        <Logo />

        <nav
          className={`hidden rounded-full px-2 py-1.5 transition-[background-color] duration-300 ease-out lg:ml-12 lg:flex lg:items-center lg:gap-1 ${
            isScrolled ? "bg-transparent" : "bg-muted"
          }`}
          aria-label="Primary navigation"
        >
          {primaryLinks.map((link, i) => (
            <Link
              key={link.href}
              href={link.href}
              style={{ ["--enter-delay" as string]: `${80 + i * 60}ms` }}
              className="focus-ring enter rounded-full px-4 py-1.5 text-sm font-medium text-foreground transition-colors hover:text-brand"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto hidden items-center gap-4 lg:flex">
          <Link
            href="https://github.com/Ingeniiious/voidbunny-app"
            style={{ ["--enter-delay" as string]: "260ms" }}
            className="focus-ring enter rounded-full px-2 py-1.5 text-sm font-medium text-foreground transition-colors hover:text-brand"
          >
            GitHub
          </Link>
          <Link
            href="/sign-in"
            style={{ ["--enter-delay" as string]: "300ms" }}
            className="focus-ring enter rounded-full px-2 py-1.5 text-sm font-medium text-foreground transition-colors hover:text-brand"
          >
            Sign in
          </Link>
          <Link
            href="/sign-in"
            style={{ ["--enter-delay" as string]: "340ms" }}
            className={`focus-ring enter rounded-full px-5 py-2.5 text-sm font-medium text-foreground transition-[background-color] duration-300 ease-out hover:text-brand ${
              isScrolled ? "bg-transparent" : "bg-muted hover:bg-border"
            }`}
          >
            Claim subdomain
          </Link>
          <ThemeSwitch className="enter" />
        </div>

        <div className="ml-auto flex items-center lg:hidden">
          <button
            type="button"
            style={{ ["--enter-delay" as string]: "180ms" }}
            className="focus-ring enter inline-flex h-10 w-10 items-center justify-center rounded-full text-foreground transition-colors hover:text-brand"
            aria-label={isOpen ? "Close navigation menu" : "Open navigation menu"}
            aria-expanded={isOpen}
            aria-controls="mobile-navigation"
            onClick={() => setIsOpen((open) => !open)}
          >
            {isOpen ? (
              <RiCloseLine className="h-5 w-5" aria-hidden="true" />
            ) : (
              <RiMenuLine className="h-5 w-5" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      <div
        id="mobile-navigation"
        className={`fixed inset-x-0 top-16 z-40 min-h-[calc(100dvh-4rem)] border-t border-border bg-background transition-[opacity,visibility] duration-200 sm:top-20 sm:min-h-[calc(100dvh-5rem)] lg:hidden ${
          isOpen
            ? "visible opacity-100"
            : "invisible pointer-events-none opacity-0"
        }`}
      >
        <div className="min-h-[calc(100dvh-4rem)] px-4 pt-16 sm:min-h-[calc(100dvh-5rem)] sm:px-6 sm:pt-20">
          <nav aria-label="Mobile navigation">
            <ul className="space-y-2">
              {mobileLinks.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="focus-ring block rounded-lg text-4xl font-normal leading-tight tracking-[-0.04em] text-foreground transition-colors hover:text-brand sm:text-5xl"
                    onClick={closeMenu}
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <div className="mt-12 flex flex-col items-start gap-2">
            <p className="text-base font-medium tracking-[-0.02em] text-muted-foreground">
              Project
            </p>
            {utilityLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="focus-ring rounded-md text-base font-normal text-foreground transition-colors hover:text-brand"
                onClick={closeMenu}
              >
                {link.label}
              </Link>
            ))}
          </div>

          <div className="mt-10 flex items-center gap-3 pb-10">
            <ThemeSwitch />
            <span className="text-base text-muted-foreground">
              Toggle theme
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}
