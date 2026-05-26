import { Sidebar } from "@/components/sidebar";
import { CommandPalette } from "@/components/command-palette";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex-1 min-w-0 relative">
        <div className="sticky top-0 z-40 flex justify-end px-6 py-2 border-b border-[var(--color-admin-border)] bg-[var(--color-admin-surface)]/80 backdrop-blur">
          <span className="text-[11px] text-[var(--color-admin-text-dim)]">
            <kbd className="px-1.5 py-0.5 rounded border border-[var(--color-admin-border)] font-mono text-[10px]">
              ⌘K
            </kbd>{" "}
            to search
          </span>
        </div>
        {children}
      </div>
      <CommandPalette />
    </div>
  );
}
