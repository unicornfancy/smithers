"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Calendar,
  FileText,
  FolderKanban,
  Inbox,
  ListChecks,
  Newspaper,
  PenLine,
  PhoneCall,
  Search,
  Settings,
  Wand2,
} from "lucide-react";

import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

const NAV: NavItem[] = [
  { href: "/today", label: "Today", icon: Calendar },
  { href: "/search", label: "Search HM", icon: Search },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/calls", label: "Calls", icon: PhoneCall },
  { href: "/drafts", label: "Drafts", icon: PenLine },
  { href: "/agendas", label: "Agendas", icon: ListChecks },
  { href: "/follow-ups", label: "Follow-ups", icon: Inbox },
  { href: "/weekly-updates", label: "Weekly Updates", icon: Newspaper },
  { href: "/style-guide", label: "Style Guide", icon: FileText },
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/setup", label: "Setup", icon: Wand2 },
];

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <aside className="bg-sidebar text-sidebar-foreground border-sidebar-border flex w-60 shrink-0 flex-col border-r">
      <div className="flex flex-col items-center gap-2 border-b border-sidebar-border px-4 py-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/icon.png"
          alt="Smithers"
          className="aspect-square w-[70%] rounded-md object-cover"
        />
        <div className="flex flex-col items-center">
          <span className="text-sm font-semibold leading-tight">Smithers</span>
          <span className="text-muted-foreground text-xs leading-tight">
            Launch TAM Assistant
          </span>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 p-2">
        {NAV.map((item) => {
          const isActive =
            pathname === item.href ||
            (item.href !== "/" && pathname.startsWith(item.href));
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground",
              )}
            >
              <Icon className="size-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-sidebar-border border-t p-3 text-xs text-muted-foreground">
        <span className="font-medium">v0.0.1</span> · pre-alpha
      </div>
    </aside>
  );
}
