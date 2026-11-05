import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Status, type Tone } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import type { Boundary, PointSample, Topology } from "@/lib/api";
import { clearBoundary, putBoundary, putPoint } from "@/lib/api";
import { pumpsOf, segmentOf, tempOn, valveOf } from "@/lib/topology";
import { cn } from "@/lib/utils";

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
    <div className="flex items-center gap-3">
      <Slider
        value={[local]}
        max={100}
        step={1}
        onValueChange={(next) => setLocal(next[0])}
        onValueCommit={(next) => onCommit(next[0])}
      />
      <span className="w-9 shrink-0 text-right font-mono text-[11px] tabular-nums text-foreground">
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
      <div className="flex items-baseline justify-between gap-2 text-[11px]">
        <span className="truncate text-muted-foreground">{label}</span>
        <span className="shrink-0 font-mono tabular-nums text-foreground">
          {value.toFixed(1)}
          <span className="ml-1 text-[10px] text-muted-foreground">{unit}</span>
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
  const [boundaryOpen, setBoundaryOpen] = useState(false);

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
  const overridden =
    boundary?.facility_c != null || boundary?.return_c != null || boundary?.ua_kw_per_k != null;

  return (
    <div className="shrink-0 border-b border-border">
      <div className="grid grid-cols-1 gap-x-6 gap-y-4 px-4 pb-1 pt-3 md:grid-cols-3">
        <div>
          <div className="flex items-baseline justify-between gap-2 text-[11px]">
            <span className="text-muted-foreground">
              {valve ? valve.label : "比例阀"}
            </span>
            {valve ? (
              <span className="font-mono tabular-nums text-muted-foreground">
                反馈 {valvePos.toFixed(0)}%
              </span>
            ) : (
              <span className="text-[10px] text-muted-foreground">未配置</span>
            )}
          </div>
          {valve ? (
            <CommandSlider value={valveCmd} onCommit={(v) => send(valve.cmd, { value: v })} />
          ) : (
            <p className="py-2 text-[10px] text-muted-foreground">
              在 topology 中配置比例阀后可在这里控制
            </p>
          )}
        </div>

        {pumps.map((pump, index) => {
          const runCmd = points.get(pump.run_cmd)?.v === 1;
          const runFb = points.get(pump.run)?.v === 1;
          const fault = pump.fault ? points.get(pump.fault)?.v === 1 : false;
          const tone: Tone = fault ? "danger" : runFb ? "ok" : "neutral";
          return (
            <div
              key={pump.id}
              className={cn(index >= 0 && "md:border-l md:border-border md:pl-6")}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <span className="text-[11px] text-muted-foreground">{pump.label}</span>
                  <Status tone={tone}>{fault ? "故障" : runFb ? "运行" : "停止"}</Status>
                </span>
                <Button
                  size="sm"
                  variant={runCmd ? "secondary" : "outline"}
                  className="h-6 px-2 text-[10px]"
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
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-[11px]">
        <button
          type="button"
          onClick={() => setBoundaryOpen((open) => !open)}
          aria-expanded={boundaryOpen}
          className="flex items-center gap-1 rounded-[4px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          <ChevronRight
            className={cn(
              "h-4 w-4 transition-transform duration-150",
              boundaryOpen && "rotate-90",
            )}
          />
          边界条件
        </button>
        <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
          进水 {t11Target.toFixed(1)} °C · 回水 {t21Target.toFixed(1)} °C · UA{" "}
          {uaTarget.toFixed(1)} kW/K
        </span>
        {overridden && <span className="text-[10px] text-warn">手动</span>}
        {overridden && (
          <button
            type="button"
            onClick={resetBoundary}
            className="ml-auto rounded-[4px] text-[10px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            恢复自动
          </button>
        )}
      </div>

      {boundaryOpen && (
        <div className="grid grid-cols-1 gap-4 border-t border-border px-4 py-3 md:grid-cols-3">
          <BoundarySlider
            label={`${primarySegment?.label ?? "一次侧进水"}${primaryTag ? ` · ${primaryTag.id}` : ""}`}
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
            label={`${returnSegment?.label ?? "二次侧回水"}${returnTag ? ` · ${returnTag.id}` : ""}`}
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
      )}

      {error && <div className="px-4 pb-2 text-[11px] text-danger">{error}</div>}
    </div>
  );
}
