import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Thermometer, Gauge, Waves, Settings, Fan } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { PointSample, Topology } from "@/lib/api";
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
  const valvePos = valve ? num(points, valve.pos) : Number.NaN;
  const dt = Math.max(0, t21 - t22);
  const dp = Math.max(0, p22 - p21);

  const tUnit = supply?.unit || "°C";
  const pUnit = supplyPressure?.unit || "bar";
  const qUnit = flow?.unit || "m³/h";
  const dtUnit = tUnit === "°C" ? "K" : tUnit;

  const fmt = (v: number, digits = 1) =>
    Number.isFinite(v) ? v.toFixed(digits) : "—";

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle>关键参数</CardTitle>
          {pumps.length > 0 && (
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              {pumps.map((pump) => (
                <span key={pump.id} className="flex items-center gap-1">
                  <Fan className="h-3 w-3" />
                  {pump.label}
                  {pumpBadge(
                    points.get(pump.run),
                    pump.fault ? points.get(pump.fault) : undefined,
                  )}
                </span>
              ))}
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-2">
        <Metric
          label={supply ? `二次侧供液 ${supply.id}` : "二次侧供液温度"}
          value={fmt(t22, 2)}
          unit={tUnit}
          icon={Thermometer}
        />
        <Metric
          label={ret ? `二次侧回水 ${ret.id}` : "二次侧回水温度"}
          value={fmt(t21, 2)}
          unit={tUnit}
          icon={Thermometer}
        />
        <Metric label="供回水温差 ΔT" value={fmt(dt, 2)} unit={dtUnit} icon={Waves} />
        <Metric
          label={flow ? `二次侧流量 ${flow.id}` : "二次侧流量"}
          value={fmt(q2, 2)}
          unit={qUnit}
          icon={Waves}
        />
        <Metric
          label={supplyPressure && returnPressure ? `泵扬程 ${supplyPressure.id}−${returnPressure.id}` : "泵扬程"}
          value={fmt(dp, 2)}
          unit={pUnit}
          icon={Gauge}
        />
        <Metric
          label={valve ? `${valve.label}开度` : "比例阀开度"}
          value={fmt(valvePos, 1)}
          unit="%"
          icon={Settings}
        />
      </CardContent>
    </Card>
  );
}
