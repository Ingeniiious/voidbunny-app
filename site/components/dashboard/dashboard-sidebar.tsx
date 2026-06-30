"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  RiDashboardLine,
  RiAddCircleLine,
  RiUserAddLine,
  RiSettings3Line,
  RiLogoutBoxRLine,
  RiMoreFill,
  RiArrowRightUpLine,
} from "@remixicon/react";
import { motion } from "motion/react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { DitherShader } from "@/components/dither-shader";

const NAV = [
  { href: "/dashboard", label: "Overview", icon: RiDashboardLine },
  { href: "/dashboard/claim", label: "Claim Subdomain", icon: RiAddCircleLine },
  { href: "/dashboard/referrals", label: "Referrals", icon: RiUserAddLine },
  { href: "/dashboard/settings", label: "Settings", icon: RiSettings3Line },
] as const;

const BRAND_TONE = { r: 0.76, g: 0.25, b: 0.05 };

export function DashboardSidebar({
  email,
  name,
}: {
  email: string;
  name: string;
}) {
  const pathname = usePathname();
  const initials =
    (name || email)
      .split(/[\s@.]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase() ?? "")
      .join("") || "V";

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="p-0">
        <div className="relative flex h-24 items-center justify-center overflow-hidden border-b border-sidebar-border">
          <div className="pointer-events-none absolute inset-0 opacity-40">
            <DitherShader variant="cta" tone={BRAND_TONE} />
          </div>
          <Link
            href="/"
            className="relative z-10 font-mono text-[11px] uppercase tracking-[0.32em] text-foreground"
            aria-label="Voidbunny home"
          >
            Voidbunny
          </Link>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="font-mono text-[10px] uppercase tracking-[0.18em]">
            Workspace
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV.map((item, i) => {
                const Icon = item.icon;
                const active =
                  pathname === item.href ||
                  (item.href !== "/dashboard" && pathname.startsWith(item.href));
                return (
                  <SidebarMenuItem key={item.href}>
                    <motion.div
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.04 * i, duration: 0.22, ease: "easeOut" }}
                    >
                      <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
                        <Link href={item.href}>
                          <Icon size={18} />
                          <span>{item.label}</span>
                        </Link>
                      </SidebarMenuButton>
                    </motion.div>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                >
                  <Avatar className="size-8 rounded-md">
                    <AvatarFallback className="rounded-md bg-brand text-[11px] font-medium text-white">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">{name || "Account"}</span>
                    <span className="truncate text-xs text-muted-foreground">{email}</span>
                  </div>
                  <RiMoreFill size={16} className="ml-auto" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="right"
                align="end"
                className="min-w-56 rounded-lg"
              >
                <DropdownMenuLabel className="font-mono text-[10px] uppercase tracking-[0.18em]">
                  Signed in via libraryyy.com
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <a
                    href="https://libraryyy.com/dashboard"
                    target="_blank"
                    rel="noreferrer noopener"
                    className="flex items-center gap-2"
                  >
                    <RiArrowRightUpLine size={14} />
                    Manage Account
                  </a>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/auth/sign-out" className="flex items-center gap-2 text-destructive focus:text-destructive">
                    <RiLogoutBoxRLine size={14} />
                    Sign Out
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
