import type {
  Branch,
  Direction,
  Equipment,
  LoopSide,
  PointSample,
  PumpEquipment,
  Segment,
  Topology,
  ValveEquipment,
} from "./api";

const TEMP_UNITS = new Set(["°c", "c", "°f", "f", "k"]);
const PRESSURE_UNITS = new Set(["bar", "kpa", "mpa", "psi"]);
const FLOW_UNITS = new Set(["m3/h", "m³/h", "l/min", "lpm", "l/s", "gpm"]);

export function isTempUnit(unit: string) {
  return TEMP_UNITS.has(unit.trim().toLowerCase());
}

export function isPressureUnit(unit: string) {
  return PRESSURE_UNITS.has(unit.trim().toLowerCase());
}

export function isFlowUnit(unit: string) {
  return FLOW_UNITS.has(unit.trim().toLowerCase());
}

/** 点是否落在该管段上；旧点表没有 segment 时回落到 loop/branch。 */
export function onSegment(point: PointSample, segment: Segment) {
  const place = point.place;
  if (!place) return false;
  if (place.segment) return place.segment === segment.id;
  return place.loop === segment.loop && place.branch === segment.branch;
}

export function pointsOnSegment(points: Map<string, PointSample>, segment: Segment) {
  return [...points.values()].filter((p) => onSegment(p, segment));
}

export function segmentOf(topology: Topology, loop: LoopSide, branch: Branch) {
  return topology.segments.find((s) => s.loop === loop && s.branch === branch);
}

export function valveOf(topology: Topology) {
  return topology.equipment.find((e): e is ValveEquipment => e.type === "valve");
}

export function heatExchangerOf(topology: Topology) {
  return topology.equipment.find((e) => e.type === "heat_exchanger");
}

export function pumpsOf(topology: Topology) {
  return topology.equipment.filter((e): e is PumpEquipment => e.type === "pump");
}

/** 同一回路的管段：板换前 / 后各一条。 */
export function segmentsOf(topology: Topology, loop: LoopSide) {
  return topology.segments.filter((s) => s.loop === loop);
}

/** 按 order 选最靠近板换的测点：板换前取 order 最大，板换后取最小。 */
function nearestToHx(segment: Segment, list: PointSample[]) {
  if (list.length === 0) return undefined;
  const sorted = [...list].sort(
    (a, b) => (a.place?.order ?? 0) - (b.place?.order ?? 0),
  );
  return segment.branch === "pre_hx" ? sorted[sorted.length - 1] : sorted[0];
}

function pick(
  points: Map<string, PointSample>,
  segment: Segment,
  match: (unit: string) => boolean,
) {
  const candidates = pointsOnSegment(points, segment).filter((p) => match(p.unit));
  return nearestToHx(segment, candidates.filter((p) => p.present)) ?? nearestToHx(segment, candidates);
}

export function tempOn(points: Map<string, PointSample>, segment?: Segment) {
  return segment ? pick(points, segment, isTempUnit) : undefined;
}

export function pressureOn(points: Map<string, PointSample>, segment?: Segment) {
  return segment ? pick(points, segment, isPressureUnit) : undefined;
}

/**
 * 管段流量：优先 segment.flow，其次同回路带 flow 的管段；
 * 旧点表没有 flow 字段时按单位自动找。
 */
export function flowPoint(
  topology: Topology,
  points: Map<string, PointSample>,
  segment: Segment,
) {
  if (segment.flow) {
    const direct = points.get(segment.flow);
    if (direct) return direct;
  }
  const sibling = topology.segments.find((s) => s.loop === segment.loop && s.flow);
  if (sibling?.flow) {
    const point = points.get(sibling.flow);
    if (point) return point;
  }
  for (const candidate of segmentsOf(topology, segment.loop)) {
    const point = pick(points, candidate, isFlowUnit);
    if (point) return point;
  }
  return undefined;
}

export function flowValue(
  topology: Topology,
  points: Map<string, PointSample>,
  segment: Segment,
) {
  const point = flowPoint(topology, points, segment);
  return point && point.present ? Math.max(0, point.v) : 0;
}

/** 默认选中的点：二次侧供液温度 > 任意有系统图位置的点 > 第一个点。 */
export function defaultSelection(topology: Topology, points: Map<string, PointSample>) {
  const supply = segmentOf(topology, "secondary", "post_hx");
  const preferred = supply ? tempOn(points, supply) : undefined;
  if (preferred?.present) return preferred.id;
  const placed = [...points.values()].find((p) => p.present && p.place);
  if (placed) return placed.id;
  return [...points.values()].find((p) => p.present)?.id ?? "";
}

function defaultDirection(loop: LoopSide, branch: Branch): Direction {
  return (loop === "primary" && branch === "pre_hx") ||
    (loop === "secondary" && branch === "post_hx")
    ? "forward"
    : "reverse";
}

/**
 * 点表没配 topology 时的兜底：从 place.loop / place.branch 还原四条管段，
 * 只画板换和传感器，不提供阀门/泵控制。
 */
export function synthesizeTopology(points: Map<string, PointSample>): Topology {
  const segments: Segment[] = [];
  const seen = new Set<string>();

  for (const point of points.values()) {
    const place = point.place;
    if (!place?.loop || !place.branch) continue;
    // 优先用 point 上带的 segment id：即使 /api/topology 暂时取不到，
    // 后端已经解析好的 place.segment 也能让传感器挂回正确的管段。
    const id = place.segment ?? `${place.loop}_${place.branch}`;
    const slot = `${place.loop}:${place.branch}`;
    if (seen.has(slot)) continue;
    seen.add(slot);
    segments.push({
      id,
      label: `${place.loop === "primary" ? "一次侧" : "二次侧"} · ${
        place.branch === "pre_hx" ? "板换前" : "板换后"
      }`,
      loop: place.loop,
      branch: place.branch,
      direction: defaultDirection(place.loop, place.branch),
    });
  }

  for (const segment of segments) {
    const flow = [...points.values()].find(
      (p) => onSegment(p, segment) && isFlowUnit(p.unit),
    );
    if (flow) segment.flow = flow.id;
  }

  const equipment: Equipment[] =
    segments.length > 0 ? [{ type: "heat_exchanger", id: "HX", label: "板换" }] : [];

  return { segments, equipment };
}
