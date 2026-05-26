"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { US_STATES } from "@/lib/us-map-paths";

export type StateMapDatum = {
  code: string;
  verified: number;
  institutions: number;
};

type Props = {
  data: StateMapDatum[];
};

/**
 * Interactive choropleth of the lower 48 plus AK/HI/DC.
 * - Color ramp: dark elevated panel (cold, zero data) -> accent (hot, max).
 * - Intensity uses sqrt(verified / max) so mid-coverage states pop visually
 *   instead of being washed out by a single high-coverage outlier.
 * - Each state is wrapped in a Next Link for client-side navigation.
 *   Hover state is tracked in component state so the tooltip card below
 *   the map can react. The SVG <title> element is also kept as a fallback
 *   for screen readers and native tooltips.
 */
export function StateMap({ data }: Props) {
  const [hovered, setHovered] = useState<string | null>(null);
  const router = useRouter();

  const byCode = new Map(data.map((d) => [d.code, d]));
  const max = Math.max(1, ...data.map((d) => d.verified));

  const hoveredDatum = hovered ? byCode.get(hovered) ?? null : null;
  const hoveredName = hovered
    ? US_STATES.find((s) => s.id === hovered)?.name ?? hovered
    : null;

  return (
    <div className="relative">
      <svg
        viewBox="0 0 960 600"
        className="w-full h-auto"
        role="img"
        aria-label="US state coverage map"
      >
        {US_STATES.map(({ id, d, name }) => {
          const s = byCode.get(id);
          const verified = s?.verified ?? 0;
          const institutions = s?.institutions ?? 0;
          const intensity = verified > 0 ? Math.sqrt(verified / max) : 0;
          const fill =
            intensity === 0
              ? "var(--color-admin-surface-2)"
              : `color-mix(in oklab, var(--color-admin-surface-2), var(--color-admin-accent) ${
                  intensity * 100
                }%)`;
          const isHover = hovered === id;
          return (
            <path
              key={id}
              d={d}
              fill={fill}
              stroke={
                isHover
                  ? "var(--color-admin-accent)"
                  : "var(--color-admin-border)"
              }
              strokeWidth={isHover ? 1.5 : 0.6}
              onMouseEnter={() => setHovered(id)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => router.push(`/admin/states/${id}`)}
              role="link"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  router.push(`/admin/states/${id}`);
                }
              }}
              className="cursor-pointer transition-[stroke,stroke-width] duration-150 outline-none focus:stroke-[var(--color-admin-accent)]"
            >
              <title>{`${name}: ${verified} verified fees, ${institutions} institutions`}</title>
            </path>
          );
        })}
      </svg>

      <div className="absolute top-3 right-3 admin-card px-3 py-2 text-[11px] min-w-[170px]">
        {hovered ? (
          <>
            <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-admin-text-dim)] mb-0.5">
              {hovered}
            </div>
            <div className="text-sm font-semibold">{hoveredName}</div>
            <div className="text-[var(--color-admin-text-muted)] mt-1 tabular-nums">
              {(hoveredDatum?.verified ?? 0).toLocaleString()} verified fees
            </div>
            <div className="text-[var(--color-admin-text-muted)] tabular-nums">
              {(hoveredDatum?.institutions ?? 0).toLocaleString()} institutions
            </div>
          </>
        ) : (
          <div className="text-[var(--color-admin-text-muted)]">
            Hover a state for detail
          </div>
        )}
      </div>

      <div className="mt-4 flex items-center gap-3 text-[10px] uppercase tracking-[0.18em] text-[var(--color-admin-text-dim)]">
        <span>Low</span>
        <div
          className="h-2 flex-1 rounded-sm"
          style={{
            background:
              "linear-gradient(to right, var(--color-admin-surface-2), var(--color-admin-accent))",
          }}
        />
        <span>High</span>
      </div>
    </div>
  );
}
