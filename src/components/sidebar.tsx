"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Workflow,
  Bot,
  FileStack,
  LineChart,
  Map,
  Sparkles,
  CheckSquare,
  ShieldCheck,
  Mail,
} from "lucide-react";

type NavItem = { href: string; label: string; icon: React.ComponentType<{ size?: number; strokeWidth?: number }> };

const GROUPS: { heading: string; items: NavItem[] }[] = [
  {
    heading: "Operations",
    items: [
      { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
      { href: "/admin/pipeline", label: "Pipeline", icon: Workflow },
      { href: "/admin/agents", label: "Agents", icon: Bot },
      { href: "/admin/raw", label: "Raw Docs", icon: FileStack },
    ],
  },
  {
    heading: "Data",
    items: [
      { href: "/admin/market", label: "Market", icon: LineChart },
      { href: "/admin/states", label: "States", icon: Map },
      { href: "/admin/hamilton", label: "Hamilton", icon: Sparkles },
      { href: "/admin/review", label: "Review", icon: CheckSquare },
      { href: "/admin/data-quality", label: "Data Quality", icon: ShieldCheck },
    ],
  },
  {
    heading: "Sales",
    items: [{ href: "/admin/leads", label: "Leads", icon: Mail }],
  },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-60 shrink-0 border-r border-[var(--color-admin-border)] bg-[var(--color-admin-surface)] min-h-screen flex flex-col">
      <div className="px-6 py-6 border-b border-[var(--color-admin-border)]">
        <Link href="/" className="block group">
          <div className="flex items-center gap-2">
            <div className="text-base font-semibold tracking-tight">
              Bank Fee Index
            </div>
            <span className="text-[9px] uppercase tracking-[0.18em] px-1.5 py-0.5 rounded bg-[var(--color-admin-accent-soft)] text-[var(--color-admin-accent)] font-semibold">
              v2
            </span>
          </div>
          <div className="text-[11px] text-[var(--color-admin-text-dim)] mt-1">
            Staging operator console
          </div>
        </Link>
      </div>

      <nav className="flex-1 py-4 space-y-6">
        {GROUPS.map((group) => (
          <div key={group.heading}>
            <div className="px-6 mb-2 text-[10px] uppercase tracking-[0.18em] text-[var(--color-admin-text-dim)] font-semibold">
              {group.heading}
            </div>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const active =
                  item.href === "/admin"
                    ? pathname === "/admin"
                    : pathname.startsWith(item.href);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={
                      "flex items-center gap-3 px-6 py-2.5 text-sm transition-colors border-l-2 " +
                      (active
                        ? "border-[var(--color-admin-accent)] text-[var(--color-admin-text)] bg-[var(--color-admin-surface-2)] font-medium"
                        : "border-transparent text-[var(--color-admin-text-muted)] hover:text-[var(--color-admin-text)] hover:bg-[var(--color-admin-surface-2)]/50")
                    }
                  >
                    <Icon size={16} strokeWidth={1.75} />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="px-6 py-4 border-t border-[var(--color-admin-border)] text-[10px] text-[var(--color-admin-text-dim)] uppercase tracking-[0.15em]">
        M1 · Vertical slice
      </div>
    </aside>
  );
}
