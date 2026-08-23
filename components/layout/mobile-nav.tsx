"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Camera, ListChecks, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSession } from "@/lib/client/useSession";
import { tabsForRole } from "@/components/layout/primary-tabs";

const ICON = { public: Camera, police: ShieldCheck, incidents: ListChecks } as const;

export function MobileNav() {
  const pathname = usePathname();
  const { user } = useSession();
  const tabs = tabsForRole(user?.role);

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 flex h-16 items-center justify-around border-t border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80 md:hidden"
      aria-label="Primary"
    >
      {tabs.map((tab) => {
        const active = tab.href === "/" ? pathname === "/" : pathname?.startsWith(tab.href);
        const Icon = ICON[tab.key];
        return (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn("flex flex-col items-center gap-1 px-4 py-1.5 text-[11px] font-medium", active ? "text-primary" : "text-muted-foreground")}
          >
            <Icon className="h-5 w-5" strokeWidth={1.75} />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
