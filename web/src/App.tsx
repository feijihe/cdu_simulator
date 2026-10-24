import { useEffect, useMemo, useState } from "react";
import { Activity, Moon, Radio, Sun, WifiOff } from "lucide-react";
import PidDiagram from "@/components/PidDiagram";
import KeyMetrics from "@/components/KeyMetrics";
import ControlPanel from "@/components/ControlPanel";
import Trend from "@/components/Trend";
import PointPanel from "@/components/PointPanel";
import TagEditor from "@/components/TagEditor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useSimulation } from "@/hooks/useSimulation";
import { useTopology } from "@/hooks/useTopology";
import type { PointSample } from "@/lib/api";
import {
  defaultSelection,
  flowPoint,
  pumpsOf,
  segmentOf,
  synthesizeTopology,
  valveOf,
} from "@/lib/topology";

type Mode = "eng" | "raw";

function pointValue(point: PointSample | undefined, digits: number) {
  if (!point || !point.present) return "—";
  return point.v.toFixed(digits);
}

function Stat({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/40 px-3 py-2">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="font-mono text-sm text-foreground">
        {value}
        {unit && <span className="ml-1 text-[10px] text-muted-foreground">{unit}</span>}
      </div>
    </div>
  );
}

export default function App() {
  const { snapshot, status, retry } = useSimulation();
  const topologyState = useTopology();
  const [mode, setMode] = useState<Mode>("eng");
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [history, setHistory] = useState<{ t: number; v: number }[]>([]);
  const [theme, setTheme] = useState<"dark" | "light">(() =>
    document.documentElement.classList.contains("dark") ? "dark" : "light",
  );

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.classList.toggle("dark", next === "dark");
    try {
      localStorage.setItem("cdu-theme", next);
    } catch {
      // ignore storage failures
    }
    setTheme(next);
  };

  const points = useMemo(
    () => new Map<string, PointSample>((snapshot?.points ?? []).map((p) => [p.id, p])),
    [snapshot],
  );

  const topology = useMemo(
    () => topologyState ?? synthesizeTopology(points),
    [topologyState, points],
  );

  const selectedId =
    selected && points.has(selected) ? selected : defaultSelection(topology, points);

  useEffect(() => {
    setHistory([]);
  }, [selectedId]);

  useEffect(() => {
    if (!snapshot) return;
    const p = points.get(selectedId);
    if (!p || !p.present) return;
    setHistory((prev) => [...prev.slice(-359), { t: snapshot.ts, v: p.v }]);
  }, [snapshot, points, selectedId]);

  const selectedPoint = points.get(selectedId);
  const editingPoint = editing ? points.get(editing) : undefined;
  const time = snapshot
    ? new Date(snapshot.ts).toLocaleTimeString("zh-CN", { hour12: false })
    : "--:--:--";

  const primarySegment = segmentOf(topology, "primary", "pre_hx");
  const secondarySegment = segmentOf(topology, "secondary", "post_hx");
  const primaryFlow = primarySegment
    ? flowPoint(topology, points, primarySegment)
    : undefined;
  const secondaryFlow = secondarySegment
    ? flowPoint(topology, points, secondarySegment)
    : undefined;
  const valve = valveOf(topology);
  const pumps = pumpsOf(topology);
  const runningPumps = pumps.filter((p) => points.get(p.run)?.v === 1).length;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-3 px-5 py-2.5">
          <Activity className="h-5 w-5 text-primary" />
          <div>
            <div className="text-sm font-semibold">CDU 模拟器</div>
            <div className="text-[10px] text-muted-foreground">
              cdu_simulator v0.2 · Modbus TCP + WebSocket
            </div>
          </div>
          <Badge
            variant={
              status === "open" ? "success" : status === "connecting" ? "warning" : "danger"
            }
          >
            <Radio className="h-3 w-3" />
            {status === "open" ? "实时" : status === "connecting" ? "连接中" : "已断开"}
          </Badge>
          <span className="font-mono text-[11px] text-muted-foreground">更新 {time}</span>

          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={toggleTheme}
              title={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"}
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            <div className="flex items-center gap-1 rounded-md border border-border p-0.5">
              <Button
                size="sm"
                variant={mode === "eng" ? "secondary" : "ghost"}
                onClick={() => setMode("eng")}
                className="h-6 px-2 text-[11px]"
              >
                工程值
              </Button>
              <Button
                size="sm"
                variant={mode === "raw" ? "secondary" : "ghost"}
                onClick={() => setMode("raw")}
                className="h-6 px-2 text-[11px]"
              >
                原始信号
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-[1600px] grid-cols-1 gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_390px]">
        <section className="rounded-xl border border-border bg-card/50 p-2">
          <ControlPanel
            points={points}
            topology={topology}
            boundary={snapshot?.boundary}
            facility={snapshot?.facility_c}
            returnTemp={snapshot?.return_c}
            ua={snapshot?.ua_kw_per_k}
          />
          <PidDiagram
            points={points}
            topology={topology}
            selected={selectedId}
            mode={mode}
            onSelect={setSelected}
          />
          <div className="mt-1 grid grid-cols-2 gap-2 px-2 md:grid-cols-4">
            <Stat
              label={primaryFlow ? `一次侧流量 ${primaryFlow.id}` : "一次侧流量"}
              value={pointValue(primaryFlow, 2)}
              unit={primaryFlow?.unit ?? ""}
            />
            <Stat
              label={secondaryFlow ? `二次侧流量 ${secondaryFlow.id}` : "二次侧流量"}
              value={pointValue(secondaryFlow, 2)}
              unit={secondaryFlow?.unit ?? ""}
            />
            <Stat
              label={valve ? `${valve.label}开度` : "比例阀开度"}
              value={pointValue(valve ? points.get(valve.pos) : undefined, 1)}
              unit="%"
            />
            <Stat
              label="泵运行"
              value={pumps.length > 0 ? `${runningPumps}/${pumps.length}` : "—"}
              unit="台"
            />
          </div>
          <div className="px-3 py-2 text-[10px] text-muted-foreground/80">
            Modbus TCP :1502 · WebSocket /ws · 点表 config/tags.yaml · 系统图由 topology 渲染 · 模拟量输出原始信号
          </div>
        </section>

        <aside className="flex min-h-0 flex-col gap-4 xl:h-[calc(100vh-88px)]">
          <KeyMetrics points={points} topology={topology} />
          <Trend point={selectedPoint} history={history} mode={mode} />
          <PointPanel
            points={snapshot?.points ?? []}
            selected={selectedId}
            mode={mode}
            onSelect={setSelected}
            onEdit={setEditing}
          />
        </aside>
      </main>

      {editingPoint && <TagEditor point={editingPoint} onClose={() => setEditing(null)} />}

      {status === "closed" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm">
          <div className="flex w-full max-w-sm flex-col items-center gap-3 rounded-xl border border-border bg-card p-6 text-center shadow-xl">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400">
              <WifiOff className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-medium">WebSocket 连接已断开</div>
              <div className="mt-1 text-xs text-muted-foreground">
                模拟器可能已停止，页面会每 1.5 秒自动重连。
              </div>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
              正在重连
            </div>
            <Button size="sm" variant="outline" onClick={retry}>
              立即重试
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
