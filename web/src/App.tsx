import { useEffect, useMemo, useState } from "react";
import { Moon, Settings2, Sun, WifiOff } from "lucide-react";
import PidDiagram from "@/components/PidDiagram";
import KeyMetrics from "@/components/KeyMetrics";
import ControlPanel from "@/components/ControlPanel";
import ConfigPage from "@/components/ConfigPage";
import Trend from "@/components/Trend";
import PointPanel from "@/components/PointPanel";
import TagEditor from "@/components/TagEditor";
import { Button } from "@/components/ui/button";
import { Status } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useSimulation } from "@/hooks/useSimulation";
import { useTopology } from "@/hooks/useTopology";
import type { PointSample } from "@/lib/api";
import { defaultSelection, synthesizeTopology } from "@/lib/topology";

type Mode = "eng" | "raw";

function useHashPath() {
  const [path, setPath] = useState(
    () => window.location.hash.replace(/^#/, "") || "/",
  );

  useEffect(() => {
    const onChange = () => setPath(window.location.hash.replace(/^#/, "") || "/");
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  return path;
}

/** 产品标记：板换的板片剖面，单色、无渐变。 */
function Mark() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      aria-hidden="true"
      className="shrink-0 text-foreground"
    >
      <rect
        x="1.5"
        y="1.5"
        width="15"
        height="15"
        rx="3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path d="M5 5v8M9 5v8M13 5v8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

export default function App() {
  const { snapshot, status, retry } = useSimulation();
  const { topology: topologyState, reload: reloadTopology } = useTopology(status);
  const hashPath = useHashPath();
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

  if (hashPath === "/config") {
    return (
      <ConfigPage
        onBack={() => {
          window.location.hash = "";
        }}
        onApplied={reloadTopology}
      />
    );
  }

  const stateTone = status === "open" ? "ok" : status === "connecting" ? "warn" : "danger";
  const stateLabel = status === "open" ? "实时" : status === "connecting" ? "连接中" : "已断开";

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1680px] items-center gap-3 px-6">
          <Mark />
          <div className="flex items-baseline gap-2">
            <h1 className="text-[13px] font-semibold leading-none">CDU 模拟器</h1>
            <span className="font-mono text-[10px] leading-none text-muted-foreground">v0.2</span>
          </div>
          <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />
          <Status tone={stateTone}>{stateLabel}</Status>
          <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
            更新 {time}
          </span>

          <div className="ml-auto flex items-center gap-2">
            <div
              className="flex items-center rounded-md border border-border p-0.5"
              role="group"
              aria-label="数值显示方式"
            >
              {(
                [
                  ["eng", "工程值"],
                  ["raw", "原始信号"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setMode(value)}
                  aria-pressed={mode === value}
                  className={cn(
                    "h-6 rounded-[5px] px-2 text-[11px] transition-colors",
                    mode === value
                      ? "bg-muted text-foreground ring-1 ring-inset ring-border"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                window.location.hash = "#/config";
              }}
              title="配置页：管段、设备与点位"
              aria-label="打开配置页"
            >
              <Settings2 className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleTheme}
              title={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"}
              aria-label={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"}
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-[1680px] grid-cols-1 gap-4 px-6 py-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card/60 xl:h-[calc(100vh-104px)]">
          <div className="flex h-10 shrink-0 items-center justify-between gap-4 border-b border-border px-4">
            <div className="flex items-baseline gap-2">
              <h2 className="text-[12px] font-medium text-foreground">系统图</h2>
              <span className="font-mono text-[10px] text-muted-foreground">P&amp;ID</span>
            </div>
            <div className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
              <span>Modbus TCP :1502</span>
              <span className="h-3 w-px bg-border" aria-hidden="true" />
              <span>WS /ws</span>
            </div>
          </div>

          <ControlPanel
            points={points}
            topology={topology}
            boundary={snapshot?.boundary}
            facility={snapshot?.facility_c}
            returnTemp={snapshot?.return_c}
            ua={snapshot?.ua_kw_per_k}
          />

          <div className="flex min-h-0 flex-1 items-center justify-center p-2">
            <PidDiagram
              points={points}
              topology={topology}
              selected={selectedId}
              mode={mode}
              onSelect={setSelected}
              className="h-full w-full"
            />
          </div>
        </section>

        <aside className="flex min-h-0 flex-col gap-3 xl:h-[calc(100vh-104px)]">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/85 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-xl border border-border bg-card p-5">
            <div className="flex items-start gap-3">
              <WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-foreground">连接已断开</div>
                <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
                  模拟器可能已停止。页面每 1.5 秒自动重连，恢复后数据会继续刷新。
                </p>
                <div className="mt-3 flex items-center gap-3">
                  <Button size="sm" variant="outline" onClick={retry}>
                    立即重试
                  </Button>
                  <Status tone="warn">正在重连</Status>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
