import { useEffect, useRef, type RefObject } from "react";
import type {
  PointSample,
  PumpEquipment,
  Segment,
  Topology,
  ValveEquipment,
} from "@/lib/api";
import { displayValue, unitFor } from "@/lib/api";
import { flowValue, heatExchangerOf, onSegment } from "@/lib/topology";

interface Props {
  points: Map<string, PointSample>;
  topology: Topology;
  selected: string;
  mode: "eng" | "raw";
  onSelect: (id: string) => void;
}

const W = 1040;
const H = 640;
const HX = { x: 450, y: 250, w: 110, h: 150 };

interface LaneGeom {
  y: number;
  x1: number;
  x2: number;
  outer: number;
  inner: number;
  side: "above" | "below";
  baseY: number;
}

/**
 * 四条管段的几何：板换在中间，一次侧在左、二次侧在右。
 * 坐标只和「回路 + 板换前后」有关，不依赖具体点位/设备数量。
 */
const GEOM: Record<string, LaneGeom> = {
  "primary:pre_hx": { y: 480, x1: 60, x2: 430, outer: 20, inner: 480, side: "below", baseY: 545 },
  "primary:post_hx": { y: 200, x1: 60, x2: 430, outer: 20, inner: 480, side: "above", baseY: 148 },
  "secondary:pre_hx": { y: 200, x1: 590, x2: 990, outer: 1020, inner: 530, side: "above", baseY: 148 },
  "secondary:post_hx": { y: 480, x1: 590, x2: 990, outer: 1020, inner: 530, side: "below", baseY: 545 },
};

type LaneItem =
  | { kind: "sensor"; point: PointSample; order: number; span: number; key: string }
  | { kind: "valve"; valve: ValveEquipment; order: number; span: number; key: string }
  | { kind: "pumps"; pumps: PumpEquipment[]; order: number; span: number; key: string };

interface FlowHandle {
  el: SVGPathElement | null;
  speed: number;
  target: number;
  offset: number;
}

function pipeColor(loop: "primary" | "secondary") {
  return loop === "primary" ? "var(--pipe-primary)" : "var(--pipe-secondary)";
}

function hxEdge(segment: Segment) {
  if (segment.loop === "primary") return segment.branch === "pre_hx" ? 400 : 250;
  return segment.branch === "pre_hx" ? 250 : 400;
}

/**
 * 流动动画由 rAF 直接改 stroke-dashoffset，与 WebSocket 的 5 Hz 刷新解耦。
 * 之前的做法是每次快照都改 CSS animation-duration，流速一抖动画就被重置，看起来卡。
 */
function useFlowDriver() {
  const handles = useRef<Map<string, FlowHandle>>(new Map());

  useEffect(() => {
    let raf = 0;
    let last = performance.now();

    const step = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;

      handles.current.forEach((h) => {
        if (!h.el) return;
        // 速度平滑过渡，避免流量变化时动画突然变速
        h.speed += (h.target - h.speed) * Math.min(1, dt * 8);

        if (h.target <= 0.01 && h.speed < 0.05) {
          h.speed = 0;
          h.offset = 0;
          h.el.style.strokeDashoffset = "0";
          return;
        }

        h.offset = (h.offset + h.speed * dt) % 22;
        h.el.style.strokeDashoffset = `${-h.offset}`;
      });

      raf = requestAnimationFrame(step);
    };

    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);

  return handles;
}

