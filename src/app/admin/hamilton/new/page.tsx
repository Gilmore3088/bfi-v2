import { sql } from "@/lib/db";
import { GenerateForm } from "./generate-form";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type CategoryOption = { category: string; display_name: string };

async function loadCategories(): Promise<CategoryOption[]> {
  try {
    return await sql<CategoryOption[]>`
      SELECT category, COALESCE(display_name, category) AS display_name
      FROM taxonomy
      ORDER BY family ASC, category ASC
    `;
  } catch {
    return [];
  }
}

export default async function HamiltonNewPage() {
  const categories = await loadCategories();
  return (
    <main className="px-8 py-6 max-w-3xl">
      <header className="mb-6">
        <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-admin-text-dim)] mb-1">
          Admin / Hamilton / New
        </div>
        <h1 className="text-2xl font-bold tracking-tight">
          Generate a new report
        </h1>
        <p className="text-sm text-[var(--color-admin-text-muted)] mt-1">
          Hamilton synthesizes McKinsey-grade research from verified fee data.
          Pick a report kind, target a subject, and dispatch the agent.
        </p>
      </header>
      <GenerateForm categories={categories} />
    </main>
  );
}
