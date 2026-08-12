import { useMemo, useRef, useState, type ReactNode } from "react";
import { formatINR } from "@compass/shared";

/**
 * Chart primitives per the dataviz method: validated categorical palette in
 * fixed slot order (never cycled), thin marks, 2px surface gaps/rings,
 * hairline grids, tooltips on hover, text in ink tokens (never series color).
 */

export const SERIES = [
  "#2a78d6", // blue
  "#1baf7a", // aqua
  "#eda100", // yellow
  "#008300", // green
  "#4a3aa7", // violet
  "#e34948", // red
  "#e87ba4", // magenta
  "#eb6834", // orange
] as const;

export const STATUS = {
  good: "#0ca30c",
  warning: "#fab219",
  critical: "#d03b3b",
} as const;

const INK = { primary: "#0b0b0b", secondary: "#52514e", muted: "#898781" };
const GRID = "#e1e0d9";
const SURFACE = "#ffffff";

export function compactINR(paise: number): string {
  const r = Math.abs(paise) / 100;
  const sign = paise < 0 ? "−" : "";
  if (r >= 10_000_000) return `${sign}₹${(r / 10_000_000).toFixed(1)}Cr`;
  if (r >= 100_000) return `${sign}₹${(r / 100_000).toFixed(1)}L`;
  if (r >= 1_000) return `${sign}₹${(r / 1_000).toFixed(1)}K`;
  return `${sign}₹${r.toFixed(0)}`;
}

// ---------- sparkline ----------

/** Tiny inline trend line for insight cards; flat/empty renders a baseline. */
export function Sparkline({ values, color = SERIES[0], width = 96, height = 28 }: {
  values: number[];
  color?: string;
  width?: number;
  height?: number;
}) {
  if (values.length < 2) return <svg width={width} height={height} aria-hidden />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (i: number) => (i / (values.length - 1)) * (width - 2) + 1;
  const y = (v: number) => height - 2 - ((v - min) / span) * (height - 4);
  const pts = values.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  return (
    <svg width={width} height={height} role="img" aria-label="trend">
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(values.length - 1)} cy={y(values[values.length - 1]!)} r={2} fill={color} />
    </svg>
  );
}

// ---------- budget meter ----------

/** Utilization meter: fill carries severity, track is a lighter step of the same ramp. */
export function Meter({ pct }: { pct: number }) {
  const fill = pct >= 100 ? STATUS.critical : pct >= 80 ? STATUS.warning : SERIES[0];
  const track = pct >= 100 ? "#f3d2d2" : pct >= 80 ? "#f8e9c4" : "#cde2fb";
  return (
    <div className="h-2 w-full rounded-full" style={{ background: track }}>
      <div
        className="h-2 rounded-full"
        style={{ width: `${Math.min(100, pct)}%`, background: fill }}
      />
    </div>
  );
}

// ---------- donut ----------

export type DonutSlice = { key: string; label: string; value: number };

