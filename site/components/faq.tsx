"use client";

import { RiArrowDownSLine } from "@remixicon/react";
import { AnimatePresence, motion, type Transition } from "motion/react";
import { useId, useState, type ReactNode } from "react";
import { SectionCorners } from "@/components/section-corners";

const PANEL_TRANSITION: Transition = {
  duration: 0.4,
  ease: [0.22, 1, 0.36, 1],
};

const CHEVRON_TRANSITION: Transition = {
  duration: 0.3,
  ease: [0.22, 1, 0.36, 1],
};

type FAQ = {
  q: string;
  a: ReadonlyArray<string>;
};

const FAQS: ReadonlyArray<FAQ> = [
  {
    q: "What is Voidbunny, exactly?",
    a: [
      "A self-hosted web app that runs on your own machine — a rented Ubuntu VPS, an old desktop at home, whatever you have — and gives a coding-agent CLI (Claude, Codex, Cursor, Gemini, Grok) a real shell, a real filesystem, and a real git checkout. You open Voidbunny from your phone or laptop, type or speak a prompt, and the agent does the work on your box: branches, commits, deploys, the lot.",
      "Voidbunny is the wrapper — the agents are still the agents. Sign in with the subscription you already pay for (Claude Pro / Max, ChatGPT Plus / Pro, Cursor Pro, Google AI Pro, SuperGrok) or drop in an API key. Voidbunny doesn't touch your credentials; they live in the CLI's own config directory on your box.",
    ],
  },
  {
    q: "How is this different from Anthropic's mobile Claude app?",
    a: [
      "Anthropic's mobile app drops every agent into a sandboxed worktree it owns. Safer-by-default, but you can't push to main, can't run your real test suite, and can't deploy to your real infrastructure — it's a demo environment, not your environment.",
      "Voidbunny inverts that: the agent runs on a real machine you control, with the same git remotes, the same services, and the same databases you'd normally reach over SSH. The tradeoff is that you own the host's hygiene — see the security FAQ below for how Voidbunny ships hardened defaults so that's manageable.",
    ],
  },
  {
    q: "Which agent do I need — Claude, Codex, Cursor, Gemini, or Grok?",
    a: [
      "Whichever ones you already pay for. The installer drops the three Node CLIs by default (@anthropic-ai/claude-code, @openai/codex, @google/gemini-cli); Cursor Agent and Grok are one-liners you add when you want them (curl cursor.com/install, curl x.ai/cli). Voidbunny auto-detects all five in the process tree and tags each terminal tab with the right logo.",
      "Open each in its own Voidbunny tab and sign in with the OAuth flow that CLI ships — your Claude Pro / Max, ChatGPT Plus / Pro, Cursor Pro, Google AI Pro, or SuperGrok subscription is what pays for prompts. No API keys to paste or rotate. (Keys still work as a fallback if you blow through quota.)",
      "Voidbunny stays agent-neutral on purpose — the app is the thing it ships, and the agents are interchangeable tools you plug into it.",
    ],
  },
  {
    q: "Do I need to keep SSHing into the box?",
    a: [
      "On a rented VPS: you SSH (or paste the install command into your provider's web console) exactly once to install and configure it. After that you only come back for updates or to uninstall — everything else happens inside Voidbunny: terminals, file tree, in-app browser, logs, agent prompts.",
      "Running it on your own machine instead? Then there's no SSH at all — you run the installer locally and open Voidbunny in your browser.",
    ],
  },
  {
    q: "Can I run it on my own machine instead of renting a server?",
    a: [
      "Yes. The installer works on any Ubuntu (or systemd-based Linux) machine you already control — a homelab box, an old desktop, even a laptop you leave plugged in at home. You skip the VPS entirely.",
      "The only catch is reachability: to open Voidbunny from outside your home network you'll need Tailscale/WireGuard, or a port-forward plus a domain pointing at your home IP. Voidbunny's free subdomain service helps with the second case if you don't own a domain.",
    ],
  },
  {
    q: "Is it safe to expose this on the public internet?",
    a: [
      "Yes — that's the whole point. You want to reach it from your phone over LTE, not VPN into a homelab. Voidbunny is built to live on a public domain with Caddy + Let's Encrypt out front.",
      "Treat the host like an SSH endpoint. The repo's SETUP-HARDENING doc walks through the host-level steps: SSH key-only login, ufw allowing only 22/80/443, fail2ban on the Caddy access log, unattended-upgrades for kernel patches.",
      "Voidbunny itself ships hardened by default: bcrypt-hashed PANEL_PASSWORD, rate-limited /auth, JWT_SECRET that refuses to boot if it's empty, the app bound to 127.0.0.1 and reachable only through Caddy, and the systemd unit running as a non-root user with NoNewPrivileges + ProtectSystem=strict + ProtectHome=read-only + PrivateTmp.",
      "Paranoid? Run it behind Tailscale/WireGuard and take it off the public internet entirely — same install, just don't point a public DNS record at it.",
    ],
  },
  {
    q: "Won't a runaway agent pin my whole box?",
    a: [
      "It could, which is why the installer pairs with a one-time tune-limits.sh script that reads your host specs and writes a systemd drop-in for panel.service (CPUQuota, MemoryMax, TasksMax). Every tmux, claude, codex, cursor-agent, gemini, and grok process the panel spawns inherits the cap, so a fork-bomb or a runaway loop tops out at — say — 400% CPU and half your RAM instead of taking the host down.",
      "It's idempotent — re-run it after resizing the VPS or migrating hardware and it picks up the new specs. Without it panel.service runs with MemoryMax=infinity, which is fine for kicking the tires and not fine if you leave a phone-driven agent alone overnight.",
    ],
  },
  {
    q: "What does it cost to run?",
    a: [
      "Voidbunny itself is MIT-licensed, free forever — no subscription, no usage tracking, no Pro tier. You only pay your hosting provider and whatever tokens your chosen agent costs.",
      "On a rented VPS, a Hetzner CX43 at ~€15/month is the sweet spot — feels like a workstation for the kind of work agents do. That's roughly $200/year, against a $2,000+ laptop you don't want to carry around. A €5 shared CX is enough for light use. Self-hosting on hardware you already own costs nothing extra.",
    ],
  },
  {
    q: "Why not just SSH into a server from a mobile terminal app?",
    a: [
      "You can, and people do. Voidbunny is the layer that makes it actually pleasant on a phone: full xterm with copy/paste that works, a file tree, an in-app browser the agent can drive, voice prompt with Whisper, Web Push when a long task finishes, PWA so it lives on your home screen like a native app.",
      "It's the difference between coding on your phone for ten minutes before giving up and coding on your phone for two hours straight.",
    ],
  },
  {
    q: "Is there a hosted option, so I don't have to set up a box at all?",
    a: [
      "Not yet. A paid hosted Voidbunny — sign in, get an instance, no server provisioning — is on the roadmap. Pricing will be flat and won't charge for egress; Hetzner is generous about bandwidth and we'd rather pass that on than meter people.",
      "For now, the path is: bring any Ubuntu box (rented or your own), claim a free subdomain if you don't already have a domain, run the installer. The OSS app itself stays free forever, regardless of whether a hosted option ever ships.",
    ],
  },
  {
    q: "Do I have to buy a domain to use it?",
    a: [
      "No. Claim a free name.voidbunny.xyz subdomain that points at your server's IP — Voidbunny runs the DNS, Caddy on your box handles the Let's Encrypt cert via HTTP-01. If you already own a domain, point it at the box and skip the subdomain service entirely.",
    ],
  },
];

