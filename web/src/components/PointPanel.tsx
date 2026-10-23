import { useMemo, useState } from "react";
import { Pencil, Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
    <Card className="flex min-h-0 flex-1 flex-col">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle>点位表</CardTitle>
          <span className="text-[11px] text-muted-foreground">{points.length} 点</span>
        </div>
        <div className="relative mt-1">
          <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索点位或描述"
            className="h-7 w-full rounded-md border border-border bg-background pl-7 pr-2 text-xs text-foreground outline-none placeholder:text-muted-foreground/80 focus:border-primary/60"
          />
        </div>
      </CardHeader>
      <CardContent className="min-h-0 flex-1 overflow-auto p-0">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-[1] bg-card text-[10px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-1.5 text-left font-medium">点位</th>
              <th className="px-2 py-1.5 text-right font-medium">数值</th>
              <th className="px-2 py-1.5 text-right font-medium">原始</th>
              <th className="w-7"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <tr
                key={p.id}
                onClick={() => onSelect(p.id)}
                className={cn(
                  "cursor-pointer border-t border-border/60 hover:bg-accent",
                  selected === p.id && "bg-primary/10",
                )}
              >
                <td className="px-3 py-1.5">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        "h-1.5 w-1.5 rounded-full",
                        p.kind === "AI" || p.kind === "AO" ? "bg-primary" : "bg-amber-500",
                        !p.present && "bg-muted-foreground/50",
                      )}
                    />
                    <span className="font-mono text-foreground">{p.id}</span>
                  </div>
                  <div className="max-w-[180px] truncate text-[10px] text-muted-foreground">{p.desc}</div>
                </td>
                <td className="px-2 py-1.5 text-right font-mono text-foreground">
                  {displayValue(p, mode)}
                  <span className="ml-1 text-[9px] text-muted-foreground">{unitFor(p, mode)}</span>
                </td>
                <td className="px-3 py-1.5 text-right font-mono text-[10px] text-muted-foreground">
                  {p.present ? p.raw : "—"}
                </td>
                <td className="pr-1 text-right">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onEdit(p.id);
                    }}
                    className="rounded p-1 text-muted-foreground/80 hover:bg-accent hover:text-foreground"
                    title="编辑点位 / 信号类型"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
