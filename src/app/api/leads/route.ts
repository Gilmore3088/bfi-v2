import { NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "@/lib/db";

const LeadSchema = z.object({
  email: z.string().email("Valid email required."),
  source: z.string().max(64).optional(),
  company: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
});

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { status: "error", message: "Invalid JSON body." },
      { status: 400 },
    );
  }

  const parsed = LeadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }
  const { email, source, company, notes } = parsed.data;

  try {
    await sql`
      INSERT INTO leads (email, company, source, status, notes)
      VALUES (${email}, ${company ?? null}, ${source ?? "newsletter"}, 'new', ${notes ?? null})
    `;
  } catch (err) {
    return NextResponse.json(
      {
        status: "error",
        message: "Could not save lead.",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ status: "ok" }, { status: 201 });
}
