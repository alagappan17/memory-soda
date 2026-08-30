import { useState } from 'react';
import { Info } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

/**
 * One-series time chart in plain SVG: y gridlines with ticks, x labels, a
 * hover crosshair with the value, bar or line marks. Monochrome, so no
 * palette; the title names the series, so no legend.
 */
export interface ChartPoint {
  bucket: string;
  value: number;
}

const W = 600;
const H = 200;
const PAD = { top: 12, right: 12, bottom: 28, left: 48 };

/** 4 "nice" y ticks (1/2/5 × 10^n) covering the data max. */
function ticksFor(max: number): number[] {
  if (max <= 0) return [0];
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) out.push(v);
  if (out[out.length - 1]! < max) out.push(out[out.length - 1]! + step);
  return out;
}

const shortDate = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

export function UsageChart({
  title,
  info,
  rows,
  format,
  type = 'bar',
}: {
  title: string;
  /** What the graph depicts, shown on the (i) hover. */
  info: string;
  rows: ChartPoint[];
  format: (n: number) => string;
  type?: 'bar' | 'line';
}) {
  const [hover, setHover] = useState<number | null>(null);

  const ticks = ticksFor(Math.max(0, ...rows.map((r) => r.value)));
  const yMax = ticks[ticks.length - 1] || 1;
  const iw = W - PAD.left - PAD.right;
  const ih = H - PAD.top - PAD.bottom;
  const n = rows.length;
  const slot = n > 0 ? iw / n : iw;
  const x = (i: number) => PAD.left + slot * i + slot / 2;
  const y = (v: number) => PAD.top + ih - (ih * v) / yMax;

  // Label every k-th bucket so labels never collide (~70px each).
  const every = Math.max(1, Math.ceil(n / Math.floor(iw / 70)));
  const total = rows.reduce((a, r) => a + r.value, 0);

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.floor((px - PAD.left) / slot);
    setHover(i >= 0 && i < n ? i : null);
  };

  const h = hover !== null ? rows[hover] : undefined;

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-2">
          <div>
            <div className="text-sm font-medium">{title}</div>
            <div className="text-xs text-muted-foreground tabular-nums">
              {h
                ? `${shortDate(h.bucket)} · ${format(h.value)}`
                : `Total ${format(total)}`}
            </div>
          </div>
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label={`About ${title}`}
                  className="text-muted-foreground hover:text-foreground cursor-help"
                />
              }
            >
              <Info className="h-4 w-4" />
            </TooltipTrigger>
            <TooltipContent side="left" className="max-w-64">
              {info}
            </TooltipContent>
          </Tooltip>
        </div>

        {n === 0 ? (
          <div className="h-[200px] flex items-center justify-center text-xs text-muted-foreground">
            No data in this window.
          </div>
        ) : (
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="w-full h-auto select-none"
            onMouseMove={onMove}
            onMouseLeave={() => setHover(null)}
            role="img"
            aria-label={`${title}: ${info}`}
          >
            {/* y grid + ticks */}
            {ticks.map((t) => (
              <g key={t}>
                <line
                  x1={PAD.left}
                  x2={W - PAD.right}
                  y1={y(t)}
                  y2={y(t)}
                  className="stroke-border"
                  strokeWidth={1}
                />
                <text
                  x={PAD.left - 6}
                  y={y(t) + 3}
                  textAnchor="end"
                  className="fill-muted-foreground"
                  fontSize={10}
                >
                  {format(t)}
                </text>
              </g>
            ))}
            {/* x labels */}
            {rows.map((r, i) =>
              i % every === 0 || i === n - 1 ? (
                <text
                  key={r.bucket}
                  x={x(i)}
                  y={H - 8}
                  textAnchor="middle"
                  className="fill-muted-foreground"
                  fontSize={10}
                >
                  {shortDate(r.bucket)}
                </text>
              ) : null,
            )}
            {/* marks */}
            {type === 'bar' ? (
              rows.map((r, i) => {
                const bw = Math.max(2, slot * 0.7);
                const top = y(r.value);
                return (
                  <rect
                    key={r.bucket}
                    x={x(i) - bw / 2}
                    y={top}
                    width={bw}
                    height={Math.max(0, PAD.top + ih - top)}
                    rx={Math.min(3, bw / 2)}
                    className={
                      hover === i ? 'fill-foreground' : 'fill-foreground/75'
                    }
                  />
                );
              })
            ) : (
              <>
                <path
                  d={rows
                    .map(
                      (r, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(r.value)}`,
                    )
                    .join(' ')}
                  fill="none"
                  className="stroke-foreground"
                  strokeWidth={2}
                  strokeLinejoin="round"
                />
                {h && hover !== null && (
                  <circle
                    cx={x(hover)}
                    cy={y(h.value)}
                    r={4}
                    className="fill-foreground stroke-background"
                    strokeWidth={2}
                  />
                )}
              </>
            )}
            {/* crosshair */}
            {hover !== null && (
              <line
                x1={x(hover)}
                x2={x(hover)}
                y1={PAD.top}
                y2={PAD.top + ih}
                className="stroke-muted-foreground"
                strokeDasharray="3 3"
              />
            )}
          </svg>
        )}
      </CardContent>
    </Card>
  );
}
