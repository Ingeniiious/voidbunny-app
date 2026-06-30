import type { ReactNode } from "react";

type FooterLink = { label: string; href: string };

const linkColumns: ReadonlyArray<{
  label?: string;
  items: ReadonlyArray<FooterLink>;
}> = [
  {
    label: "Voidbunny",
    items: [
      { label: "Home", href: "#main-content" },
      { label: "Why", href: "#why" },
      { label: "Install", href: "#install" },
      { label: "FAQ", href: "#faq" },
      { label: "GitHub", href: "https://github.com/Ingeniiious/voidbunny-app" },
      { label: "License", href: "https://github.com/Ingeniiious/voidbunny-app/blob/main/LICENSE" },
    ],
  },
  {
    label: "Resources",
    items: [
      { label: "Install script", href: "/install.sh" },
      { label: "Hardening guide", href: "https://github.com/Ingeniiious/voidbunny-app#security" },
      { label: "Free subdomain", href: "#subdomain" },
      { label: "Docker Compose", href: "https://github.com/Ingeniiious/voidbunny-app#docker" },
      { label: "Sponsor", href: "https://github.com/sponsors/Ingeniiious" },
      { label: "Roadmap", href: "https://github.com/Ingeniiious/voidbunny-app/issues" },
      { label: "Cloud (coming soon)", href: "#faq" },
    ],
  },
  {
    items: [
      { label: "Indie devs", href: "#why" },
      { label: "On-call engineers", href: "#why" },
      { label: "Mobile coders", href: "#why" },
      { label: "Tinkerers", href: "#why" },
    ],
  },
];

export function Footer(): ReactNode {
  return (
    <section className="bg-background p-3 sm:p-4 lg:p-6">
      <div className="relative overflow-hidden rounded-3xl bg-neutral-950! px-5 py-8 text-neutral-100! sm:px-8 sm:py-10 lg:px-10 lg:py-12 dark:bg-neutral-50! dark:text-neutral-900!">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-[auto_1fr_auto] lg:gap-16">
          <div>
            <a
              href="#main-content"
              className="focus-ring inline-flex items-center gap-2 rounded-sm text-sm text-neutral-100 transition-colors hover:text-brand dark:text-neutral-900 dark:hover:text-brand"
            >
              Back to top
              <span aria-hidden="true">↑</span>
            </a>
          </div>

          <nav
            aria-label="Footer"
            className="grid grid-cols-2 gap-x-8 gap-y-10 sm:grid-cols-3 lg:gap-x-12"
          >
            {linkColumns.map((column, i) => (
              <div key={column.label ?? `col-${i}`}>
                {column.label ? (
                  <p className="mb-5 text-sm text-neutral-500 dark:text-neutral-500">
                    {column.label}
                  </p>
                ) : (
                  <p
                    className="mb-5 text-sm text-neutral-500 dark:text-neutral-500"
                    aria-hidden="true"
                  >
                    &nbsp;
                  </p>
                )}
                <ul className="space-y-3">
                  {column.items.map((item) => (
                    <li key={item.label}>
                      <a
                        href={item.href}
                        className="focus-ring rounded-sm text-sm text-neutral-100 transition-colors hover:text-brand dark:text-neutral-900 dark:hover:text-brand"
                      >
                        {item.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>

          <div className="lg:pt-px">
            <a
              href="https://github.com/Ingeniiious/voidbunny-app/issues/new"
              className="focus-ring inline-flex items-center gap-2 rounded-full border border-neutral-700 px-5 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-neutral-100 transition-colors hover:border-brand hover:text-brand dark:border-neutral-300 dark:text-neutral-900 dark:hover:border-brand dark:hover:text-brand"
            >
              Open an issue
              <span aria-hidden="true">→</span>
            </a>
          </div>
        </div>

        <div className="mt-16 flex flex-col items-start justify-between gap-6 pt-8 sm:flex-row sm:items-center lg:mt-24">
          <img
            src="/logo-128.webp"
            alt="Voidbunny"
            width={40}
            height={40}
            className="h-10 w-10 shrink-0"
          />

          <p className="text-sm text-neutral-500 dark:text-neutral-500">
            © {new Date().getFullYear()} Voidbunny. MIT-licensed open source.
          </p>
        </div>

        <div
          aria-hidden="true"
          className="@container pointer-events-none mt-10 select-none lg:mt-14"
        >
          <span
            className="block w-full font-semibold leading-[0.78] tracking-[-0.06em] text-brand/[0.18] dark:text-brand/[0.22]"
            style={{
              fontSize: "clamp(3rem, 21cqw, 18rem)",
              marginBottom: "-0.18em",
              WebkitMaskImage:
                "linear-gradient(to bottom, black 22%, transparent 92%)",
              maskImage:
                "linear-gradient(to bottom, black 22%, transparent 92%)",
            }}
          >
            Voidbunny
          </span>
        </div>
      </div>
    </section>
  );
}
