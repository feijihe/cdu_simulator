import { Card } from "@/components/ui/card";
import { Status, type Tone } from "@/components/ui/badge";
import type { PointSample, Topology } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  flowPoint,
  pressureOn,
  pumpsOf,
  segmentOf,
  tempOn,
  valveOf,
} from "@/lib/topology";

interface Props {
  points: Map<string, PointSample>;
  topology: Topology;
}

function num(points: Map<string, PointSample>, id: string) {
  const p = points.get(id);
  return p && p.present ? p.v : Number.NaN;
}

function fmt(v: number) {
  return Number.isFinite(v) ? v.toFixed(1) : "—";
}

function pumpState(
  points: Map<string, PointSample>,
  pump: ReturnType<typeof pumpsOf>[number],
) {
  const fault = pump.fault ? points.get(pump.fault) : undefined;
  if (fault?.v === 1) return { tone: "danger" as Tone, label: "故障" };
  if (points.get(pump.run)?.v === 1) return { tone: "ok" as Tone, label: "运行" };
  return { tone: "neutral" as Tone, label: "停止" };
}

export default function KeyMetrics({ points, topology }: Props) {
  const supplySegment = segmentOf(topology, "secondary", "post_hx");
  const returnSegment = segmentOf(topology, "secondary", "pre_hx");

  const supply = tempOn(points, supplySegment);
  const ret = tempOn(points, returnSegment);
  const flowSegment = supplySegment ?? returnSegment;
  const flow = flowSegment ? flowPoint(topology, points, flowSegment) : undefined;
  const supplyPressure = pressureOn(points, supplySegment);
  const returnPressure = pressureOn(points, returnSegment);
  const valve = valveOf(topology);
  const pumps = pumpsOf(topology);

  const t22 = supply ? num(points, supply.id) : Number.NaN;
  const t21 = ret ? num(points, ret.id) : Number.NaN;
  const q2 = flow ? num(points, flow.id) : Number.NaN;
  const p22 = supplyPressure ? num(points, supplyPressure.id) : Number.NaN;
  const p21 = returnPressure ? num(points, returnPressure.id) : Number.NaN;

  const dt = Math.max(0, t21 - t22);
  const dp = Math.max(0, p22 - p21);
  const valvePos = valve ? num(points, valve.pos) : Number.NaN;

  const cells = [
    { label: "二次侧供液", tag: supply?.id, value: fmt(t22), unit: supply?.unit || "°C" },
    { label: "二次侧回水", tag: ret?.id, value: fmt(t21), unit: ret?.unit || "°C" },
    {
      label: "供回水温差",
      tag: undefined,
      value: fmt(dt),
      unit: supply?.unit === "°C" ? "K" : "°C",
    },
    { label: "二次侧流量", tag: flow?.id, value: fmt(q2), unit: flow?.unit || "m³/h" },
    { label: "泵扬程", tag: undefined, value: fmt(dp), unit: supplyPressure?.unit || "bar" },
    {
      label: valve ? `${valve.label} 开度` : "比例阀开度",
      tag: undefined,
      value: Number.isFinite(valvePos) ? valvePos.toFixed(0) : "—",
      unit: "%",
    },
  ];

  return (
    <Card className="shrink-0 overflow-hidden">
      <div className="flex h-9 items-center justify-between gap-3 px-4">
        <h2 className="text-[12px] font-medium text-foreground">关键参数</h2>
        <div className="flex items-center gap-3">
          {pumps.map((pump) => {
            const state = pumpState(points, pump);
            return (
              <Status key={pump.id} tone={state.tone}>
                {pump.label} {state.label}
              </Status>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-3 border-t border-border">
        {cells.map((cell, i) => (
          <div
            key={cell.label}
            className={cn(
              "px-3 py-2",
              i % 3 !== 0 && "border-l border-border",
              i >= 3 && "border-t border-border",
            )}
          >
            <div className="flex items-baseline justify-between gap-1">
              <span className="truncate text-[10px] leading-4 text-muted-foreground">
                {cell.label}
              </span>
              {cell.tag && (
                <span className="shrink-0 font-mono text-[10px] leading-4 text-muted-foreground">
                  {cell.tag}
                </span>
              )}
            </div>
            <div className="mt-0.5 flex items-baseline gap-1">
              <span className="font-mono text-[19px] leading-6 tabular-nums text-foreground">
                {cell.value}
              </span>
              <span className="text-[10px] text-muted-foreground">{cell.unit}</span>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
