import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import type { Boundary, PointSample, Topology } from "@/lib/api";
import { clearBoundary, putBoundary, putPoint } from "@/lib/api";
import { pumpsOf, segmentOf, tempOn, valveOf } from "@/lib/topology";

interface Props {
  points: Map<string, PointSample>;
  topology: Topology;
  boundary?: Boundary;
  facility?: number;
  returnTemp?: number;
  ua?: number;
}

type EditField = "t11" | "t21" | "ua";

function num(points: Map<string, PointSample>, id: string) {
  const p = points.get(id);
  return p && p.present ? p.v : 0;
}

function CommandSlider({
  value,
  onCommit,
}: {
  value: number;
  onCommit: (value: number) => void;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);

  return (
    <div className="flex items-center gap-2">
      <Slider
        value={[local]}
        max={100}
        step={1}
        onValueChange={(next) => setLocal(next[0])}
        onValueCommit={(next) => onCommit(next[0])}
      />
      <span className="w-9 shrink-0 text-right font-mono text-[11px] text-foreground">
        {local.toFixed(0)}%
      </span>
    </div>
  );
}

function BoundarySlider({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (value: number) => void;
  onCommit: (value: number) => void;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span className="truncate">{label}</span>
        <span className="shrink-0 font-mono text-foreground">
          {value.toFixed(1)} <span className="text-[10px] text-muted-foreground">{unit}</span>
        </span>
      </div>
      <Slider
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={(next) => onChange(next[0])}
        onValueCommit={(next) => onCommit(next[0])}
      />
    </div>
  );
}

export default function ControlPanel({
  points,
  topology,
  boundary,
  facility,
  returnTemp,
  ua,
}: Props) {
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditField | null>(null);

  const valve = valveOf(topology);
  const pumps = pumpsOf(topology);
  const primarySegment = segmentOf(topology, "primary", "pre_hx");
  const returnSegment = segmentOf(topology, "secondary", "pre_hx");
  const primaryTag = tempOn(points, primarySegment);
  const returnTag = tempOn(points, returnSegment);

  const t11Target = boundary?.facility_c ?? facility ?? 30;
  const t21Target = boundary?.return_c ?? returnTemp ?? 40;
  const uaTarget = boundary?.ua_kw_per_k ?? ua ?? 8;

  const [t11, setT11] = useState(t11Target);
  const [t21, setT21] = useState(t21Target);
  const [uaValue, setUaValue] = useState(uaTarget);

  useEffect(() => {
    if (editing !== "t11") setT11(t11Target);
  }, [t11Target, editing]);
  useEffect(() => {
    if (editing !== "t21") setT21(t21Target);
  }, [t21Target, editing]);
  useEffect(() => {
    if (editing !== "ua") setUaValue(uaTarget);
  }, [uaTarget, editing]);

  const send = async (id: string, body: { value?: number; on?: boolean }) => {
    try {
      await putPoint(id, body);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const commitBoundary = async (
    field: "facility_c" | "return_c" | "ua_kw_per_k",
    value: number,
  ) => {
    try {
      await putBoundary({ [field]: value });
      setEditing(null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const resetBoundary = async () => {
    try {
      await clearBoundary();
      setEditing(null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const valveCmd = valve ? num(points, valve.cmd) : 0;
  const valvePos = valve ? num(points, valve.pos) : 0;

  return (
    <div className="mb-2 grid grid-cols-1 gap-3 rounded-lg border border-border bg-card/60 px-3 py-2 md:grid-cols-3">
      {valve ? (
        <div>
          <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>{valve.label}</span>
            <span className="font-mono text-muted-foreground">实际 {valvePos.toFixed(1)}%</span>
          </div>
          <CommandSlider
            value={valveCmd}
            onCommit={(v) => send(valve.cmd, { value: v })}
          />
        </div>
      ) : (
        <div className="flex items-center text-[11px] text-muted-foreground">
          点表未在 topology 中配置比例阀
        </div>
      )}

      {pumps.map((pump) => {
        const runCmd = points.get(pump.run_cmd)?.v === 1;
        const runFb = points.get(pump.run)?.v === 1;
        const fault = pump.fault ? points.get(pump.fault)?.v === 1 : false;
        return (
          <div key={pump.id} className="md:border-l md:border-border md:pl-4">
            <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1.5">
                {pump.label}
                <Badge variant={fault ? "danger" : runFb ? "success" : "outline"}>
                  {fault ? "故障" : runFb ? "运行" : "停止"}
                </Badge>
              </span>
              <Button
                size="sm"
                variant={runCmd ? "secondary" : "outline"}
                className="h-5 px-2 text-[10px]"
                onClick={() => send(pump.run_cmd, { on: !runCmd })}
              >
                {runCmd ? "停止" : "启动"}
              </Button>
            </div>
            <CommandSlider
              value={num(points, pump.speed_cmd)}
              onCommit={(v) => send(pump.speed_cmd, { value: v })}
            />
          </div>
        );
      })}

      <div className="col-span-full flex flex-wrap items-center gap-2 border-t border-border pt-2 text-[11px] text-muted-foreground">
        <span className="text-muted-foreground">边界条件</span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[10px]"
          onClick={resetBoundary}
        >
          自动
        </Button>
        {boundary?.facility_c != null && <Badge variant="warning">进水 手动</Badge>}
        {boundary?.return_c != null && <Badge variant="warning">回水 手动</Badge>}
        {boundary?.ua_kw_per_k != null && <Badge variant="warning">UA 手动</Badge>}
        <span className="ml-auto text-[10px] text-muted-foreground/80">
          设定的是物理边界，传感器读数随之变化
        </span>
      </div>

      <div className="col-span-full grid grid-cols-1 gap-3 md:grid-cols-3">
        <BoundarySlider
          label={`${primarySegment?.label ?? "一次侧进水"}${primaryTag ? ` · ${primaryTag.id}` : "（未配置测点）"}`}
          value={t11}
          min={0}
          max={60}
          step={0.5}
          unit="°C"
          onChange={(v) => {
            setEditing("t11");
            setT11(v);
          }}
          onCommit={(v) => commitBoundary("facility_c", v)}
        />
        <BoundarySlider
          label={`${returnSegment?.label ?? "二次侧回水"}${returnTag ? ` · ${returnTag.id}` : "（未配置测点）"}`}
          value={t21}
          min={10}
          max={70}
          step={0.5}
          unit="°C"
          onChange={(v) => {
            setEditing("t21");
            setT21(v);
          }}
          onCommit={(v) => commitBoundary("return_c", v)}
        />
        <BoundarySlider
          label="板换 UA"
          value={uaValue}
          min={1}
          max={200}
          step={1}
          unit="kW/K"
          onChange={(v) => {
            setEditing("ua");
            setUaValue(v);
          }}
          onCommit={(v) => commitBoundary("ua_kw_per_k", v)}
        />
      </div>

      {error && <div className="col-span-full text-[10px] text-red-600 dark:text-red-300">{error}</div>}
    </div>
  );
}