export function Faq(): ReactNode {
  const [openIndex, setOpenIndex] = useState<number>(0);
  const headingId = useId();

  return (
    <section
      id="faq"
      aria-labelledby={headingId}
      className="relative border-b border-border p-6 sm:p-10 lg:p-14"
    >
      <h2
        id={headingId}
        className="text-3xl font-medium leading-[1.05] tracking-tighter text-foreground sm:text-4xl lg:text-[3.5rem]"
      >
        FAQs
      </h2>

      <div className="mt-6 border-t border-border sm:mt-10 lg:mt-14">
        <ul className="divide-y divide-border">
          {FAQS.map((faq, i) => (
            <FaqRow
              key={faq.q}
              faq={faq}
              isOpen={openIndex === i}
              onToggle={() => setOpenIndex((prev) => (prev === i ? -1 : i))}
            />
          ))}
        </ul>
      </div>
      <SectionCorners />
    </section>
  );
}

function FaqRow({
  faq,
  isOpen,
  onToggle,
}: {
  faq: FAQ;
  isOpen: boolean;
  onToggle: () => void;
}): ReactNode {
  const triggerId = useId();
  const panelId = useId();

  return (
    <li>
      <button
        id={triggerId}
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-controls={panelId}
        className="focus-ring group flex w-full cursor-pointer items-center justify-between gap-6 py-6 text-left sm:py-7"
      >
        <span className="text-base font-medium leading-snug tracking-tight text-foreground transition-colors duration-200 group-hover:text-brand sm:text-lg">
          {faq.q}
        </span>

        {/* Chevron capsule. Cross-fades two background layers so the closed
         * state shows a filled muted chip and the open state shows a hairline
         * border ring. Animating the layers' opacities sidesteps Motion's
         * inability to interpolate between CSS-variable colors. */}
        <motion.span
          aria-hidden="true"
          animate={{ rotate: isOpen ? 180 : 0 }}
          transition={CHEVRON_TRANSITION}
          className="relative inline-flex h-9 w-9 shrink-0 items-center justify-center text-foreground"
        >
          <motion.span
            className="absolute inset-0 rounded-full bg-muted"
            animate={{ opacity: isOpen ? 0 : 1 }}
            transition={CHEVRON_TRANSITION}
          />
          <motion.span
            className="absolute inset-0 rounded-full border border-border"
            animate={{ opacity: isOpen ? 1 : 0 }}
            transition={CHEVRON_TRANSITION}
          />
          <RiArrowDownSLine className="relative h-4 w-4" />
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.section
            id={panelId}
            role="region"
            aria-labelledby={triggerId}
            key="content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={PANEL_TRANSITION}
            style={{ overflow: "hidden" }}
          >
            <motion.div
              initial={{ y: -6 }}
              animate={{ y: 0 }}
              exit={{ y: -6 }}
              transition={PANEL_TRANSITION}
              className="max-w-3xl space-y-4 pb-7 pr-12 text-sm leading-relaxed text-muted-foreground sm:text-base"
            >
              {faq.a.map((para, i) => (
                <p key={i}>{para}</p>
              ))}
            </motion.div>
          </motion.section>
        )}
      </AnimatePresence>
    </li>
  );
}
