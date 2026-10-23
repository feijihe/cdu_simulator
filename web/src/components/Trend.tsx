import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { PointSample } from "@/lib/api";
import { displayValue, unitFor } from "@/lib/api";

interface Props {
  point: PointSample | undefined;
  history: { t: number; v: number }[];
  mode: "eng" | "raw";
}

const W = 320;
const H = 96;
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

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            趋势
            {point && (
              <Badge variant={point.present ? "default" : "outline"}>{point.id}</Badge>
            )}
          </CardTitle>
          <span className="font-mono text-sm text-foreground">
            {point ? displayValue(point, mode) : "—"}
            <span className="ml-1 text-[10px] text-muted-foreground">{unitFor(point, mode)}</span>
          </span>
        </div>
      </CardHeader>
      <CardContent>
        <svg viewBox={`0 0 ${W} ${H}`} className="h-24 w-full">
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
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
          {history.length > 1 && (
            <>
              <polygon points={area} fill="var(--pid-accent)" opacity={0.08} />
              <polyline
                points={line}
                fill="none"
                stroke="var(--pid-accent)"
                strokeWidth={1.8}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </>
          )}
          {history.length <= 1 && (
            <text x={W / 2} y={H / 2} textAnchor="middle" fontSize={10} fill="var(--pid-dim)">
              等待数据…
            </text>
          )}
        </svg>
        <div className="flex justify-between font-mono text-[10px] text-muted-foreground/80">
          <span>{lo.toFixed(1)}</span>
          <span>{history.length} 点 · 约 {Math.round(history.length * 0.2)}s</span>
          <span>{hi.toFixed(1)}</span>
        </div>
      </CardContent>
    </Card>
  );
}
