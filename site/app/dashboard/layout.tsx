import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { Toaster } from "@/components/ui/sonner";
import { DashboardSidebar } from "@/components/dashboard/dashboard-sidebar";
import { getSession } from "@/lib/auth/session";
import { getProfileById } from "@/lib/auth/profile";

// Middleware already gates this on the vb_session cookie, but we re-verify
// here to access the profile row (and to bounce gracefully if the profile
// was deleted out from under the session).

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/auth/sign-in?next=/dashboard");

  const profile = await getProfileById(session.profileId);
  if (!profile) redirect("/auth/sign-out");

  return (
    <SidebarProvider>
      <DashboardSidebar email={profile.email ?? ""} name={profile.name ?? ""} />
      <SidebarInset>
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur-md">
          <SidebarTrigger />
          <Separator orientation="vertical" className="h-5" />
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Voidbunny · Dashboard
          </span>
        </header>
        <main className="flex-1 px-4 py-8 sm:px-8 lg:px-12">{children}</main>
      </SidebarInset>
      <Toaster position="bottom-right" />
    </SidebarProvider>
  );
}
