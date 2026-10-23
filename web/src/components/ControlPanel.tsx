import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import type { Boundary, PointSample } from "@/lib/api";
import { clearBoundary, putBoundary, putPoint } from "@/lib/api";

interface Props {
  points: Map<string, PointSample>;
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

const TEMP_UNITS = new Set(["°c", "c", "°f", "f", "k"]);

/** 按 place 找管段上最靠近板换的温度测点，不依赖具体位号 */
function pickTemp(
  points: Map<string, PointSample>,
  loop: "primary" | "secondary",
  branch: "pre_hx" | "post_hx",
) {
  return [...points.values()]
    .filter(
      (p) =>
        p.place &&
        p.place.loop === loop &&
        p.place.branch === branch &&
        TEMP_UNITS.has(p.unit.trim().toLowerCase()),
    )
    .sort((a, b) => b.place!.order - a.place!.order)[0];
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

export default function ControlPanel({ points, boundary, facility, returnTemp, ua }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditField | null>(null);

  const primaryTag = pickTemp(points, "primary", "pre_hx");
  const returnTag = pickTemp(points, "secondary", "pre_hx");

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

  const valveCmd = num(points, "VALVE_CMD");
  const valvePos = num(points, "VALVE_POS");

  const pumps = [1, 2].map((index) => ({
    index,
    runCmd: points.get(`PUMP${index}_RUN_CMD`)?.v === 1,
    runFb: points.get(`PUMP${index}_RUN`)?.v === 1,
    speedCmd: num(points, `PUMP${index}_SPEED_CMD`),
  }));

  return (
    <div className="mb-2 grid grid-cols-1 gap-3 rounded-lg border border-border bg-card/60 px-3 py-2 md:grid-cols-3">
      <div>
        <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>比例阀开度</span>
          <span className="font-mono text-muted-foreground">实际 {valvePos.toFixed(1)}%</span>
        </div>
        <CommandSlider value={valveCmd} onCommit={(v) => send("VALVE_CMD", { value: v })} />
      </div>

      {pumps.map((pump) => (
        <div key={pump.index} className="md:border-l md:border-border md:pl-4">
          <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              泵 {pump.index}
              <Badge variant={pump.runFb ? "success" : "outline"}>
                {pump.runFb ? "运行" : "停止"}
              </Badge>
            </span>
            <Button
              size="sm"
              variant={pump.runCmd ? "secondary" : "outline"}
              className="h-5 px-2 text-[10px]"
              onClick={() => send(`PUMP${pump.index}_RUN_CMD`, { on: !pump.runCmd })}
            >
              {pump.runCmd ? "停止" : "启动"}
            </Button>
          </div>
          <CommandSlider
            value={pump.speedCmd}
            onCommit={(v) => send(`PUMP${pump.index}_SPEED_CMD`, { value: v })}
          />
        </div>
      ))}

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
          label={`一次侧进水${primaryTag ? ` · ${primaryTag.id}` : "（未配置测点）"}`}
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
          label={`二次侧回水${returnTag ? ` · ${returnTag.id}` : "（未配置测点）"}`}
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