function Pipe({
  id,
  d,
  color,
  flow,
  handles,
}: {
  id: string;
  d: string;
  color: string;
  flow: number;
  handles: RefObject<Map<string, FlowHandle>>;
}) {
  const moving = flow > 0.05;
  const speed = moving ? 12 + Math.min(48, Math.sqrt(Math.max(flow, 0)) * 9) : 0;

  return (
    <g>
      <path d={d} fill="none" stroke="var(--pid-track)" strokeWidth={11} strokeLinecap="round" opacity={0.9} />
      <path d={d} fill="none" stroke={color} strokeWidth={5} strokeLinecap="round" opacity={0.7} />
      <path
        ref={(el) => {
          const map = handles.current;
          if (!map) return;
          // ref 回调每次渲染都会 detach/attach，这里保留 offset，避免动画被重置
          const handle = map.get(id) ?? { el: null, speed: 0, target: 0, offset: 0 };
          handle.el = el;
          handle.target = speed;
          map.set(id, handle);
        }}
        d={d}
        fill="none"
        stroke="var(--flow-dash)"
        strokeWidth={2}
        strokeLinecap="round"
        strokeDasharray="5 17"
        opacity={moving ? 0.85 : 0}
      />
    </g>
  );
}

function Sensor({
  p,
  x,
  y,
  pipeY,
  selected,
  mode,
  onClick,
}: {
  p: PointSample;
  x: number;
  y: number;
  pipeY: number;
  selected: string;
  mode: "eng" | "raw";
  onClick: (id: string) => void;
}) {
  const active = p.id === selected;
  const present = p.present;
  const below = pipeY > y;
  const start = below ? 8 : -24;
  const end = pipeY - y;

  return (
    <g
      transform={`translate(${x},${y})`}
      opacity={present ? 1 : 0.4}
      style={{ cursor: "pointer" }}
      onClick={() => onClick(p.id)}
    >
      <line x1={0} y1={start} x2={0} y2={end} stroke="var(--pid-border)" strokeWidth={1.4} />
      <rect
        x={-35}
        y={-24}
        width={70}
        height={32}
        rx={7}
        fill={active ? "var(--pid-chip-active)" : "var(--pid-chip)"}
        stroke={active ? "var(--pid-accent)" : "var(--pid-border)"}
        strokeWidth={active ? 1.8 : 1}
      />
      <text x={-29} y={-11} fontSize={9} fill="var(--pid-muted)" fontFamily="ui-monospace, monospace">
        {p.id}
      </text>
      <text
        x={-29}
        y={3}
        fontSize={12}
        fontWeight={600}
        fill={active ? "var(--pid-active-text)" : "var(--pid-text)"}
        fontFamily="ui-monospace, monospace"
      >
        {present ? displayValue(p, mode) : "—"}
      </text>
      <text x={29} y={3} fontSize={8} fill="var(--pid-dim)" textAnchor="end">
        {present ? unitFor(p, mode) : ""}
      </text>
    </g>
  );
}

function ValveSymbol({
  x,
  y,
  open,
  label,
}: {
  x: number;
  y: number;
  open: number;
  label: string;
}) {
  const opacity = 0.15 + 0.85 * Math.min(1, Math.max(0, open / 100));
  return (
    <g>
      <line x1={x} y1={y - 12} x2={x} y2={y - 28} stroke="var(--pid-muted)" strokeWidth={2} />
      <rect
        x={x - 10}
        y={y - 38}
        width={20}
        height={10}
        rx={2}
        fill="var(--pid-actuator)"
        stroke="var(--pid-muted)"
        strokeWidth={1.2}
      />
      <polygon
        points={`${x - 18},${y - 14} ${x - 18},${y + 14} ${x},${y}`}
        fill="var(--pid-accent)"
        opacity={opacity}
        stroke="var(--pid-accent)"
        strokeWidth={1.4}
      />
      <polygon
        points={`${x + 18},${y - 14} ${x + 18},${y + 14} ${x},${y}`}
        fill="var(--pid-accent)"
        opacity={opacity}
        stroke="var(--pid-accent)"
        strokeWidth={1.4}
      />
      <text x={x} y={y + 30} textAnchor="middle" fontSize={10} fill="var(--pid-muted)">
        {label} {open.toFixed(0)}%
      </text>
    </g>
  );
}

