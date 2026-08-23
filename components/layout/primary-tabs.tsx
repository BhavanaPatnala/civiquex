"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import type { ClientSessionUser } from "@/lib/client/useSession";

const ALL_TABS = [
  { key: "public", label: "Public", href: "/" },
  { key: "police", label: "Police", href: "/police" },
  { key: "incidents", label: "Incidents", href: "/incidents" },
] as const;

/**
 * All three tabs are always visible to everyone — data access is still
 * fully role-gated server-side (see app/api/incidents/route.ts and
 * app/(dashboard)/police/page.tsx), but hiding the nav item itself just
 * makes a citizen think the feature is missing rather than restricted.
 * Kept as a function (not a constant) so a future role actually needs to
 * be excluded without touching every call site.
 */
export function tabsForRole(_role: ClientSessionUser["role"] | undefined) {
  return ALL_TABS;
}

export function PrimaryTabs({ role }: { role: ClientSessionUser["role"] | undefined }) {
  const pathname = usePathname();
  const tabs = tabsForRole(role);

  return (
    <nav className="hidden items-center gap-0.5 rounded-full bg-muted p-1 md:flex" aria-label="Primary">
      {tabs.map((tab) => {
        const active = tab.href === "/" ? pathname === "/" : pathname?.startsWith(tab.href);
        return (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-full px-4 py-1.5 text-[13px] font-medium transition-colors",
              active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
