import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="max-w-2xl text-center">
        <div className="text-[11px] uppercase tracking-[0.2em] text-[var(--color-admin-text-dim)] mb-4">
          Bank Fee Index v2
        </div>
        <h1 className="text-4xl font-bold tracking-tight mb-4">
          The national authority on bank and credit union fee data.
        </h1>
        <p className="text-[var(--color-admin-text-muted)] mb-8 text-lg">
          A McKinsey-grade fee intelligence product backed by a small, reliable
          agent fleet.
        </p>
        <Link
          href="/admin"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-[var(--color-admin-accent)] hover:bg-[var(--color-admin-accent)]/90 text-white text-sm font-medium transition-colors"
        >
          Open Admin Dashboard
        </Link>
      </div>
    </main>
  );
}
