"use client";

import { useState, type ReactNode } from "react";
import { SectionCorners } from "@/components/section-corners";

type Profile = {
  id: string;
  label: string;
  spec: string;
  arch: string;
  cores: string;
  memory: string;
  detected: string;
  limits: { key: string; value: string }[];
};

const PROFILES: Profile[] = [
  {
    id: "x86",
    label: "x86_64 server",
    spec: "Hetzner CX43",
    arch: "x86_64",
    cores: "8",
    memory: "16 GB",
    detected: "x86_64-server",
    limits: [
      { key: "CPUQuota", value: "400%" },
      { key: "CPUWeight", value: "50" },
      { key: "MemoryMax", value: "7806M" },
      { key: "MemoryHigh", value: "5854M" },
      { key: "TasksMax", value: "512" },
    ],
  },
  {
    id: "arm",
    label: "aarch64 server",
    spec: "Hetzner CAX21",
    arch: "aarch64",
    cores: "4",
    memory: "8 GB",
    detected: "aarch64-server",
    limits: [
      { key: "CPUQuota", value: "200%" },
      { key: "CPUWeight", value: "50" },
      { key: "MemoryMax", value: "4096M" },
      { key: "MemoryHigh", value: "3072M" },
      { key: "TasksMax", value: "512" },
    ],
  },
  {
    id: "sbc",
    label: "ARM SBC",
    spec: "Raspberry Pi 5",
    arch: "aarch64",
    cores: "4",
    memory: "8 GB",
    detected: "aarch64-sbc",
    limits: [
      { key: "CPUQuota", value: "140%" },
      { key: "CPUWeight", value: "50" },
      { key: "MemoryMax", value: "4096M" },
      { key: "MemoryHigh", value: "3072M" },
      { key: "TasksMax", value: "256" },
      { key: "IOWeight", value: "50" },
    ],
  },
];

export function AutoTune(): ReactNode {
  const [active, setActive] = useState<Profile>(PROFILES[0]!);
  const profile = active;

  return (
    <section
      id="tune"
      className="relative border-b border-border p-6 sm:p-10 lg:p-14"
    >
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:items-center lg:gap-14">
        <div className="flex flex-col justify-center">
          <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Right-sized for your host
          </span>
          <h2 className="mt-3 text-2xl font-semibold leading-[1.1] tracking-tight text-foreground sm:text-3xl lg:text-[2.5rem]">
            Auto-tunes to your{" "}
            <span className="text-brand">box</span>
          </h2>
          <p className="mt-5 max-w-md text-sm leading-relaxed text-muted-foreground sm:text-base">
            Voidbunny ships with a setup script that reads{" "}
            <code className="font-mono text-foreground">uname -m</code>,{" "}
            <code className="font-mono text-foreground">nproc</code>, and{" "}
            <code className="font-mono text-foreground">/proc/meminfo</code>,
            then writes a systemd drop-in so the panel and its agent
            children can never pin the host on cold start.
          </p>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-muted-foreground sm:text-base">
            Different policy for{" "}
            <span className="font-medium text-foreground">x86_64</span> and{" "}
            <span className="font-medium text-foreground">aarch64</span>{" "}
            servers, with extra-conservative defaults for Raspberry-Pi-class
            SBCs (smaller TasksMax, IOWeight tuned for SD-card I/O).
            From a 1-core VPS to a 32-core workstation, same one command.
          </p>

          <div className="mt-7 flex flex-wrap gap-2">
            {PROFILES.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setActive(p)}
                className={`focus-ring rounded-full border px-3.5 py-1.5 text-[11px] font-medium uppercase tracking-[0.12em] transition-colors ${
                  active.id === p.id
                    ? "border-brand bg-brand text-white"
                    : "border-border bg-background text-muted-foreground hover:text-foreground"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="relative rounded-2xl border border-border bg-neutral-950 p-5 font-mono text-[12px] leading-relaxed text-neutral-300 shadow-sm sm:p-6 sm:text-[13px] lg:p-7">
          <div className="mb-5 flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-neutral-700" aria-hidden="true" />
            <span className="h-2.5 w-2.5 rounded-full bg-neutral-700" aria-hidden="true" />
            <span className="h-2.5 w-2.5 rounded-full bg-neutral-700" aria-hidden="true" />
            <span className="ml-3 text-[10px] uppercase tracking-[0.14em] text-neutral-500">
              voidbunny@{profile.id}: ~
            </span>
          </div>

          <div className="space-y-3">
            <p className="text-neutral-100">
              <span className="text-brand">$ </span>
              sudo ./deploy/tune-limits.sh
            </p>
            <div className="text-neutral-400">
              <p>Detected:</p>
              <p>{"  "}host    = {profile.spec}</p>
              <p>{"  "}arch    = <span className="text-neutral-100">{profile.arch}</span></p>
              <p>{"  "}cores   = <span className="text-neutral-100">{profile.cores}</span></p>
              <p>{"  "}memory  = <span className="text-neutral-100">{profile.memory}</span></p>
              <p>
                {"  "}profile = <span className="text-brand">{profile.detected}</span>
              </p>
            </div>
            <div className="text-neutral-400">
              <p>Applying:</p>
              {profile.limits.map((l) => (
                <p key={l.key}>
                  {"  "}
                  <span className="text-neutral-100">{l.key}</span>=
                  <span className="text-emerald-400">{l.value}</span>
                </p>
              ))}
            </div>
            <p className="text-emerald-400">
              ✓ Wrote /etc/systemd/system/panel.service.d/limits.conf
            </p>
            <p className="text-neutral-500">
              {"  "}Apply with: sudo systemctl restart panel
            </p>

            <p className="text-neutral-100">
              <span className="text-brand">$ </span>
              <span className="inline-block animate-pulse" aria-hidden="true">
                ▮
              </span>
            </p>
          </div>
        </div>
      </div>
      <SectionCorners />
    </section>
  );
}
