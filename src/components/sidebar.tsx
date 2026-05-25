"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/market", label: "Market" },
  { href: "/admin/hamilton", label: "Hamilton" },
  { href: "/admin/leads", label: "Leads" },
  { href: "/admin/agents", label: "Agents" },
  { href: "/admin/pipeline", label: "Pipeline" },
  { href: "/admin/review", label: "Review" },
  { href: "/admin/data-quality", label: "Data Quality" },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-56 shrink-0 border-r border-[var(--color-admin-border)] bg-[var(--color-admin-surface)] min-h-screen flex flex-col">
      <div className="px-5 py-4 border-b border-[var(--color-admin-border)]">
        <Link href="/" className="block">
          <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-admin-text-dim)]">
            Bank Fee Index
          </div>
          <div className="text-sm font-semibold mt-0.5">v2 Admin</div>
        </Link>
      </div>
      <nav className="flex-1 py-3">
        {NAV.map((item) => {
          const active =
            item.href === "/admin"
              ? pathname === "/admin"
              : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={
                "block px-5 py-2 text-sm transition-colors border-l-2 " +
                (active
                  ? "border-[var(--color-admin-accent)] text-[var(--color-admin-text)] bg-[var(--color-admin-surface-2)]"
                  : "border-transparent text-[var(--color-admin-text-muted)] hover:text-[var(--color-admin-text)] hover:bg-[var(--color-admin-surface-2)]/60")
              }
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="px-5 py-3 border-t border-[var(--color-admin-border)] text-[10px] text-[var(--color-admin-text-dim)] uppercase tracking-[0.15em]">
        M1 — Vertical slice
      </div>
    </aside>
  );
}