export function Donut({ slices, size = 168 }: { slices: DonutSlice[]; size?: number }) {
  const [hover, setHover] = useState<DonutSlice | null>(null);
  const shown = useMemo(() => {
    const sorted = [...slices].sort((a, b) => b.value - a.value);
    if (sorted.length <= 7) return sorted;
    const head = sorted.slice(0, 6);
    const rest = sorted.slice(6).reduce((s, x) => s + x.value, 0);
    return [...head, { key: "__other", label: "Other", value: rest }];
  }, [slices]);
  const total = shown.reduce((s, x) => s + x.value, 0);
  if (total <= 0) return <p className="py-8 text-center text-sm text-slate-400">No spending yet this month.</p>;

  const R = size / 2;
  const r = R * 0.62;
  let angle = -Math.PI / 2;
  const arcs = shown.map((s, i) => {
    const sweep = (s.value / total) * Math.PI * 2;
    const a0 = angle;
    const a1 = angle + sweep;
    angle = a1;
    const large = sweep > Math.PI ? 1 : 0;
    const p = (a: number, rad: number) => `${R + rad * Math.cos(a)},${R + rad * Math.sin(a)}`;
    return {
      slice: s,
      color: s.key === "__other" ? "#c3c2b7" : SERIES[i % SERIES.length]!,
      d: `M ${p(a0, R)} A ${R} ${R} 0 ${large} 1 ${p(a1, R)} L ${p(a1, r)} A ${r} ${r} 0 ${large} 0 ${p(a0, r)} Z`,
    };
  });

  return (
    <div className="flex flex-wrap items-center gap-4">
      <svg width={size} height={size} role="img" aria-label="Spending by category">
        {arcs.map((a) => (
          <path
            key={a.slice.key}
            d={a.d}
            fill={a.color}
            stroke={SURFACE}
            strokeWidth={2}
            opacity={hover && hover.key !== a.slice.key ? 0.45 : 1}
            onMouseEnter={() => setHover(a.slice)}
            onMouseLeave={() => setHover(null)}
          />
        ))}
        <text x={R} y={R - 6} textAnchor="middle" fontSize="12" fill={INK.muted}>
          {hover ? hover.label : "Total"}
        </text>
        <text x={R} y={R + 12} textAnchor="middle" fontSize="14" fontWeight={600} fill={INK.primary}>
          {compactINR(hover ? hover.value : total)}
        </text>
      </svg>
      {/* legend carries identity + values (relief for low-contrast hues) */}
      <ul className="min-w-40 flex-1 space-y-1 text-sm">
        {arcs.map((a) => (
          <li
            key={a.slice.key}
            className="flex items-center gap-2"
            onMouseEnter={() => setHover(a.slice)}
            onMouseLeave={() => setHover(null)}
          >
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: a.color }} />
            <span className="min-w-0 flex-1 truncate text-slate-600">{a.slice.label}</span>
            <span className="tabular-nums text-slate-500">{compactINR(a.slice.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------- line chart ----------

export type LineSeries = { name: string; color: string; values: number[] };

export function LineChart({
  labels,
  series,
  height = 220,
  onPointClick,
}: {
  labels: string[];
  series: LineSeries[];
  height?: number;
  onPointClick?: (index: number) => void;
}) {
  const W = 640;
  const H = height;
  const pad = { l: 46, r: 16, t: 12, b: 22 };
  const [hoverI, setHoverI] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const min = Math.min(0, ...series.flatMap((s) => s.values));
  const niceMax = niceCeil(max);
  const niceMin = min < 0 ? -niceCeil(-min) : 0;
  const x = (i: number) =>
    pad.l + (labels.length <= 1 ? 0 : (i / (labels.length - 1)) * (W - pad.l - pad.r));
  const y = (v: number) =>
    H - pad.b - ((v - niceMin) / (niceMax - niceMin)) * (H - pad.t - pad.b);
  const ticks = niceMin < 0 ? [niceMin, 0, niceMax] : [0, niceMax / 2, niceMax];

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const t = (px - pad.l) / (W - pad.l - pad.r);
    const i = Math.round(t * (labels.length - 1));
    setHoverI(Math.max(0, Math.min(labels.length - 1, i)));
  }

  return (
    <div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label="Monthly trend"
        onMouseMove={onMove}
        onMouseLeave={() => setHoverI(null)}
        onClick={() => hoverI !== null && onPointClick?.(hoverI)}
        style={{ cursor: onPointClick ? "pointer" : "default" }}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
            <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" fontSize="10" fill={INK.muted}>
              {compactINR(t)}
            </text>
          </g>
        ))}
        {labels.map((l, i) =>
          labels.length <= 13 || i % 2 === 0 ? (
            <text key={l} x={x(i)} y={H - 6} textAnchor="middle" fontSize="10" fill={INK.muted}>
              {l.slice(5)}
            </text>
          ) : null,
        )}
        {hoverI !== null && (
          <line x1={x(hoverI)} x2={x(hoverI)} y1={pad.t} y2={H - pad.b} stroke={INK.muted} strokeWidth={1} />
        )}
        {series.map((s) => (
          <g key={s.name}>
            <polyline
              points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ")}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {/* end dot with surface ring */}
            <circle cx={x(s.values.length - 1)} cy={y(s.values[s.values.length - 1] ?? 0)} r={5.5} fill={SURFACE} />
            <circle cx={x(s.values.length - 1)} cy={y(s.values[s.values.length - 1] ?? 0)} r={4} fill={s.color} />
            {hoverI !== null && (
              <>
                <circle cx={x(hoverI)} cy={y(s.values[hoverI] ?? 0)} r={5.5} fill={SURFACE} />
                <circle cx={x(hoverI)} cy={y(s.values[hoverI] ?? 0)} r={4} fill={s.color} />
              </>
            )}
          </g>
        ))}
      </svg>
      <div className="mt-1 flex flex-wrap items-center gap-4 text-xs text-slate-600">
        {series.map((s) => (
          <span key={s.name} className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded" style={{ background: s.color }} />
            {s.name}
          </span>
        ))}
        {hoverI !== null && (
          <span className="ml-auto tabular-nums text-slate-500">
            {labels[hoverI]}:{" "}
            {series.map((s) => `${s.name} ${formatINR(s.values[hoverI] ?? 0)}`).join(" · ")}
          </span>
        )}
      </div>
    </div>
  );
}

// ---------- paired columns ----------

export type ColumnGroup = { label: string; values: number[] };

/**
 * Grouped column chart (e.g. income vs spending per month): thin columns with
 * rounded data-ends anchored to the baseline, 2px surface gaps within a group,
 * hover tooltip, legend below.
 */
export function Columns({
  groups,
  names,
  colors,
  height = 220,
  onGroupClick,
}: {
  groups: ColumnGroup[];
  names: string[];
  colors: string[];
  height?: number;
  onGroupClick?: (index: number) => void;
}) {
  const W = 640;
  const H = height;
  const pad = { l: 46, r: 16, t: 12, b: 22 };
  const [hoverI, setHoverI] = useState<number | null>(null);

  const max = Math.max(1, ...groups.flatMap((g) => g.values));
  const niceMax = niceCeil(max);
  const y = (v: number) => H - pad.b - (v / niceMax) * (H - pad.t - pad.b);
  const slot = (W - pad.l - pad.r) / Math.max(1, groups.length);
  const barW = Math.min(18, Math.max(4, (slot * 0.7 - 2 * (names.length - 1)) / names.length));
  const ticks = [0, niceMax / 2, niceMax];

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={names.join(" vs ")}
        onMouseLeave={() => setHoverI(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
            <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" fontSize="10" fill={INK.muted}>
              {compactINR(t)}
            </text>
          </g>
        ))}
        {groups.map((g, gi) => {
          const cx = pad.l + slot * gi + slot / 2;
          const total = names.length * barW + 2 * (names.length - 1);
          return (
            <g
              key={g.label}
              opacity={hoverI !== null && hoverI !== gi ? 0.5 : 1}
              onMouseEnter={() => setHoverI(gi)}
              onClick={() => onGroupClick?.(gi)}
              style={{ cursor: onGroupClick ? "pointer" : "default" }}
            >
              {/* invisible hit target wider than the marks */}
              <rect x={cx - slot / 2} y={pad.t} width={slot} height={H - pad.t - pad.b} fill="transparent" />
              {g.values.map((v, si) => {
                const bx = cx - total / 2 + si * (barW + 2);
                const by = y(v);
                const bh = Math.max(0, H - pad.b - by);
                return (
                  <path
                    key={names[si]}
                    d={`M ${bx} ${H - pad.b} V ${by + 4} Q ${bx} ${by} ${bx + 4} ${by} H ${bx + barW - 4} Q ${bx + barW} ${by} ${bx + barW} ${by + 4} V ${H - pad.b} Z`}
                    fill={colors[si]}
                    visibility={bh < 1 ? "hidden" : undefined}
                  />
                );
              })}
              {(groups.length <= 13 || gi % 2 === 0) && (
                <text x={cx} y={H - 6} textAnchor="middle" fontSize="10" fill={INK.muted}>
                  {g.label.slice(5) || g.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex flex-wrap items-center gap-4 text-xs text-slate-600">
        {names.map((n, i) => (
          <span key={n} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: colors[i] }} />
            {n}
          </span>
        ))}
        {hoverI !== null && groups[hoverI] && (
          <span className="ml-auto tabular-nums text-slate-500">
            {groups[hoverI].label}:{" "}
            {names.map((n, i) => `${n} ${formatINR(groups[hoverI]!.values[i] ?? 0)}`).join(" · ")}
          </span>
        )}
      </div>
    </div>
  );
}

function niceCeil(v: number): number {
  const pow = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (m * pow >= v) return m * pow;
  }
  return 10 * pow;
}

// ---------- stat tile ----------

export function StatTile({
  label,
  value,
  sub,
  to,
}: {
  label: string;
  value: string;
  sub?: ReactNode;
  to?: string;
}) {
  const body = (
    <>
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-slate-800">{value}</p>
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
    </>
  );
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      {to ? <a href={to}>{body}</a> : body}
    </div>
  );
}
