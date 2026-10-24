import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Download,
  Maximize2,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import PidDiagram from "@/components/PidDiagram";
import type {
  ConfigKind,
  ConfigPayload,
  Equipment,
  Segment,
  SignalKind,
  TagConfig,
  Topology,
} from "@/lib/api";
import { exportConfig, fetchConfig, saveConfig } from "@/lib/api";
import {
  areaOfFc,
  defaultSegments,
  ensureDefaultTopology,
  isAnalogKind,
  normalizeConfig,
  previewPoints,
  validateConfig,
  type ConfigErrors,
} from "@/lib/config";
import { cn } from "@/lib/utils";

type Tab = "segments" | "equipment" | "tags";

interface Props {
  onBack: () => void;
  onApplied: () => void;
}

const KINDS: ConfigKind[] = ["ai", "ao", "di", "do"];
const NONE = "__none__";
const KIND_LABEL: Record<ConfigKind, string> = {
  ai: "AI",
  ao: "AO",
  di: "DI",
  do: "DO",
};
const SIGNAL_KINDS: { value: SignalKind; label: string; range: [number, number] }[] = [
  { value: "current", label: "4–20 mA", range: [4000, 20000] },
  { value: "voltage", label: "0–10 V", range: [0, 10000] },
  { value: "adc", label: "ADC 码值", range: [0, 4095] },
  { value: "rtd", label: "PT100", range: [0, 1000] },
];

function fieldClass(error?: string) {
  return cn(
    "h-7 text-xs",
    error && "border-red-500/80 focus-visible:ring-red-500/40",
  );
}

