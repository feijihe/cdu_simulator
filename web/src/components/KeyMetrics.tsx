import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Thermometer, Gauge, Waves, Settings, Fan } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { PointSample } from "@/lib/api";

interface Props {
  points: Map<string, PointSample>;
}

function num(points: Map<string, PointSample>, id: string) {
  const p = points.get(id);
  return p && p.present ? p.v : Number.NaN;
}

function Metric({
  label,
  value,
  unit,
  icon: Icon,
}: {
  label: string;
  value: string;
  unit: string;
  icon: LucideIcon;
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/40 p-2.5">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="font-mono text-lg font-semibold text-foreground">{value}</span>
        <span className="text-[10px] text-muted-foreground">{unit}</span>
      </div>
    </div>
  );
}

function pumpBadge(p: PointSample | undefined, fault: PointSample | undefined) {
  if (fault?.v === 1) return <Badge variant="danger">故障</Badge>;
  if (p?.v === 1) return <Badge variant="success">运行</Badge>;
  return <Badge variant="outline">停止</Badge>;
}

export default function KeyMetrics({ points }: Props) {
  const t22 = num(points, "T22");
  const t21 = num(points, "T21");
  const q2 = num(points, "Q2");
  const p22 = num(points, "P22");
  const p21 = num(points, "P21");
  const valve = num(points, "VALVE_POS");
  const dt = Math.max(0, t21 - t22);
  const dp = Math.max(0, p22 - p21);

  const tUnit = points.get("T22")?.unit || "°C";
  const pUnit = points.get("P22")?.unit || "bar";
  const qUnit = points.get("Q2")?.unit || "m³/h";
  const dtUnit = tUnit === "°C" ? "K" : tUnit;

  const fmt = (v: number, digits = 1) =>
    Number.isFinite(v) ? v.toFixed(digits) : "—";

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle>关键参数</CardTitle>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <Fan className="h-3 w-3" /> 泵 1
            </span>
            {pumpBadge(points.get("PUMP1_RUN"), points.get("PUMP1_FAULT"))}
            <span className="ml-1 flex items-center gap-1">泵 2</span>
            {pumpBadge(points.get("PUMP2_RUN"), points.get("PUMP2_FAULT"))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-2">
        <Metric label="二次侧供液 T22" value={fmt(t22, 2)} unit={tUnit} icon={Thermometer} />
        <Metric label="二次侧回水 T21" value={fmt(t21, 2)} unit={tUnit} icon={Thermometer} />
        <Metric label="供回水温差 ΔT" value={fmt(dt, 2)} unit={dtUnit} icon={Waves} />
        <Metric label="二次侧流量 Q2" value={fmt(q2, 2)} unit={qUnit} icon={Waves} />
        <Metric label="泵扬程 P22−P21" value={fmt(dp, 2)} unit={pUnit} icon={Gauge} />
        <Metric label="比例阀开度" value={fmt(valve, 1)} unit="%" icon={Settings} />
      </CardContent>
    </Card>
  );
}