function Pump({
  x,
  y,
  running,
  fault,
  label,
  labelAbove,
}: {
  x: number;
  y: number;
  running: boolean;
  fault: boolean;
  label: string;
  labelAbove?: boolean;
}) {
  const color = fault ? "var(--danger)" : running ? "var(--ok)" : "var(--pid-dim)";
  return (
    <g>
      <circle cx={x} cy={y} r={15} fill="var(--pid-chip)" stroke={color} strokeWidth={2.5} />
      <g
        style={{
          transformBox: "fill-box",
          transformOrigin: "center",
          animation: running ? "rot 1.8s linear infinite" : undefined,
        }}
      >
        <line x1={x - 9} y1={y} x2={x + 9} y2={y} stroke={running ? "var(--ok-soft)" : "var(--pid-dim)"} strokeWidth={2} />
        <line x1={x} y1={y - 9} x2={x} y2={y + 9} stroke={running ? "var(--ok-soft)" : "var(--pid-dim)"} strokeWidth={2} />
      </g>
      <text
        x={x}
        y={y + (labelAbove ? -22 : 30)}
        textAnchor="middle"
        fontSize={9}
        fill="var(--pid-muted)"
      >
        {label}
      </text>
      {fault && (
        <text
          x={x}
          y={y + (labelAbove ? 30 : -21)}
          textAnchor="middle"
          fontSize={8}
          fill="var(--danger)"
        >
          FAULT
        </text>
      )}
    </g>
  );
}

function buildItems(
  segment: Segment,
  points: Map<string, PointSample>,
  topology: Topology,
): LaneItem[] {
  const items: LaneItem[] = [];

  for (const point of points.values()) {
    if (onSegment(point, segment)) {
      items.push({
        kind: "sensor",
        point,
        order: point.place?.order ?? 0,
        span: 1,
        key: point.id,
      });
    }
  }

  for (const equipment of topology.equipment) {
    if (equipment.type === "valve" && equipment.segment === segment.id) {
      items.push({
        kind: "valve",
        valve: equipment,
        order: equipment.order,
        span: 1,
        key: equipment.id,
      });
    }
  }

  const pumpsByOrder = new Map<number, PumpEquipment[]>();
  for (const equipment of topology.equipment) {
    if (equipment.type !== "pump" || equipment.segment !== segment.id) continue;
    const group = pumpsByOrder.get(equipment.order) ?? [];
    group.push(equipment);
    pumpsByOrder.set(equipment.order, group);
  }
  for (const [order, pumps] of pumpsByOrder) {
    items.push({
      kind: "pumps",
      pumps,
      order,
      span: 2,
      key: pumps.map((p) => p.id).join("+"),
    });
  }

  return items.sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));
}

/** order 沿流向递增；设备按 span 占位（泵簇占 2 格），避免和传感器重叠。 */
function placeItems(items: LaneItem[], segment: Segment, geom: LaneGeom) {
  const total = items.reduce((sum, item) => sum + item.span, 0) || 1;
  const step = (geom.x2 - geom.x1) / (total + 1);
  let cursor = 0;

  return items.map((item) => {
    const center = cursor + item.span / 2;
    cursor += item.span;
    const x =
      segment.direction === "reverse"
        ? geom.x2 - center * step
        : geom.x1 + center * step;
    return { item, x, step };
  });
}

/** 把管段水平线在泵簇处断开，并接上板换立管。 */
function segmentPaths(segment: Segment, geom: LaneGeom, pumpXs: number[]) {
  const innerAtRight = geom.inner > geom.outer;
  const endsAtInner =
    innerAtRight ? segment.direction === "forward" : segment.direction === "reverse";
  const left = Math.min(geom.outer, geom.inner);
  const right = Math.max(geom.outer, geom.inner);

  const spans: [number, number][] = [];
  let cursor = left;
  for (const cx of [...pumpXs].sort((a, b) => a - b)) {
    const a = Math.max(left, cx - 55);
    const b = Math.min(right, cx + 55);
    if (a > cursor + 1) spans.push([cursor, a]);
    cursor = Math.max(cursor, b);
  }
  if (cursor < right - 1) spans.push([cursor, right]);

  const ordered = segment.direction === "forward" ? spans : [...spans].reverse();
  const pieces = ordered.map(([a, b]) =>
    segment.direction === "forward"
      ? `M ${a} ${geom.y} H ${b}`
      : `M ${b} ${geom.y} H ${a}`,
  );
  if (pieces.length === 0) return [];

  const edge = hxEdge(segment);
  if (endsAtInner) {
    const last = pieces.length - 1;
    pieces[last] = `${pieces[last]} V ${edge}`;
  } else {
    const [a, b] = ordered[0];
    const end = segment.direction === "forward" ? b : a;
    pieces[0] = `M ${geom.inner} ${edge} V ${geom.y} H ${end}`;
  }

  return pieces;
}

