export type PointKind = "AI" | "AO" | "DI" | "DO";
export type SignalKind = "current" | "voltage" | "adc" | "rtd";

export interface Place {
  /** 旧字段：没有 topology 时使用；有 segment 时由后端按管段补全 */
  loop?: "primary" | "secondary";
  branch?: "pre_hx" | "post_hx";
  /** topology.segments 中的管段 id */
  segment?: string;
  order: number;
}

export interface PointSample {
  id: string;
  desc: string;
  kind: PointKind;
  unit: string;
  v: number;
  raw: number;
  present: boolean;
  range: [number, number];
  addr: number;
  signal_kind: SignalKind;
  signal_range: [number, number];
  place: Place | null;
}

export interface Boundary {
  facility_c: number | null;
  return_c: number | null;
  ua_kw_per_k: number | null;
}

export interface Snapshot {
  ts: number;
  points: PointSample[];
  boundary: Boundary;
  facility_c: number;
  return_c: number;
  ua_kw_per_k: number;
}

export type ConnStatus = "connecting" | "open" | "closed";

export const RAW_UNIT: Record<SignalKind, string> = {
  current: "µA",
  voltage: "mV",
  adc: "count",
  rtd: "0.1",
};

export const SIGNAL_LABEL: Record<SignalKind, string> = {
  current: "4–20 mA",
  voltage: "0–10 V",
  adc: "ADC 码值",
  rtd: "PT100 / 数字温度",
};

export function isDigital(kind: PointKind) {
  return kind === "DI" || kind === "DO";
}

export function displayValue(p: PointSample | undefined, mode: "eng" | "raw") {
  if (!p || !p.present) return "—";
  if (isDigital(p.kind)) return p.v > 0 ? "ON" : "OFF";
  if (mode === "raw") return String(p.raw);
  return p.v.toFixed(p.unit === "pH" ? 2 : 1);
}

export function unitFor(p: PointSample | undefined, mode: "eng" | "raw") {
  if (!p || !p.present) return "";
  if (isDigital(p.kind)) return "";
  return mode === "raw" ? RAW_UNIT[p.signal_kind] : p.unit;
}

export async function putPoint(id: string, body: { value?: number; on?: boolean }) {
  const res = await fetch(`/api/points/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? `HTTP ${res.status}`);
  }
}

export async function putBoundary(body: {
  facility_c?: number;
  return_c?: number;
  ua_kw_per_k?: number;
}) {
  const res = await fetch("/api/plant", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? `HTTP ${res.status}`);
  }
}

export async function clearBoundary() {
  const res = await fetch("/api/plant", { method: "DELETE" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}
