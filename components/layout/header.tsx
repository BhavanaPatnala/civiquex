"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Bell, Moon, ShieldHalf, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PrimaryTabs } from "@/components/layout/primary-tabs";
import { useSession } from "@/lib/client/useSession";
import { useTheme } from "@/lib/client/useTheme";
import { apiGet } from "@/lib/client/api";
import { formatRelativeTime } from "@/lib/utils";

interface NotificationItem {
  id: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
  incidentId: string | null;
}

const ROLE_LABEL: Record<string, string> = { CITIZEN: "Citizen", AUTHORITY: "Officer", ADMIN: "Admin" };

export function Header() {
  const { user, loading, logout } = useSession();
  const router = useRouter();
  const { theme, toggleTheme } = useTheme();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);

  useEffect(() => {
    if (!user) return;
    apiGet<NotificationItem[]>("/api/notifications")
      .then(setNotifications)
      .catch(() => setNotifications([]));
  }, [user]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:px-6">
      <Link href="/" className="flex shrink-0 items-center gap-2 text-[15px] font-semibold tracking-tight text-foreground">
        <ShieldHalf className="h-[18px] w-[18px] text-primary" strokeWidth={1.75} />
        CiviqueX
      </Link>

      <div className="flex flex-1 justify-center">
        <PrimaryTabs role={user?.role} />
      </div>

      <div className="flex items-center gap-2">
        <Button size="icon" variant="ghost" onClick={toggleTheme} aria-label="Toggle theme" className="h-8 w-8">
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>

        {user && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" className="relative h-8 w-8">
                <Bell className="h-4 w-4" />
                {unreadCount > 0 && (
                  <span className="absolute right-0.5 top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-critical text-[9px] font-semibold text-critical-foreground">
                    {unreadCount}
                  </span>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80">
              <DropdownMenuLabel>Notifications</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {notifications.length === 0 && <p className="px-2 py-4 text-center text-xs text-muted-foreground">No notifications yet</p>}
              {notifications.slice(0, 8).map((n) => (
                <DropdownMenuItem
                  key={n.id}
                  className="flex-col items-start gap-0.5"
                  onSelect={() => n.incidentId && router.push(`/incidents/${n.incidentId}`)}
                >
                  <span className="text-xs font-medium">{n.title}</span>
                  <span className="text-[11px] text-muted-foreground line-clamp-2">{n.body}</span>
                  <span className="text-[10px] text-muted-foreground">{formatRelativeTime(n.createdAt)}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {loading ? (
          <div className="h-8 w-8 animate-pulse rounded-full bg-muted" />
        ) : user ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button aria-label="Account menu" className="flex items-center gap-2 rounded-full pl-1 pr-2.5 hover:bg-accent">
                <Avatar className="h-7 w-7">
                  <AvatarFallback className="text-[11px]">{user.name.slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
                <span className="hidden text-[12px] text-muted-foreground sm:inline">{ROLE_LABEL[user.role] ?? user.role}</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>
                <div className="flex flex-col">
                  <span className="text-sm font-medium">{user.name}</span>
                  <span className="text-[11px] font-normal text-muted-foreground">{user.email}</span>
                  <span className="text-[11px] font-normal text-muted-foreground">{ROLE_LABEL[user.role] ?? user.role}</span>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={async () => {
                  await logout();
                  router.push("/login");
                  router.refresh();
                }}
              >
                Log out
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <div className="px-2 py-1.5 text-[10px] leading-snug text-muted-foreground">
                Demo environment — data is deterministic and offline, not a live government system.
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Button size="sm" variant="outline" asChild>
            <Link href="/login">Sign in</Link>
          </Button>
        )}
      </div>
    </header>
  );
}