function pumpOffsets(count: number) {
  if (count <= 1) return [0];
  const gap = count > 3 ? 38 : 50;
  return Array.from({ length: count }, (_, i) => (i - (count - 1) / 2) * gap);
}

function pumpBranchPaths(
  x: number,
  y: number,
  offsets: number[],
  direction: "forward" | "reverse",
) {
  const paths: string[] = [];
  const dir = direction === "forward" ? 1 : -1;
  for (const offset of offsets) {
    if (Math.abs(offset) < 1) {
      paths.push(`M ${x - 55 * dir} ${y} H ${x + 55 * dir}`);
    } else {
      paths.push(`M ${x - 55 * dir} ${y} V ${y + offset} H ${x + 55 * dir} V ${y}`);
    }
  }
  return paths;
}

export default function PidDiagram({ points, topology, selected, mode, onSelect }: Props) {
  const handles = useFlowDriver();

  if (topology.segments.length === 0) {
    return (
      <div className="flex h-72 items-center justify-center text-xs text-muted-foreground">
        点表里没有可绘制的位置：请给传感器加 place，或在 topology 中定义 segments
      </div>
    );
  }

  const lanes = topology.segments.flatMap((segment) => {
    const geom = GEOM[`${segment.loop}:${segment.branch}`];
    if (!geom) return [];
    const items = placeItems(buildItems(segment, points, topology), segment, geom);
    // 单泵直接串在主管上；多泵才需要把主管断开画并联支路
    const pumpXs = items
      .filter((i) => i.item.kind === "pumps" && i.item.pumps.length > 1)
      .map((i) => i.x);
    const paths = segmentPaths(segment, geom, pumpXs);
    const flow = flowValue(topology, points, segment);
    return [{ segment, geom, items, paths, flow }];
  });

  const hx = heatExchangerOf(topology);
  const hxLabel = hx?.label ?? "板换";
  const hxLabelWidth = hxLabel.length * 11 + 12;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="CDU 系统图">
      <defs>
        <linearGradient id="hx-grad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--hx-a)" />
          <stop offset="55%" stopColor="var(--hx-mid)" />
          <stop offset="100%" stopColor="var(--hx-b)" />
        </linearGradient>
      </defs>

      <text x={30} y={40} fontSize={13} fontWeight={600} fill="var(--pipe-primary)">
        一次侧
      </text>
      <text x={1010} y={40} fontSize={13} fontWeight={600} fill="var(--pipe-secondary)" textAnchor="end">
        二次侧
      </text>

      {/* 主管段 */}
      {lanes.map(({ segment, paths, flow }) =>
        paths.map((d, i) => (
          <Pipe
            key={`${segment.id}-${i}`}
            id={`${segment.id}-${i}`}
            d={d}
            color={pipeColor(segment.loop)}
            flow={flow}
            handles={handles}
          />
        )),
      )}

      {/* 泵并联支路 */}
      {lanes.map(({ segment, items, flow }) =>
        items.map(({ item, x }) => {
          if (item.kind !== "pumps") return null;
          // 单泵直接串在主管上，不画并联支路
          if (item.pumps.length <= 1) return null;
          const offsets = pumpOffsets(item.pumps.length);
          const running = item.pumps.filter((p) => points.get(p.run)?.v === 1).length;
          return pumpBranchPaths(
            x,
            GEOM[`${segment.loop}:${segment.branch}`].y,
            offsets,
            segment.direction,
          ).map((d, i) => (
            <Pipe
              key={`${segment.id}-pump-${item.key}-${i}`}
              id={`${segment.id}-pump-${item.key}-${i}`}
              d={d}
              color={pipeColor(segment.loop)}
              flow={points.get(item.pumps[i].run)?.v === 1 ? flow / Math.max(1, running) : 0}
              handles={handles}
            />
          ));
        }),
      )}

      {/* 板换 */}
      <rect
        x={HX.x}
        y={HX.y}
        width={HX.w}
        height={HX.h}
        rx={8}
        fill="url(#hx-grad)"
        stroke="var(--pid-border)"
        strokeWidth={1.5}
      />
      <polyline
        points="466,388 493,368 466,348 493,328 466,308 493,288 466,268"
        fill="none"
        stroke="var(--pipe-primary)"
        strokeWidth={1.8}
        opacity={0.55}
      />
      <polyline
        points="544,388 517,368 544,348 517,328 544,308 517,288 544,268"
        fill="none"
        stroke="var(--pipe-secondary)"
        strokeWidth={1.8}
        opacity={0.55}
      />
      <line x1={505} y1={258} x2={505} y2={392} stroke="var(--pid-border)" strokeDasharray="3 4" />
      <rect
        x={505 - hxLabelWidth / 2}
        y={412}
        width={hxLabelWidth}
        height={18}
        rx={4}
        fill="var(--pid-chip)"
      />
      <text x={505} y={425} textAnchor="middle" fontSize={11} fill="var(--pid-muted)">
        {hxLabel}
      </text>

      {/* 设备与传感器 */}
      {lanes.map(({ segment, geom, items }) => {
        const sensorPositions = items.filter((i) => i.item.kind === "sensor");
        const gaps = sensorPositions
          .slice(1)
          .map((p, i) => Math.abs(p.x - sensorPositions[i].x));
        const minGap = gaps.length > 0 ? Math.min(...gaps) : Number.POSITIVE_INFINITY;
        const rows = minGap >= 72 ? 1 : minGap >= 38 ? 2 : 3;
        let sensorIndex = 0;

        return items.map(({ item, x }) => {
          if (item.kind === "sensor") {
            const row = sensorIndex++ % rows;
            const y = geom.baseY + (geom.side === "below" ? 1 : -1) * 34 * row;
            return (
              <Sensor
                key={item.key}
                p={item.point}
                x={x}
                y={y}
                pipeY={geom.y}
                selected={selected}
                mode={mode}
                onClick={onSelect}
              />
            );
          }

          if (item.kind === "valve") {
            const position = points.get(item.valve.pos);
            return (
              <ValveSymbol
                key={item.key}
                x={x}
                y={geom.y}
                open={position?.present ? position.v : 0}
                label={item.valve.label}
              />
            );
          }

          const offsets = pumpOffsets(item.pumps.length);
          return item.pumps.map((pump, index) => {
            const running = points.get(pump.run)?.v === 1;
            const fault = pump.fault ? points.get(pump.fault)?.v === 1 : false;
            return (
              <Pump
                key={pump.id}
                x={x}
                y={geom.y + offsets[index]}
                running={running}
                fault={fault}
                label={pump.label}
                labelAbove={offsets[index] < 0}
              />
            );
          });
        });
      })}

      {/* 图例 */}
      <g transform="translate(30, 620)">
        <circle cx={0} cy={0} r={4} fill="var(--pipe-primary)" />
        <text x={10} y={4} fontSize={10} fill="var(--pid-dim)">
          一次侧
        </text>
        <circle cx={70} cy={0} r={4} fill="var(--pipe-secondary)" />
        <text x={80} y={4} fontSize={10} fill="var(--pid-dim)">
          二次侧
        </text>
        <text x={140} y={4} fontSize={10} fill="var(--pid-dim)">
          管段、设备与传感器位置由 topology 自动生成
        </text>
      </g>
    </svg>
  );
}