function Field({
  label,
  error,
  children,
  className,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <Label className="mb-1 block text-[10px] font-medium text-muted-foreground">{label}</Label>
      {children}
      {error && (
        <div className="mt-0.5 text-[10px] leading-tight text-red-600 dark:text-red-300">
          {error}
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-card/40 p-3">
      <div className="mb-2 text-[11px] font-medium text-foreground">{title}</div>
      {hint && <div className="mb-2 text-[10px] text-muted-foreground">{hint}</div>}
      {children}
    </div>
  );
}

function defaultDirection(loop: Segment["loop"], branch: Segment["branch"]) {
  return (loop === "primary" && branch === "pre_hx") ||
    (loop === "secondary" && branch === "post_hx")
    ? "forward"
    : "reverse";
}

function nextName(prefix: string, existing: string[]) {
  let index = 1;
  while (existing.includes(`${prefix}${index}`)) index += 1;
  return `${prefix}${index}`;
}

export default function ConfigPage({ onBack, onApplied }: Props) {
  const [draft, setDraft] = useState<ConfigPayload | null>(null);
  const [tab, setTab] = useState<Tab>("segments");
  const [selectedTag, setSelectedTag] = useState(0);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [applied, setApplied] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchConfig()
      .then((config) => {
        if (!active) return;
        setDraft(ensureDefaultTopology(normalizeConfig(config)));
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setLoadError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const errors = useMemo<ConfigErrors>(
    () => (draft ? validateConfig(draft) : {}),
    [draft],
  );
  const errorCount = Object.keys(errors).length;

  const tags = draft?.tags ?? [];
  const topology: Topology = draft?.topology ?? { segments: [], equipment: [] };
  const previewPointMap = useMemo(() => previewPoints(tags, errors), [tags, errors]);
  const segmentIds = topology.segments.map((segment) => segment.id).filter(Boolean);
  const filteredTags = tags
    .map((tag, index) => ({ tag, index }))
    .filter(({ tag }) => {
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return tag.id.toLowerCase().includes(q) || tag.desc.toLowerCase().includes(q);
    });
  const activeTagIndex = Math.min(selectedTag, Math.max(0, tags.length - 1));
  const activeTag = tags[activeTagIndex];

  function update(mutate: (config: ConfigPayload) => void) {
    setApplied(false);
    setNotice(null);
    setDraft((previous) => {
      if (!previous) return previous;
      const next = structuredClone(previous);
      mutate(next);
      return next;
    });
  }

  function updateTopology(mutate: (topo: Topology) => void) {
    update((config) => {
      const topo = config.topology ?? { segments: [], equipment: [] };
      mutate(topo);
      config.topology = topo;
    });
  }

  function updateTag(index: number, mutate: (tag: TagConfig) => void) {
    update((config) => {
      const tag = config.tags[index];
      if (!tag) return;
      mutate(tag);
    });
  }

  function tagOption(kind: ConfigKind, writable: boolean | undefined, value: string) {
    const options = tags.filter(
      (tag) => tag.kind === kind && (writable === undefined || tag.writable === writable),
    );
    if (value && !options.some((tag) => tag.id === value)) {
      const current = tags.find((tag) => tag.id === value);
      if (current) options.unshift(current);
    }
    return options;
  }

  function nextAddr(kind: ConfigKind, rows: TagConfig[]) {
    const area = areaOfFc(kind === "ai" || kind === "ao" ? 3 : 1);
    const used = new Set(
      rows
        .filter((tag) => areaOfFc(tag.modbus.fc) === area)
        .map((tag) => tag.modbus.addr),
    );
    let addr = 0;
    while (used.has(addr)) addr += 1;
    return addr;
  }

  function addTag() {
    if (!draft) return;
    const index = draft.tags.length;
    update((config) => {
      config.tags.push({
        id: nextName("TAG", config.tags.map((tag) => tag.id)),
        desc: "",
        kind: "ai",
        unit: "",
        range: [0, 100],
        presence: "always",
        present: true,
        modbus: { fc: 3, addr: nextAddr("ai", config.tags) },
        writable: false,
      });
    });
    setSelectedTag(index);
  }

  function removeTag(index: number) {
    if (!draft) return;
    const tag = draft.tags[index];
    if (!tag) return;
    if (!window.confirm(`删除点位 ${tag.id || "(未命名)"}？`)) return;
    update((config) => {
      config.tags.splice(index, 1);
    });
    setSelectedTag(Math.max(0, Math.min(index, draft.tags.length - 2)));
  }

  function addSegment() {
    if (topology.segments.length >= 4) return;
    const slots = [
      { loop: "primary" as const, branch: "pre_hx" as const },
      { loop: "primary" as const, branch: "post_hx" as const },
      { loop: "secondary" as const, branch: "pre_hx" as const },
      { loop: "secondary" as const, branch: "post_hx" as const },
    ];
    const slot =
      slots.find(
        (item) =>
          !topology.segments.some(
            (segment) => segment.loop === item.loop && segment.branch === item.branch,
          ),
      ) ?? slots[0];
    updateTopology((topo) => {
      const id = nextName("seg", topo.segments.map((segment) => segment.id));
      topo.segments.push({
        id,
        label: `管段 ${topo.segments.length + 1}`,
        loop: slot.loop,
        branch: slot.branch,
        direction: defaultDirection(slot.loop, slot.branch),
      });
    });
  }

  function removeSegment(index: number) {
    updateTopology((topo) => {
      topo.segments.splice(index, 1);
    });
  }

  function addDefaultSegments() {
    updateTopology((topo) => {
      for (const item of defaultSegments()) {
        if (
          topo.segments.some(
            (segment) =>
              segment.id === item.id ||
              (segment.loop === item.loop && segment.branch === item.branch),
          )
        ) {
          continue;
        }
        topo.segments.push({ ...item });
      }
    });
  }

  function addHeatExchanger() {
    if (topology.equipment.some((item) => item.type === "heat_exchanger")) return;
    updateTopology((topo) => {
      topo.equipment.push({
        type: "heat_exchanger",
        id: nextName("HX", topo.equipment.map((item) => item.id)),
        label: "板式换热器",
      });
    });
  }

  function addValve() {
    if (topology.equipment.some((item) => item.type === "valve")) return;
    updateTopology((topo) => {
      const segment = topo.segments.find((item) => item.id === "p_out") ?? topo.segments[0];
      const cmd = tags.find((tag) => tag.kind === "ao" && tag.writable);
      const pos = tags.find((tag) => tag.kind === "ai");
      topo.equipment.push({
        type: "valve",
        id: nextName("V", topo.equipment.map((item) => item.id)),
        label: "比例阀",
        segment: segment?.id ?? "",
        order: 15,
        cmd: cmd?.id ?? "",
        pos: pos?.id ?? "",
      });
    });
  }

  function addPump() {
    if (topology.equipment.filter((item) => item.type === "pump").length >= 2) return;
    updateTopology((topo) => {
      const segment =
        topo.segments.find((item) => item.id === "s_out") ?? topo.segments[0];
      const runCmd = tags.find((tag) => tag.kind === "do" && tag.writable);
      const run = tags.find((tag) => tag.kind === "di");
      const speed = tags.find((tag) => tag.kind === "ao" && tag.writable);
      const count = topo.equipment.filter((item) => item.type === "pump").length + 1;
      topo.equipment.push({
        type: "pump",
        id: nextName("P", topo.equipment.map((item) => item.id)),
        label: `泵 ${count}`,
        segment: segment?.id ?? "",
        order: 5,
        run_cmd: runCmd?.id ?? "",
        run: run?.id ?? "",
        speed_cmd: speed?.id ?? "",
      });
    });
  }

  function removeEquipment(index: number) {
    updateTopology((topo) => {
      topo.equipment.splice(index, 1);
    });
  }

  async function handleSave() {
    if (!draft || errorCount > 0) return;
    setSaving(true);
    setSaveError(null);
    try {
      await saveConfig(draft);
      setApplied(true);
      setNotice("已应用到模拟器");
      onApplied();
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleExport() {
    if (!draft || errorCount > 0) return;
    setExporting(true);
    setSaveError(null);
    try {
      const blob = await exportConfig(draft);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `cdu-config-${new Date().toISOString().slice(0, 10)}.yaml`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setNotice("已导出完整 tags.yaml");
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px]" onClick={onBack}>
          <ArrowLeft className="h-3.5 w-3.5" />
          返回监控
        </Button>
        <div>
          <div className="text-sm font-semibold">配置 CDU</div>
          <div className="text-[10px] text-muted-foreground">
            独立配置页 · 系统图随输入实时预览
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {errorCount === 0 ? (
            <Badge variant="success">
              <CheckCircle2 className="h-3 w-3" />
              校验通过
            </Badge>
          ) : (
            <Badge variant="danger">
              <AlertTriangle className="h-3 w-3" />
              {errorCount} 项错误
            </Badge>
          )}
          {applied && <Badge variant="success">已应用</Badge>}
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[11px]"
            onClick={handleExport}
            disabled={loading || errorCount > 0 || exporting}
          >
            <Download className="h-3.5 w-3.5" />
            {exporting ? "导出中…" : "导出 YAML"}
          </Button>
          <Button
            size="sm"
            className="h-7 text-[11px]"
            onClick={handleSave}
            disabled={loading || errorCount > 0 || saving}
          >
            {saving ? "应用中…" : errorCount > 0 ? `请先修正 ${errorCount} 项` : "应用配置"}
          </Button>
        </div>
      </header>

      {(saveError || notice) && (
        <div
          className={cn(
            "border-b px-4 py-1.5 text-[11px]",
            saveError
              ? "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-300"
              : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
          )}
        >
          {saveError ? `操作失败：${saveError}` : notice}
        </div>
      )}

      <div className="flex items-center gap-1 border-b border-border px-3">
          {(
            [
              ["segments", "管段"],
              ["equipment", "设备"],
              ["tags", "点位"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setTab(value)}
              className={cn(
                "border-b-2 px-3 py-2 text-[11px] transition-colors",
                tab === value
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
              {Object.keys(errors).some((key) =>
                value === "segments"
                  ? key.startsWith("segment.") ||
                    key === "topology.segments" ||
                    key === "topology"
                  : value === "equipment"
                    ? key.startsWith("equipment.")
                    : key.startsWith("tag.") || key === "tags",
              ) && <span className="ml-1 text-red-500">!</span>}
            </button>
          ))}
        </div>

        <ResizablePanelGroup
          direction="vertical"
          autoSaveId="cdu-config-layout"
          className="min-h-0 flex-1"
        >
          <ResizablePanel defaultSize={52} minSize={30}>
            <div className="h-full overflow-auto p-4">
          {loading && <div className="text-xs text-muted-foreground">加载配置中…</div>}
          {loadError && (
            <div className="rounded border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-300">
              加载配置失败：{loadError}
            </div>
          )}

          {draft && tab === "segments" && (
            <div className="space-y-3">
              <Section
                title="管段"
                hint="每条管段对应系统图上的一个位置：回路 + 板换前/后。最多四条。"
              >
                {errors["topology.segments"] && (
                  <div className="mb-2 text-[10px] text-red-600 dark:text-red-300">
                    {errors["topology.segments"]}
                  </div>
                )}
                <div className="grid gap-3 xl:grid-cols-2">
                  {topology.segments.map((segment, index) => {
                    const err = (field: string) => errors[`segment.${index}.${field}`];
                    return (
                      <div key={index} className="rounded-lg border border-border p-3">
                        <div className="mb-2 flex items-center justify-between">
                          <span className="font-mono text-xs text-foreground">
                            {segment.id || `管段 #${index + 1}`}
                          </span>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-muted-foreground hover:text-red-500"
                            onClick={() => removeSegment(index)}
                            title="删除管段"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <Field label="ID" error={err("id")}>
                            <Input
                              value={segment.id}
                              className={fieldClass(err("id"))}
                              onChange={(event) =>
                                updateTopology((topo) => {
                                  topo.segments[index].id = event.target.value;
                                })
                              }
                            />
                          </Field>
                          <Field label="显示名称" error={err("label")}>
                            <Input
                              value={segment.label}
                              className={fieldClass(err("label"))}
                              onChange={(event) =>
                                updateTopology((topo) => {
                                  topo.segments[index].label = event.target.value;
                                })
                              }
                            />
                          </Field>
                          <Field label="回路">
                            <Select
                              value={segment.loop}
                              onValueChange={(value) =>
                                updateTopology((topo) => {
                                  const target = topo.segments[index];
                                  target.loop = value as Segment["loop"];
                                  target.direction = defaultDirection(
                                    target.loop,
                                    target.branch,
                                  );
                                })
                              }
                            >
                              <SelectTrigger className={fieldClass()}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="primary">primary · 一次侧</SelectItem>
                                <SelectItem value="secondary">secondary · 二次侧</SelectItem>
                              </SelectContent>
                            </Select>
                          </Field>
                          <Field label="板换侧" error={err("branch")}>
                            <Select
                              value={segment.branch}
                              onValueChange={(value) =>
                                updateTopology((topo) => {
                                  const target = topo.segments[index];
                                  target.branch = value as Segment["branch"];
                                  target.direction = defaultDirection(
                                    target.loop,
                                    target.branch,
                                  );
                                })
                              }
                            >
                              <SelectTrigger className={fieldClass(err("branch"))}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="pre_hx">pre_hx · 板换前</SelectItem>
                                <SelectItem value="post_hx">post_hx · 板换后</SelectItem>
                              </SelectContent>
                            </Select>
                          </Field>
                          <Field label="图上流向">
                            <Select
                              value={segment.direction}
                              onValueChange={(value) =>
                                updateTopology((topo) => {
                                  topo.segments[index].direction = value as Segment["direction"];
                                })
                              }
                            >
                              <SelectTrigger className={fieldClass()}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="forward">forward · 左→右</SelectItem>
                                <SelectItem value="reverse">reverse · 右→左</SelectItem>
                              </SelectContent>
                            </Select>
                          </Field>
                          <Field label="流量测点" error={err("flow")}>
                            <Select
                              value={segment.flow ?? NONE}
                              onValueChange={(value) =>
                                updateTopology((topo) => {
                                  topo.segments[index].flow =
                                    value === NONE ? undefined : value;
                                })
                              }
                            >
                              <SelectTrigger className={fieldClass(err("flow"))}>
                                <SelectValue placeholder="不配置" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value={NONE}>不配置</SelectItem>
                                {tags
                                  .filter((tag) => tag.kind === "ai")
                                  .map((tag) => (
                                    <SelectItem key={tag.id} value={tag.id}>
                                      {tag.id}
                                      {tag.desc ? ` · ${tag.desc}` : ""}
                                    </SelectItem>
                                  ))}
                              </SelectContent>
                            </Select>
                          </Field>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-[11px]"
                    disabled={topology.segments.length >= 4}
                    onClick={addSegment}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    新增管段
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-[11px]"
                    onClick={addDefaultSegments}
                  >
                    插入默认 4 段
                  </Button>
                </div>
              </Section>
            </div>
          )}

          {draft && tab === "equipment" && (
            <div className="space-y-3">
              <Section
                title="设备"
                hint="板换固定 1 台；比例阀最多 1 个；水泵 1–2 台。设备引用的点必须是正确方向的可写/只读点。"
              >
                {errors["equipment.counts"] && (
                  <div className="mb-2 text-[10px] text-red-600 dark:text-red-300">
                    {errors["equipment.counts"]}
                  </div>
                )}
                <div className="grid gap-3 xl:grid-cols-2">
                  {topology.equipment.map((item, index) => {
                    const err = (field: string) => errors[`equipment.${index}.${field}`];
                    return (
                      <div key={index} className="rounded-lg border border-border p-3">
                        <div className="mb-2 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline">
                              {item.type === "heat_exchanger"
                                ? "板换"
                                : item.type === "valve"
                                  ? "比例阀"
                                  : "水泵"}
                            </Badge>
                            <span className="font-mono text-xs text-foreground">{item.id}</span>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-muted-foreground hover:text-red-500"
                            onClick={() => removeEquipment(index)}
                            title="删除设备"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <Field label="ID" error={err("id")}>
                            <Input
                              value={item.id}
                              className={fieldClass(err("id"))}
                              onChange={(event) =>
                                updateTopology((topo) => {
                                  topo.equipment[index].id = event.target.value;
                                })
                              }
                            />
                          </Field>
                          <Field label="显示名称" error={err("label")}>
                            <Input
                              value={item.label}
                              className={fieldClass(err("label"))}
                              onChange={(event) =>
                                updateTopology((topo) => {
                                  topo.equipment[index].label = event.target.value;
                                })
                              }
                            />
                          </Field>
                          {item.type !== "heat_exchanger" && (
                            <>
                              <Field label="安装管段" error={err("segment")}>
                                <Select
                                  value={item.segment || undefined}
                                  onValueChange={(value) =>
                                    updateTopology((topo) => {
                                      const target = topo.equipment[index];
                                      if (target.type === "heat_exchanger") return;
                                      target.segment = value;
                                    })
                                  }
                                >
                                  <SelectTrigger className={fieldClass(err("segment"))}>
                                    <SelectValue placeholder="选择管段" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {topology.segments
                                      .filter((segment) => segment.id)
                                      .map((segment) => (
                                        <SelectItem key={segment.id} value={segment.id}>
                                          {segment.id} · {segment.label}
                                        </SelectItem>
                                      ))}
                                  </SelectContent>
                                </Select>
                              </Field>
                              <Field label="order" error={err("order")}>
                                <Input
                                  type="number"
                                  value={item.order}
                                  className={fieldClass(err("order"))}
                                  onChange={(event) =>
                                    updateTopology((topo) => {
                                      const target = topo.equipment[index];
                                      if (target.type === "heat_exchanger") return;
                                      target.order = Number(event.target.value);
                                    })
                                  }
                                />
                              </Field>
                            </>
                          )}
                          {item.type === "valve" && (
                            <>
                              <Field label="开度指令（AO）" error={err("cmd")}>
                                <Select
                                  value={item.cmd || undefined}
                                  onValueChange={(value) =>
                                    updateTopology((topo) => {
                                      const target = topo.equipment[index];
                                      if (target.type === "valve") target.cmd = value;
                                    })
                                  }
                                >
                                  <SelectTrigger className={fieldClass(err("cmd"))}>
                                    <SelectValue placeholder="选择点位" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {tagOption("ao", true, item.cmd)
                                      .filter((tag) => tag.id)
                                      .map((tag) => (
                                        <SelectItem key={tag.id} value={tag.id}>
                                          {tag.id} · {tag.desc}
                                        </SelectItem>
                                      ))}
                                  </SelectContent>
                                </Select>
                              </Field>
                              <Field label="开度反馈（AI）" error={err("pos")}>
                                <Select
                                  value={item.pos || undefined}
                                  onValueChange={(value) =>
                                    updateTopology((topo) => {
                                      const target = topo.equipment[index];
                                      if (target.type === "valve") target.pos = value;
                                    })
                                  }
                                >
                                  <SelectTrigger className={fieldClass(err("pos"))}>
                                    <SelectValue placeholder="选择点位" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {tagOption("ai", undefined, item.pos)
                                      .filter((tag) => tag.id)
                                      .map((tag) => (
                                        <SelectItem key={tag.id} value={tag.id}>
                                          {tag.id} · {tag.desc}
                                        </SelectItem>
                                      ))}
                                  </SelectContent>
                                </Select>
                              </Field>
                            </>
                          )}
                          {item.type === "pump" && (
                            <>
                              <Field label="启停命令（DO）" error={err("run_cmd")}>
                                <Select
                                  value={item.run_cmd || undefined}
                                  onValueChange={(value) =>
                                    updateTopology((topo) => {
                                      const target = topo.equipment[index];
                                      if (target.type === "pump") target.run_cmd = value;
                                    })
                                  }
                                >
                                  <SelectTrigger className={fieldClass(err("run_cmd"))}>
                                    <SelectValue placeholder="选择点位" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {tagOption("do", true, item.run_cmd)
                                      .filter((tag) => tag.id)
                                      .map((tag) => (
                                        <SelectItem key={tag.id} value={tag.id}>
                                          {tag.id} · {tag.desc}
                                        </SelectItem>
                                      ))}
                                  </SelectContent>
                                </Select>
                              </Field>
                              <Field label="运行反馈（DI）" error={err("run")}>
                                <Select
                                  value={item.run || undefined}
                                  onValueChange={(value) =>
                                    updateTopology((topo) => {
                                      const target = topo.equipment[index];
                                      if (target.type === "pump") target.run = value;
                                    })
                                  }
                                >
                                  <SelectTrigger className={fieldClass(err("run"))}>
                                    <SelectValue placeholder="选择点位" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {tagOption("di", undefined, item.run)
                                      .filter((tag) => tag.id)
                                      .map((tag) => (
                                        <SelectItem key={tag.id} value={tag.id}>
                                          {tag.id} · {tag.desc}
                                        </SelectItem>
                                      ))}
                                  </SelectContent>
                                </Select>
                              </Field>
                              <Field label="转速命令（AO）" error={err("speed_cmd")}>
                                <Select
                                  value={item.speed_cmd || undefined}
                                  onValueChange={(value) =>
                                    updateTopology((topo) => {
                                      const target = topo.equipment[index];
                                      if (target.type === "pump") target.speed_cmd = value;
                                    })
                                  }
                                >
                                  <SelectTrigger className={fieldClass(err("speed_cmd"))}>
                                    <SelectValue placeholder="选择点位" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {tagOption("ao", true, item.speed_cmd)
                                      .filter((tag) => tag.id)
                                      .map((tag) => (
                                        <SelectItem key={tag.id} value={tag.id}>
                                          {tag.id} · {tag.desc}
                                        </SelectItem>
                                      ))}
                                  </SelectContent>
                                </Select>
                              </Field>
                              <Field label="故障反馈（DI，可选）" error={err("fault")}>
                                <Select
                                  value={item.fault ?? NONE}
                                  onValueChange={(value) =>
                                    updateTopology((topo) => {
                                      const target = topo.equipment[index];
                                      if (target.type === "pump") {
                                        target.fault = value === NONE ? undefined : value;
                                      }
                                    })
                                  }
                                >
                                  <SelectTrigger className={fieldClass(err("fault"))}>
                                    <SelectValue placeholder="不配置" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value={NONE}>不配置</SelectItem>
                                    {tagOption("di", undefined, item.fault ?? "")
                                      .filter((tag) => tag.id)
                                      .map((tag) => (
                                        <SelectItem key={tag.id} value={tag.id}>
                                          {tag.id} · {tag.desc}
                                        </SelectItem>
                                      ))}
                                  </SelectContent>
                                </Select>
                              </Field>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-[11px]"
                    disabled={topology.equipment.some((item) => item.type === "heat_exchanger")}
                    onClick={addHeatExchanger}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    添加板换
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-[11px]"
                    disabled={topology.equipment.some((item) => item.type === "valve")}
                    onClick={addValve}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    添加比例阀
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-[11px]"
                    disabled={topology.equipment.filter((item) => item.type === "pump").length >= 2}
                    onClick={addPump}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    添加水泵
                  </Button>
                </div>
              </Section>
            </div>
          )}

          {draft && tab === "tags" && (
            <div className="grid min-h-[520px] gap-3 lg:grid-cols-[280px_minmax(0,1fr)]">
              <div className="flex min-h-0 flex-col rounded-lg border border-border">
                <div className="border-b border-border p-2">
                  <div className="relative">
                    <Search className="absolute left-2 top-1.5 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="搜索点位"
                      className="h-7 w-full rounded-md border border-border bg-background pl-7 pr-2 text-xs outline-none focus:border-primary/60"
                    />
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2 h-7 w-full text-[11px]"
                    onClick={addTag}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    新增点位
                  </Button>
                </div>
                <div className="min-h-0 flex-1 overflow-auto p-1">
                  {filteredTags.map(({ tag, index }) => {
                    const hasError = Object.keys(errors).some((key) =>
                      key.startsWith(`tag.${index}.`),
                    );
                    return (
                      <button
                        key={index}
                        onClick={() => setSelectedTag(index)}
                        className={cn(
                          "mb-1 flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
                          activeTagIndex === index
                            ? "bg-primary/10"
                            : "hover:bg-accent",
                        )}
                      >
                        <span
                          className={cn(
                            "mt-1 h-1.5 w-1.5 shrink-0 rounded-full",
                            hasError ? "bg-red-500" : "bg-emerald-500",
                          )}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-mono text-[11px] text-foreground">
                            {tag.id || "(未命名)"}
                          </span>
                          <span className="block truncate text-[10px] text-muted-foreground">
                            {tag.desc || "无描述"}
                          </span>
                        </span>
                        <Badge variant="outline" className="shrink-0">
                          {KIND_LABEL[tag.kind]}
                        </Badge>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div
                data-testid="tag-detail"
                className="min-w-0 rounded-lg border border-border p-3"
              >
                {!activeTag && (
                  <div className="text-xs text-muted-foreground">还没有点位，先新增一个。</div>
                )}
                {activeTag && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm text-foreground">
                          {activeTag.id || "(未命名)"}
                        </span>
                        <Badge variant="outline">{KIND_LABEL[activeTag.kind]}</Badge>
                        {Object.keys(errors).some((key) =>
                          key.startsWith(`tag.${activeTagIndex}.`),
                        ) && <Badge variant="danger">有错误</Badge>}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-[11px] text-red-600 hover:text-red-500 dark:text-red-300"
                        onClick={() => removeTag(activeTagIndex)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        删除
                      </Button>
                    </div>

                    <Section title="基本信息">
                      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                        <Field label="ID" error={errors[`tag.${activeTagIndex}.id`]}>
                          <Input
                            value={activeTag.id}
                            className={fieldClass(errors[`tag.${activeTagIndex}.id`])}
                            onChange={(event) =>
                              updateTag(activeTagIndex, (tag) => {
                                tag.id = event.target.value;
                              })
                            }
                          />
                        </Field>
                        <Field label="类型">
                          <Select
                            value={activeTag.kind}
                            onValueChange={(value) =>
                              updateTag(activeTagIndex, (tag) => {
                                const kind = value as ConfigKind;
                                tag.kind = kind;
                                tag.writable = kind === "ao" || kind === "do";
                                if (isAnalogKind(kind)) {
                                  tag.range ??= [0, 100];
                                  tag.unit ??= "";
                                } else {
                                  tag.range = undefined;
                                  tag.unit = undefined;
                                  tag.signal = undefined;
                                  tag.place = undefined;
                                  tag.initial = undefined;
                                }
                                if (kind === "ai" || kind === "di") {
                                  tag.initial = undefined;
                                }
                                tag.modbus.fc = kind === "ai" || kind === "ao" ? 3 : 1;
                              })
                            }
                          >
                            <SelectTrigger className={fieldClass()}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {KINDS.map((kind) => (
                                <SelectItem key={kind} value={kind}>
                                  {KIND_LABEL[kind]}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </Field>
                        <Field
                          label="工程单位"
                          error={errors[`tag.${activeTagIndex}.unit`]}
                        >
                          <Input
                            value={activeTag.unit ?? ""}
                            disabled={!isAnalogKind(activeTag.kind)}
                            className={fieldClass(errors[`tag.${activeTagIndex}.unit`])}
                            onChange={(event) =>
                              updateTag(activeTagIndex, (tag) => {
                                tag.unit = event.target.value;
                              })
                            }
                          />
                        </Field>
                        <Field label="在位">
                          <div className="flex h-7 items-center gap-2 text-[11px] text-muted-foreground">
                            <Checkbox
                              id="tag-present"
                              checked={activeTag.present}
                              onCheckedChange={(checked) =>
                                updateTag(activeTagIndex, (tag) => {
                                  tag.present = checked === true;
                                })
                              }
                            />
                            <Label
                              htmlFor="tag-present"
                              className="text-[11px] font-normal text-muted-foreground"
                            >
                              已安装
                            </Label>
                          </div>
                        </Field>
                        <Field
                          label="描述"
                          className="col-span-2 md:col-span-4"
                          error={errors[`tag.${activeTagIndex}.desc`]}
                        >
                          <Input
                            value={activeTag.desc}
                            className={fieldClass(errors[`tag.${activeTagIndex}.desc`])}
                            onChange={(event) =>
                              updateTag(activeTagIndex, (tag) => {
                                tag.desc = event.target.value;
                              })
                            }
                          />
                        </Field>
                        <Field label="presence">
                          <Select
                            value={activeTag.presence}
                            onValueChange={(value) =>
                              updateTag(activeTagIndex, (tag) => {
                                tag.presence = value as TagConfig["presence"];
                                if (tag.presence === "absent") tag.present = false;
                              })
                            }
                          >
                            <SelectTrigger className={fieldClass()}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="always">always</SelectItem>
                              <SelectItem value="optional">optional</SelectItem>
                              <SelectItem value="absent">absent</SelectItem>
                            </SelectContent>
                          </Select>
                        </Field>
                        <Field label="可写">
                          <div className="flex h-7 items-center gap-2 text-[11px] text-muted-foreground">
                            <Checkbox
                              id="tag-writable"
                              checked={activeTag.writable}
                              onCheckedChange={(checked) =>
                                updateTag(activeTagIndex, (tag) => {
                                  tag.writable = checked === true;
                                })
                              }
                            />
                            <Label
                              htmlFor="tag-writable"
                              className="text-[11px] font-normal text-muted-foreground"
                            >
                              writable
                            </Label>
                          </div>
                        </Field>
                        {errors[`tag.${activeTagIndex}.present`] && (
                          <Field
                            label="在位标记"
                            error={errors[`tag.${activeTagIndex}.present`]}
                            className="col-span-2"
                          >
                            <span className="text-[10px] text-red-500">presence=absent 不能标记在位</span>
                          </Field>
                        )}
                      </div>
                    </Section>

                    {isAnalogKind(activeTag.kind) && (
                      <Section title="量程与信号">
                        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                          <Field label="量程下限" error={errors[`tag.${activeTagIndex}.range`]}>
                            <Input
                              type="number"
                              value={activeTag.range?.[0] ?? 0}
                              className={fieldClass(errors[`tag.${activeTagIndex}.range`])}
                              onChange={(event) =>
                                updateTag(activeTagIndex, (tag) => {
                                  tag.range ??= [0, 100];
                                  tag.range[0] = Number(event.target.value);
                                })
                              }
                            />
                          </Field>
                          <Field label="量程上限" error={errors[`tag.${activeTagIndex}.range`]}>
                            <Input
                              type="number"
                              value={activeTag.range?.[1] ?? 100}
                              className={fieldClass(errors[`tag.${activeTagIndex}.range`])}
                              onChange={(event) =>
                                updateTag(activeTagIndex, (tag) => {
                                  tag.range ??= [0, 100];
                                  tag.range[1] = Number(event.target.value);
                                })
                              }
                            />
                          </Field>
                          <Field label="信号类型">
                            <Select
                              value={activeTag.signal?.kind ?? NONE}
                              onValueChange={(value) =>
                                updateTag(activeTagIndex, (tag) => {
                                  if (value === NONE) {
                                    tag.signal = undefined;
                                    return;
                                  }
                                  const kind = value as SignalKind;
                                  const preset = SIGNAL_KINDS.find((item) => item.value === kind);
                                  tag.signal = {
                                    kind,
                                    range: preset?.range ?? [0, 100],
                                  };
                                })
                              }
                            >
                              <SelectTrigger className={fieldClass()}>
                                <SelectValue placeholder="继承表级默认" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value={NONE}>继承表级默认</SelectItem>
                                {SIGNAL_KINDS.map((item) => (
                                  <SelectItem key={item.value} value={item.value}>
                                    {item.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </Field>
                          <Field label="噪声幅值（可选）" error={errors[`tag.${activeTagIndex}.noise`]}>
                            <Input
                              type="number"
                              value={activeTag.noise_sigma ?? ""}
                              placeholder="继承默认"
                              className={fieldClass(errors[`tag.${activeTagIndex}.noise`])}
                              onChange={(event) =>
                                updateTag(activeTagIndex, (tag) => {
                                  tag.noise_sigma =
                                    event.target.value === ""
                                      ? undefined
                                      : Number(event.target.value);
                                })
                              }
                            />
                          </Field>
                          {activeTag.signal && (
                            <>
                              <Field
                                label="信号下限"
                                error={errors[`tag.${activeTagIndex}.signal`]}
                              >
                                <Input
                                  type="number"
                                  value={activeTag.signal.range[0]}
                                  className={fieldClass(errors[`tag.${activeTagIndex}.signal`])}
                                  onChange={(event) =>
                                    updateTag(activeTagIndex, (tag) => {
                                      if (tag.signal) {
                                        tag.signal.range[0] = Number(event.target.value);
                                      }
                                    })
                                  }
                                />
                              </Field>
                              <Field
                                label="信号上限"
                                error={errors[`tag.${activeTagIndex}.signal`]}
                              >
                                <Input
                                  type="number"
                                  value={activeTag.signal.range[1]}
                                  className={fieldClass(errors[`tag.${activeTagIndex}.signal`])}
                                  onChange={(event) =>
                                    updateTag(activeTagIndex, (tag) => {
                                      if (tag.signal) {
                                        tag.signal.range[1] = Number(event.target.value);
                                      }
                                    })
                                  }
                                />
                              </Field>
                            </>
                          )}
                        </div>
                      </Section>
                    )}

                    <Section title="Modbus">
                      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                        <Field label="功能码" error={errors[`tag.${activeTagIndex}.fc`]}>
                          <Select
                            value={String(activeTag.modbus.fc)}
                            onValueChange={(value) =>
                              updateTag(activeTagIndex, (tag) => {
                                tag.modbus.fc = Number(value);
                              })
                            }
                          >
                            <SelectTrigger className={fieldClass(errors[`tag.${activeTagIndex}.fc`])}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {[3, 6, 16, 1, 5, 15].map((fc) => (
                                <SelectItem key={fc} value={String(fc)}>
                                  FC{fc}
                                  {fc === 3 || fc === 6 || fc === 16
                                    ? " · 保持寄存器"
                                    : " · 线圈"}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </Field>
                        <Field label="地址" error={errors[`tag.${activeTagIndex}.addr`]}>
                          <Input
                            type="number"
                            value={activeTag.modbus.addr}
                            className={fieldClass(errors[`tag.${activeTagIndex}.addr`])}
                            onChange={(event) =>
                              updateTag(activeTagIndex, (tag) => {
                                tag.modbus.addr = Number(event.target.value);
                              })
                            }
                          />
                        </Field>
                      </div>
                    </Section>

                    <Section title="系统图位置">
                      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                        <Field
                          label="管段"
                          error={errors[`tag.${activeTagIndex}.place`]}
                        >
                          <Select
                            value={activeTag.place?.segment ?? NONE}
                            onValueChange={(value) =>
                              updateTag(activeTagIndex, (tag) => {
                                tag.place =
                                  value === NONE
                                    ? undefined
                                    : { segment: value, order: tag.place?.order ?? 10 };
                              })
                            }
                          >
                            <SelectTrigger
                              className={fieldClass(errors[`tag.${activeTagIndex}.place`])}
                            >
                              <SelectValue placeholder="不显示在系统图" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NONE}>不显示在系统图</SelectItem>
                              {segmentIds.map((id) => (
                                <SelectItem key={id} value={id}>
                                  {id}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </Field>
                        <Field label="order" error={errors[`tag.${activeTagIndex}.order`]}>
                          <Input
                            type="number"
                            disabled={!activeTag.place}
                            value={activeTag.place?.order ?? 10}
                            className={fieldClass(errors[`tag.${activeTagIndex}.order`])}
                            onChange={(event) =>
                              updateTag(activeTagIndex, (tag) => {
                                if (tag.place) tag.place.order = Number(event.target.value);
                              })
                            }
                          />
                        </Field>
                      </div>
                    </Section>

                    <Section title="上电初始值">
                      {activeTag.kind === "ao" && (
                        <Field
                          label="AO 初始值（留空表示不设置）"
                          error={errors[`tag.${activeTagIndex}.initial`]}
                        >
                          <Input
                            type="number"
                            value={typeof activeTag.initial === "number" ? activeTag.initial : ""}
                            placeholder="不设置"
                            className={fieldClass(errors[`tag.${activeTagIndex}.initial`])}
                            onChange={(event) =>
                              updateTag(activeTagIndex, (tag) => {
                                tag.initial =
                                  event.target.value === ""
                                    ? undefined
                                    : Number(event.target.value);
                              })
                            }
                          />
                        </Field>
                      )}
                      {activeTag.kind === "do" && (
                        <Field
                          label="DO 初始状态"
                          error={errors[`tag.${activeTagIndex}.initial`]}
                        >
                          <Select
                            value={
                              activeTag.initial === true
                                ? "on"
                                : activeTag.initial === false
                                  ? "off"
                                  : NONE
                            }
                            onValueChange={(value) =>
                              updateTag(activeTagIndex, (tag) => {
                                tag.initial =
                                  value === "on"
                                    ? true
                                    : value === "off"
                                      ? false
                                      : undefined;
                              })
                            }
                          >
                            <SelectTrigger
                              className={fieldClass(errors[`tag.${activeTagIndex}.initial`])}
                            >
                              <SelectValue placeholder="不设置" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NONE}>不设置</SelectItem>
                              <SelectItem value="on">ON</SelectItem>
                              <SelectItem value="off">OFF</SelectItem>
                            </SelectContent>
                          </Select>
                        </Field>
                      )}
                      {(activeTag.kind === "ai" || activeTag.kind === "di") && (
                        <div className="text-[10px] text-muted-foreground">输入点不需要初始值。</div>
                      )}
                    </Section>
                  </div>
                )}
              </div>
            </div>
          )}
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel defaultSize={48} minSize={20}>
            <div className="flex h-full flex-col bg-card/40">
              <div className="flex items-center gap-2 border-b border-border px-4 py-1.5 text-[11px] text-muted-foreground">
                <span className="font-medium text-foreground">系统图预览</span>
                <Badge variant="outline">实时</Badge>
                <span className="text-[10px]">已选管段的传感器，数值以 — 占位</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto h-6 px-2 text-[10px]"
                  onClick={() => setFullscreen(true)}
                >
                  <Maximize2 className="h-3.5 w-3.5" />
                  全屏
                </Button>
              </div>
              <div data-testid="config-preview" className="min-h-0 flex-1 px-3 pb-2">
                <PidDiagram
                  points={previewPointMap}
                  topology={topology}
                  selected=""
                  mode="eng"
                  onSelect={() => {}}
                  preview
                  className="h-full w-full"
                />
              </div>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>

        <Dialog open={fullscreen} onOpenChange={setFullscreen}>
          <DialogContent className="flex h-screen max-h-none w-screen max-w-none flex-col gap-0 rounded-none border-0 p-0">
            <DialogHeader className="flex-row items-center justify-between border-b border-border px-4 py-2">
              <DialogTitle className="text-sm">系统图预览</DialogTitle>
              <DialogDescription className="sr-only">
                全屏查看当前配置的系统图布局
              </DialogDescription>
            </DialogHeader>
            <div className="min-h-0 flex-1 p-2">
              <PidDiagram
                points={previewPointMap}
                topology={topology}
                selected=""
                mode="eng"
                onSelect={() => {}}
                preview
                className="h-full w-full"
              />
            </div>
          </DialogContent>
        </Dialog>
      </div>
    );
  }
