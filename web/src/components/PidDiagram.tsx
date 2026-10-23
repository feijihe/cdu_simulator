import { useEffect, useRef, type RefObject } from "react";
import type { PointSample } from "@/lib/api";
import { displayValue, unitFor } from "@/lib/api";

interface Props {
  points: Map<string, PointSample>;
  selected: string;
  mode: "eng" | "raw";
  onSelect: (id: string) => void;
}

const W = 1040;
const H = 640;

interface Lane {
  loop: "primary" | "secondary";
  branch: "pre_hx" | "post_hx";
  y: number;
  x1: number;
  x2: number;
  flow: 1 | -1;
  side: "above" | "below";
  baseY: number;
}

/**
 * 四条管段的布局参数。传感器不写死坐标：按 place.loop / place.branch 归到一条管段，
 * 再按 place.order 沿流向等距排布，新增/删除点位不需要改前端。
 */
const LANES: Lane[] = [
  { loop: "primary", branch: "pre_hx", y: 480, x1: 60, x2: 430, flow: 1, side: "below", baseY: 545 },
  { loop: "primary", branch: "post_hx", y: 200, x1: 60, x2: 430, flow: -1, side: "above", baseY: 148 },
  { loop: "secondary", branch: "pre_hx", y: 200, x1: 650, x2: 990, flow: -1, side: "above", baseY: 148 },
  { loop: "secondary", branch: "post_hx", y: 480, x1: 830, x2: 1000, flow: 1, side: "below", baseY: 545 },
];

function get(points: Map<string, PointSample>, id: string) {
  return points.get(id);
}

function flowOf(points: Map<string, PointSample>, id: string) {
  const p = points.get(id);
  return p && p.present ? Math.max(0, p.v) : 0;
}

interface FlowHandle {
  el: SVGPathElement | null;
  speed: number;
  target: number;
  offset: number;
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

function Pump({
  x,
  y,
  running,
  fault,
  label,
}: {
  x: number;
  y: number;
  running: boolean;
  fault: boolean;
  label: string;
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
      <text x={x} y={y + 30} textAnchor="middle" fontSize={9} fill="var(--pid-muted)">
        {label}
      </text>
      {fault && (
        <text x={x} y={y - 21} textAnchor="middle" fontSize={8} fill="var(--danger)">
          FAULT
        </text>
      )}
    </g>
  );
}

export default function PidDiagram({ points, selected, mode, onSelect }: Props) {
  const q1 = flowOf(points, "Q1");
  const q2 = flowOf(points, "Q2");
  const valve = get(points, "VALVE_POS")?.v ?? 0;
  const pump1 = get(points, "PUMP1_RUN");
  const pump2 = get(points, "PUMP2_RUN");
  const fault1 = get(points, "PUMP1_FAULT")?.v === 1;
  const fault2 = get(points, "PUMP2_FAULT")?.v === 1;

  const valveOpacity = 0.15 + 0.85 * Math.min(1, Math.max(0, valve / 100));
  const handles = useFlowDriver();

  const all = Array.from(points.values());

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
        一次侧 · 设施水
      </text>
      <text x={1010} y={40} fontSize={13} fontWeight={600} fill="var(--pipe-secondary)" textAnchor="end">
        二次侧 · 机柜回路
      </text>

      {/* 管路 */}
      <Pipe id="p-in" d="M 20 480 H 480 V 400" color="var(--pipe-primary)" flow={q1} handles={handles} />
      <Pipe id="p-out" d="M 480 250 V 200 H 20" color="var(--pipe-primary)" flow={q1} handles={handles} />
      <Pipe id="s-in" d="M 1020 200 H 530 V 250" color="var(--pipe-secondary)" flow={q2} handles={handles} />
      <Pipe id="s-mid" d="M 530 400 V 480 H 665" color="var(--pipe-secondary)" flow={q2} handles={handles} />
      <Pipe id="s-out" d="M 790 480 H 1020" color="var(--pipe-secondary)" flow={q2} handles={handles} />

      {/* 泵并联支路 */}
      <Pipe id="s-p1" d="M 665 480 V 455 H 790 V 480" color="var(--pipe-secondary)" flow={q2 / 2} handles={handles} />
      <Pipe id="s-p2" d="M 665 480 V 505 H 790 V 480" color="var(--pipe-secondary)" flow={q2 / 2} handles={handles} />

      {/* 板换 */}
      <rect x={450} y={250} width={110} height={150} rx={8} fill="url(#hx-grad)" stroke="var(--pid-border)" strokeWidth={1.5} />
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
      <text x={505} y={424} textAnchor="middle" fontSize={11} fill="var(--pid-muted)">
        板换
      </text>

      {/* 比例阀 */}
      <g>
        <line x1={330} y1={188} x2={330} y2={172} stroke="var(--pid-muted)" strokeWidth={2} />
        <rect x={320} y={162} width={20} height={10} rx={2} fill="var(--pid-actuator)" stroke="var(--pid-muted)" strokeWidth={1.2} />
        <polygon
          points="312,186 312,214 330,200"
          fill="var(--pid-accent)"
          opacity={valveOpacity}
          stroke="var(--pid-accent)"
          strokeWidth={1.4}
        />
        <polygon
          points="348,186 348,214 330,200"
          fill="var(--pid-accent)"
          opacity={valveOpacity}
          stroke="var(--pid-accent)"
          strokeWidth={1.4}
        />
        <text x={330} y={236} textAnchor="middle" fontSize={10} fill="var(--pid-muted)">
          比例阀 {valve.toFixed(0)}%
        </text>
      </g>

      {/* 泵 */}
      <Pump x={705} y={455} running={pump1?.v === 1} fault={fault1} label="泵 1" />
      <Pump x={705} y={505} running={pump2?.v === 1} fault={fault2} label="泵 2" />

      {/* 传感器：按 place 自动分布 */}
      {LANES.map((lane) => {
        const items = all
          .filter(
            (p) =>
              p.place &&
              p.place.loop === lane.loop &&
              p.place.branch === lane.branch,
          )
          .sort((a, b) => (a.place!.order - b.place!.order) || a.id.localeCompare(b.id));

        if (items.length === 0) return null;
        const step = (lane.x2 - lane.x1) / (items.length + 1);
        const spacing = Math.abs(step);
        // 密集时交错排布：间距 >=72 单排，>=35 两排，否则三排（卡片宽 70）
        const rows = spacing >= 72 ? 1 : spacing >= 35 ? 2 : 3;

        const placed = items.map((p, i) => {
          const x = lane.flow > 0 ? lane.x1 + step * (i + 1) : lane.x2 - step * (i + 1);
          const row = rows > 1 ? i % rows : 0;
          const y = lane.baseY + (lane.side === "above" ? -34 : 34) * row;
          return { p, x, y, row };
        });

        // 先画远排、再画近排，让近排的卡片盖住远排的引线
        placed.sort((a, b) => b.row - a.row || a.x - b.x);

        return placed.map(({ p, x, y }) => (
          <Sensor
            key={p.id}
            p={p}
            x={x}
            y={y}
            pipeY={lane.y}
            selected={selected}
            mode={mode}
            onClick={onSelect}
          />
        ));
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
          传感器位置由点表 place 自动生成
        </text>
      </g>
    </svg>
  );
}
