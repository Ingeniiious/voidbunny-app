"use client";

import { RiMoonLine, RiSunLine } from "@remixicon/react";
import { useTheme } from "next-themes";
import { useSyncExternalStore, type ReactNode } from "react";

function useIsMounted(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
}

export function ThemeSwitch({
  className,
}: {
  className?: string;
} = {}): ReactNode {
  const mounted = useIsMounted();
  const { setTheme, resolvedTheme } = useTheme();

  const toggleTheme = (): void => {
    setTheme(resolvedTheme === "dark" ? "light" : "dark");
  };

  const base =
    "focus-ring inline-flex h-10 w-10 items-center justify-center rounded-full bg-muted text-foreground transition-colors hover:bg-border hover:text-brand";

  if (!mounted) {
    return (
      <button
        className={`${base} cursor-not-allowed opacity-50 ${className ?? ""}`}
        aria-label="Toggle theme"
        disabled
      />
    );
  }

  const isDark = resolvedTheme === "dark";

  return (
    <button
      onClick={toggleTheme}
      className={`${base} cursor-pointer ${className ?? ""}`}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      aria-pressed={isDark}
      type="button"
    >
      {isDark ? (
        <RiSunLine className="h-5 w-5" aria-hidden="true" />
      ) : (
        <RiMoonLine className="h-5 w-5" aria-hidden="true" />
      )}
    </button>
  );
}
