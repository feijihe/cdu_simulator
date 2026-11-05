import { Card } from "@/components/ui/card";
import { Tag } from "@/components/ui/badge";
import type { PointSample } from "@/lib/api";
import { displayValue, unitFor } from "@/lib/api";

interface Props {
  point: PointSample | undefined;
  history: { t: number; v: number }[];
  mode: "eng" | "raw";
}

const W = 320;
const H = 88;
const PAD = 6;

export default function Trend({ point, history, mode }: Props) {
  const values = history.map((h) => h.v);
  let lo = 0;
  let hi = 1;
  if (values.length > 0) {
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min;
    if (span < 1e-6) {
      lo = min - 1;
      hi = max + 1;
    } else {
      lo = min - span * 0.15;
      hi = max + span * 0.15;
    }
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi - lo < 1e-9) {
    lo = 0;
    hi = 1;
  }

  const x = (i: number) => PAD + (i / Math.max(1, history.length - 1)) * (W - PAD * 2);
  const y = (v: number) => {
    const f = (v - lo) / (hi - lo);
    return H - PAD - Math.min(1, Math.max(0, f)) * (H - PAD * 2);
  };

  const line = history.map((h, i) => `${x(i).toFixed(1)},${y(h.v).toFixed(1)}`).join(" ");
  const area = history.length
    ? `${PAD},${H - PAD} ${line} ${x(history.length - 1).toFixed(1)},${H - PAD}`
    : "";
  const last = history.at(-1);
  const windowSeconds =
    history.length > 1 && last ? Math.round((last.t - history[0].t) / 1000) : 0;

  return (
    <Card className="shrink-0">
      <div className="flex h-9 items-center justify-between gap-2 px-4">
        <div className="flex items-center gap-2">
          <h2 className="text-[12px] font-medium text-foreground">趋势</h2>
          {point && <Tag tone={point.present ? "accent" : "muted"}>{point.id}</Tag>}
        </div>
        <div className="flex items-baseline gap-1">
          <span className="font-mono text-[15px] leading-5 tabular-nums text-foreground">
            {point ? displayValue(point, mode) : "—"}
          </span>
          <span className="text-[10px] text-muted-foreground">{unitFor(point, mode)}</span>
        </div>
      </div>

      <div className="px-4 pb-2">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-[88px] w-full" aria-hidden="true">
          {[0, 0.5, 1].map((f) => (
            <line
              key={f}
              x1={PAD}
              x2={W - PAD}
              y1={PAD + f * (H - PAD * 2)}
              y2={PAD + f * (H - PAD * 2)}
              stroke="var(--pid-border)"
              strokeWidth={1}
            />
          ))}

          {history.length > 1 ? (
            <>
              <polygon points={area} fill="hsl(var(--primary))" opacity={0.08} />
              <polyline
                points={line}
                fill="none"
                stroke="hsl(var(--primary))"
                strokeWidth={1.5}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {last && (
                <circle
                  cx={x(history.length - 1)}
                  cy={y(last.v)}
                  r={2.5}
                  fill="hsl(var(--primary))"
                  stroke="hsl(var(--card))"
                  strokeWidth={1.5}
                />
              )}
            </>
          ) : (
            <text
              x={W / 2}
              y={H / 2 + 3}
              textAnchor="middle"
              fontSize={10}
              fill="var(--pid-dim)"
            >
              等待数据
            </text>
          )}
        </svg>

        <div className="flex items-baseline justify-between font-mono text-[10px] tabular-nums text-muted-foreground">
          <span>
            {lo.toFixed(1)} – {hi.toFixed(1)} {point ? unitFor(point, mode) : ""}
          </span>
          <span>{windowSeconds > 0 ? `${windowSeconds} s 窗口` : "—"}</span>
        </div>
      </div>
    </Card>
  );
}
