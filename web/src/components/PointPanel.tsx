import { useMemo, useState } from "react";
import { Pencil, Search } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { PointSample } from "@/lib/api";
import { displayValue, unitFor } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Props {
  points: PointSample[];
  selected: string;
  mode: "eng" | "raw";
  onSelect: (id: string) => void;
  onEdit: (id: string) => void;
}

export default function PointPanel({ points, selected, mode, onSelect, onEdit }: Props) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return points;
    return points.filter(
      (p) => p.id.toLowerCase().includes(q) || p.desc.toLowerCase().includes(q),
    );
  }, [points, query]);

  return (
    <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex h-9 shrink-0 items-center justify-between gap-2 px-4">
        <div className="flex items-baseline gap-2">
          <h2 className="text-[12px] font-medium text-foreground">点位表</h2>
          <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
            {points.length}
          </span>
        </div>
        <div className="relative w-[168px]">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索点位"
            aria-label="搜索点位"
            className="h-7 rounded-[6px] pl-6 pr-2 text-[11px]"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto border-t border-border">
        <table className="w-full border-separate border-spacing-0 text-[11px]">
          <thead className="sticky top-0 z-[1] bg-card">
            <tr className="text-[10px] text-muted-foreground">
              <th className="border-b border-border px-3 py-1.5 text-left font-normal">点位</th>
              <th className="border-b border-border px-3 py-1.5 text-right font-normal">数值</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => {
              const active = selected === p.id;
              const secondary =
                mode === "eng"
                  ? p.present
                    ? String(p.raw)
                    : "—"
                  : p.present
                    ? p.v.toFixed(1)
                    : "—";
              return (
                <tr
                  key={p.id}
                  onClick={() => onSelect(p.id)}
                  className={cn(
                    "group cursor-pointer transition-colors",
                    active ? "bg-muted" : "hover:bg-muted/60",
                  )}
                  style={active ? { boxShadow: "inset 2px 0 0 hsl(var(--primary))" } : undefined}
                >
                  <td className="border-b border-border px-3 py-1.5">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "h-1.5 w-1.5 shrink-0 rounded-full",
                          p.kind === "AI" || p.kind === "AO"
                            ? "bg-foreground/35"
                            : "border border-foreground/35",
                          !p.present && "opacity-40",
                        )}
                        title={p.kind}
                      />
                      <span className="font-mono text-[11px] leading-4 text-foreground">
                        {p.id}
                      </span>
                      <span className="truncate text-[10px] leading-4 text-muted-foreground">
                        {p.desc}
                      </span>
                    </div>
                  </td>
                  <td className="border-b border-border px-3 py-1 text-right">
                    <div className="font-mono text-[11px] leading-4 tabular-nums text-foreground">
                      {displayValue(p, mode)}
                      <span className="ml-1 text-[10px] text-muted-foreground">
                        {unitFor(p, mode)}
                      </span>
                    </div>
                    <div
                      className="font-mono text-[10px] leading-4 tabular-nums text-muted-foreground"
                      title={mode === "eng" ? "原始信号" : "工程值"}
                    >
                      {secondary}
                    </div>
                  </td>
                  <td className="w-6 border-b border-border pr-2 text-right">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onEdit(p.id);
                      }}
                      className="rounded-[4px] p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                      title="编辑点位"
                      aria-label={`编辑 ${p.id}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
