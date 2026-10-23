import { useEffect, useState } from "react";
import { AlertCircle, Save, X } from "lucide-react";
import type { PointSample, SignalKind } from "@/lib/api";
import { SIGNAL_LABEL } from "@/lib/api";
import { Button } from "@/components/ui/button";

interface Props {
  point: PointSample;
  onClose: () => void;
}

function defaultSignal(kind: SignalKind, engLo: number, engHi: number): [string, string] {
  switch (kind) {
    case "current":
      return ["4000", "20000"];
    case "voltage":
      return ["0", "10000"];
    case "adc":
      return ["0", "4095"];
    case "rtd": {
      // PT100：0.1 °C / count
      const lo = Math.max(0, Math.round(engLo * 10));
      const hi = Math.max(lo + 1, Math.round(engHi * 10));
      return [String(lo), String(hi)];
    }
  }
}

const UNIT_PRESETS = ["bar", "PSI", "kPa", "MPa", "°C", "°F", "m3/h", "L/min", "L/s", "%"];

export default function TagEditor({ point, onClose }: Props) {
  const analog = point.kind === "AI" || point.kind === "AO";

  const [addr, setAddr] = useState(String(point.addr));
  const [unit, setUnit] = useState(point.unit);
  const [engMin, setEngMin] = useState(String(point.range[0]));
  const [engMax, setEngMax] = useState(String(point.range[1]));
  const [kind, setKind] = useState<SignalKind>(point.signal_kind);
  const [sigMin, setSigMin] = useState(String(point.signal_range[0]));
  const [sigMax, setSigMax] = useState(String(point.signal_range[1]));
  const [present, setPresent] = useState(point.present);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  function changeKind(next: SignalKind) {
    const prevDefault = defaultSignal(kind, Number(engMin), Number(engMax));
    if (sigMin === prevDefault[0] && sigMax === prevDefault[1]) {
      const nextDefault = defaultSignal(next, Number(engMin), Number(engMax));
      setSigMin(nextDefault[0]);
      setSigMax(nextDefault[1]);
    }
    setKind(next);
  }

  async function save() {
    const address = Number(addr);
    if (!Number.isInteger(address) || address < 0 || address > 65535) {
      setError("地址必须是 0–65535 的整数");
      return;
    }

    const body: Record<string, unknown> = { addr: address, present };

    if (analog) {
      const lo = Number(engMin);
      const hi = Number(engMax);
      if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) {
        setError("工程量程需要满足 max > min");
        return;
      }
      if (!unit.trim()) {
        setError("请填写工程单位");
        return;
      }
      const slo = Number(sigMin);
      const shi = Number(sigMax);
      if (!Number.isFinite(slo) || !Number.isFinite(shi) || shi <= slo) {
        setError("信号量程需要满足 max > min");
        return;
      }
      if (slo < 0 || shi > 65535) {
        setError("信号量程必须在 0–65535（u16 寄存器）");
        return;
      }
      body.unit = unit.trim();
      body.range = [lo, hi];
      body.signal = { kind, range: [slo, shi] };
    }

    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/tags/${encodeURIComponent(point.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? `HTTP ${res.status}`);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const engSpan = Number(engMax) - Number(engMin);
  const sigSpan = Number(sigMax) - Number(sigMin);
  const resolution = engSpan > 0 && sigSpan > 0 ? engSpan / sigSpan : Number.NaN;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-xl border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-border p-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm text-foreground">{point.id}</span>
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {point.kind}
              </span>
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">{point.desc}</div>
            {point.place && (
              <div className="mt-0.5 text-[10px] text-muted-foreground/80">
                系统图位置：{point.place.loop} / {point.place.branch} / order {point.place.order}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 p-4">
          <label className="block">
            <span className="mb-1 block text-[11px] text-muted-foreground">
              Modbus 地址（保持寄存器 / 线圈）
            </span>
            <input
              value={addr}
              onChange={(e) => setAddr(e.target.value)}
              inputMode="numeric"
              className="h-8 w-full rounded-md border border-border bg-background px-2 font-mono text-sm text-foreground outline-none focus:border-primary/60"
            />
          </label>

          {analog ? (
            <>
              <div className="grid grid-cols-[1fr_1.4fr] gap-2">
                <label className="block">
                  <span className="mb-1 block text-[11px] text-muted-foreground">工程单位</span>
                  <input
                    list="unit-presets"
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                    className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none focus:border-primary/60"
                  />
                  <datalist id="unit-presets">
                    {UNIT_PRESETS.map((u) => (
                      <option key={u} value={u} />
                    ))}
                  </datalist>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="mb-1 block text-[11px] text-muted-foreground">量程下限</span>
                    <input
                      value={engMin}
                      onChange={(e) => setEngMin(e.target.value)}
                      inputMode="decimal"
                      className="h-8 w-full rounded-md border border-border bg-background px-2 font-mono text-sm text-foreground outline-none focus:border-primary/60"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[11px] text-muted-foreground">量程上限</span>
                    <input
                      value={engMax}
                      onChange={(e) => setEngMax(e.target.value)}
                      inputMode="decimal"
                      className="h-8 w-full rounded-md border border-border bg-background px-2 font-mono text-sm text-foreground outline-none focus:border-primary/60"
                    />
                  </label>
                </div>
              </div>

              <label className="block">
                <span className="mb-1 block text-[11px] text-muted-foreground">信号类型</span>
                <select
                  value={kind}
                  onChange={(e) => changeKind(e.target.value as SignalKind)}
                  className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none focus:border-primary/60"
                >
                  {(Object.keys(SIGNAL_LABEL) as SignalKind[]).map((k) => (
                    <option key={k} value={k}>
                      {SIGNAL_LABEL[k]}
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="mb-1 block text-[11px] text-muted-foreground">信号下限</span>
                  <input
                    value={sigMin}
                    onChange={(e) => setSigMin(e.target.value)}
                    inputMode="decimal"
                    className="h-8 w-full rounded-md border border-border bg-background px-2 font-mono text-sm text-foreground outline-none focus:border-primary/60"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] text-muted-foreground">信号上限</span>
                  <input
                    value={sigMax}
                    onChange={(e) => setSigMax(e.target.value)}
                    inputMode="decimal"
                    className="h-8 w-full rounded-md border border-border bg-background px-2 font-mono text-sm text-foreground outline-none focus:border-primary/60"
                  />
                </label>
              </div>

              <div className="rounded-md border border-border bg-muted/40 px-2 py-1.5 text-[10px] leading-relaxed text-muted-foreground">
                <div>
                  换算：{Number(engMin) || 0}–{Number(engMax) || 0} {unit || "?"} ↔{" "}
                  {Number(sigMin) || 0}–{Number(sigMax) || 0}
                </div>
                <div>
                  分辨率：1 count ≈{" "}
                  {Number.isFinite(resolution) ? resolution.toPrecision(3) : "?"} {unit || ""}
                  {kind === "rtd" ? "（PT100 按 0.1 °C/count）" : ""}
                </div>
              </div>
            </>
          ) : (
            <div className="rounded-md border border-border bg-muted/40 px-2 py-2 text-[11px] text-muted-foreground">
              开关量走线圈区，没有工程量程和信号类型，只能改地址与在位状态。
            </div>
          )}

          <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <input
              type="checkbox"
              checked={present}
              onChange={(e) => setPresent(e.target.checked)}
              className="h-3.5 w-3.5 accent-primary"
            />
            在位（取消后该点输出 0，模拟未安装）
          </label>

          {error && (
            <div className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-600 dark:text-red-300">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border p-3">
          <span className="text-[10px] text-muted-foreground/80">保存到 config/overrides.yaml</span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              取消
            </Button>
            <Button size="sm" onClick={save} disabled={saving}>
              <Save className="h-3.5 w-3.5" />
              {saving ? "保存中…" : "保存"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
