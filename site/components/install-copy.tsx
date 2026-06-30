"use client";

import { RiCheckLine, RiFileCopyLine } from "@remixicon/react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

const INSTALL_COMMAND = "curl -fsSL voidbunny.xyz/install.sh | bash";

export function InstallCopy({
  command = INSTALL_COMMAND,
  className,
}: {
  command?: string;
  className?: string;
}): ReactNode {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const copy = useCallback(async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(command);
      } else {
        // Fallback for older / non-secure-context browsers.
        const ta = document.createElement("textarea");
        ta.value = command;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      // Swallow — clipboard may be blocked. The visible command still lets
      // the user copy it manually.
    }
  }, [command]);

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? "Install command copied" : "Copy install command"}
      className={`focus-ring group inline-flex max-w-full cursor-pointer items-center gap-3 rounded-full border border-brand/40 bg-brand/5 px-4 py-3 font-mono text-xs ring-1 ring-brand/20 transition-colors hover:bg-brand/10 sm:gap-4 sm:px-5 sm:py-3.5 sm:text-sm ${className ?? ""}`}
    >
      <span className="text-brand">$</span>
      <code className="flex-1 truncate text-left text-foreground">{command}</code>
      <span
        aria-hidden="true"
        className="relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-background text-foreground transition-colors group-hover:bg-brand group-hover:text-white"
      >
        <RiFileCopyLine
          className={`absolute h-3.5 w-3.5 transition-opacity duration-200 ${
            copied ? "opacity-0" : "opacity-100"
          }`}
        />
        <RiCheckLine
          className={`absolute h-3.5 w-3.5 transition-opacity duration-200 ${
            copied ? "opacity-100" : "opacity-0"
          }`}
        />
      </span>
      <span
        aria-live="polite"
        className="sr-only"
      >
        {copied ? "Copied to clipboard" : ""}
      </span>
    </button>
  );
}
