import type {
  ConfigKind,
  ConfigPayload,
  Equipment,
  PointKind,
  PointSample,
  Segment,
  TagConfig,
  Topology,
} from "./api";

export type ConfigErrors = Record<string, string>;

const FC_AREA: Record<number, "coil" | "holding"> = {
  1: "coil",
  5: "coil",
  15: "coil",
  3: "holding",
  6: "holding",
  16: "holding",
};

export function isAnalogKind(kind: ConfigKind) {
  return kind === "ai" || kind === "ao";
}

export function areaOfFc(fc: number) {
  return FC_AREA[fc];
}

export function isInteger(value: number) {
  return Number.isInteger(value);
}

function isBlank(value: string) {
  return value.trim().length === 0;
}

function badId(value: string) {
  return isBlank(value) || /\s/.test(value) || value.length > 32;
}

function onSegment(tag: TagConfig, segment: Segment) {
  const place = tag.place;
  if (!place) return false;
  if (place.segment) return place.segment === segment.id;
  return place.loop === segment.loop && place.branch === segment.branch;
}

/** 把旧式 place.loop/branch 归一成 segment，配置表单只用 segment。 */
export function normalizeConfig(config: ConfigPayload): ConfigPayload {
  const topology = config.topology;
  if (!topology || !config.tags) return config;
  for (const tag of config.tags) {
    const place = tag.place;
    if (!place || place.segment) continue;
    const segment = topology.segments.find(
      (item) => item.loop === place.loop && item.branch === place.branch,
    );
    if (segment) {
      tag.place = { segment: segment.id, order: place.order };
    }
  }
  return config;
}

/** 新建/空配置的默认四段管。 */
export function defaultSegments(): Segment[] {
  return [
    {
      id: "p_in",
      label: "一次侧进水",
      loop: "primary",
      branch: "pre_hx",
      direction: "forward",
    },
    {
      id: "p_out",
      label: "一次侧出水",
      loop: "primary",
      branch: "post_hx",
      direction: "reverse",
    },
    {
      id: "s_in",
      label: "二次侧回水",
      loop: "secondary",
      branch: "pre_hx",
      direction: "reverse",
    },
    {
      id: "s_out",
      label: "二次侧供液",
      loop: "secondary",
      branch: "post_hx",
      direction: "forward",
    },
  ];
}

export function ensureDefaultTopology(config: ConfigPayload): ConfigPayload {
  if (config.topology && config.topology.segments.length > 0) {
    return normalizeConfig(config);
  }
  const existingEquipment = config.topology?.equipment ?? [];
  config.topology = {
    segments: defaultSegments(),
    equipment:
      existingEquipment.length > 0
        ? existingEquipment
        : [{ type: "heat_exchanger", id: "HX1", label: "板式换热器" }],
  };
  return normalizeConfig(config);
}

/** 配置页预览用的假点位：只保留字段完整、已经选好管段的点，数值一律显示 “—”。 */
export function previewPoints(
  tags: TagConfig[],
  errors: ConfigErrors,
): Map<string, PointSample> {
  const points = new Map<string, PointSample>();
  const errorKeys = Object.keys(errors);
  tags.forEach((tag, index) => {
    const segment = tag.place?.segment;
    if (!tag.id.trim() || !segment) return;
    if (errorKeys.some((key) => key.startsWith(`tag.${index}.`))) return;
    points.set(tag.id, {
      id: tag.id,
      desc: tag.desc,
      kind: tag.kind.toUpperCase() as PointKind,
      unit: tag.unit ?? "",
      v: 0,
      raw: 0,
      present: true,
      range: tag.range ?? [0, 100],
      addr: tag.modbus.addr,
      signal_kind: tag.signal?.kind ?? "current",
      signal_range: tag.signal?.range ?? [4000, 20000],
      place: { segment, order: tag.place?.order ?? 0 },
    });
  });
  return points;
}

export function defaultTopology(): Topology {
  return {
    segments: defaultSegments(),
    equipment: [{ type: "heat_exchanger", id: "HX1", label: "板式换热器" }],
  };
}

export function validateConfig(config: ConfigPayload): ConfigErrors {
  const errors: ConfigErrors = {};
  const tags = config.tags ?? [];
  const topology = config.topology;
  const segments = topology?.segments ?? [];
  const equipment = topology?.equipment ?? [];

  if (!topology) {
    errors.topology = "缺少 topology 段";
  }
  if (segments.length === 0) {
    errors["topology.segments"] = "至少需要一条管段";
  }
  if (tags.length === 0) {
    errors.tags = "至少需要一个点位";
  }

  const tagIndex = new Map<string, number>();
  tags.forEach((tag, index) => {
    if (!tagIndex.has(tag.id)) tagIndex.set(tag.id, index);
  });

  // ---------------- 管段 ----------------
  const segmentIds = new Set<string>();
  const slots = new Set<string>();
  segments.forEach((segment, index) => {
    const base = `segment.${index}`;
    if (badId(segment.id)) {
      errors[`${base}.id`] = "id 不能为空、不能含空白，最多 32 字符";
    } else if (segmentIds.has(segment.id)) {
      errors[`${base}.id`] = "管段 id 重复";
    } else {
      segmentIds.add(segment.id);
    }
    if (isBlank(segment.label)) {
      errors[`${base}.label`] = "显示名称不能为空";
    }
    const slot = `${segment.loop}:${segment.branch}`;
    if (slots.has(slot)) {
      errors[`${base}.branch`] = "同一回路同一板换侧只能有一条管段";
    } else {
      slots.add(slot);
    }
    if (segment.flow) {
      const flow = tagByIdLookup(tags, segment.flow);
      if (!flow) {
        errors[`${base}.flow`] = "流量测点不存在";
      } else if (flow.kind !== "ai") {
        errors[`${base}.flow`] = "流量测点必须是 AI";
      } else if (!onSegment(flow, segment)) {
        errors[`${base}.flow`] = "流量测点必须放在该管段上";
      }
    }
  });

  // ---------------- 点位 ----------------
  const spans = new Map<string, string>();
  tags.forEach((tag, index) => {
    const base = `tag.${index}`;
    const analog = isAnalogKind(tag.kind);

    if (badId(tag.id)) {
      errors[`${base}.id`] = "id 不能为空、不能含空白，最多 32 字符";
    } else if (tagIndex.get(tag.id) !== index) {
      errors[`${base}.id`] = "点位 id 重复";
    }
    if (isBlank(tag.desc)) {
      errors[`${base}.desc`] = "描述不能为空";
    }

    if (analog) {
      if (isBlank(tag.unit ?? "")) {
        errors[`${base}.unit`] = "模拟量需要工程单位";
      }
      const range = tag.range;
      if (!range || !Number.isFinite(range[0]) || !Number.isFinite(range[1])) {
        errors[`${base}.range`] = "需要有效的量程";
      } else if (range[0] >= range[1]) {
        errors[`${base}.range`] = "量程上限必须大于下限";
      }
    } else if (tag.unit?.trim()) {
      errors[`${base}.unit`] = "开关量不需要工程单位";
    }

    const area = areaOfFc(tag.modbus.fc);
    if (!area) {
      errors[`${base}.fc`] = "功能码只能是 1/5/15（线圈）或 3/6/16（保持寄存器）";
    } else {
      const expected = analog ? "holding" : "coil";
      if (area !== expected) {
        errors[`${base}.fc`] = analog
          ? "AI/AO 必须用 FC3/6/16"
          : "DI/DO 必须用 FC1/5/15";
      }
    }
    if (!isInteger(tag.modbus.addr) || tag.modbus.addr < 0 || tag.modbus.addr > 65535) {
      errors[`${base}.addr`] = "地址必须是 0–65535 的整数";
    } else if (area) {
      const key = `${area}:${tag.modbus.addr}`;
      const previous = spans.get(key);
      if (previous && previous !== tag.id) {
        errors[`${base}.addr`] = `地址与 ${previous} 重叠`;
      } else {
        spans.set(key, tag.id);
      }
    }

    if (!analog && tag.signal) {
      errors[`${base}.signal`] = "开关量不需要信号量程";
    }
    if (analog && tag.signal) {
      const sig = tag.signal;
      if (
        !Number.isFinite(sig.range[0]) ||
        !Number.isFinite(sig.range[1]) ||
        sig.range[0] >= sig.range[1]
      ) {
        errors[`${base}.signal`] = "信号量程需要上限大于下限";
      } else if (sig.range[0] < 0 || sig.range[1] > 65535) {
        errors[`${base}.signal`] = "信号量程必须在 0–65535";
      }
    }

    if (tag.place) {
      if (!tag.place.segment) {
        errors[`${base}.place`] = "需要选择管段";
      } else if (!segmentIds.has(tag.place.segment)) {
        errors[`${base}.place`] = "管段不存在";
      }
      if (!isInteger(tag.place.order)) {
        errors[`${base}.order`] = "order 必须是整数";
      }
      if (tag.kind !== "ai") {
        errors[`${base}.place`] = "只有 AI 点能放到系统图上";
      }
    }

    if (tag.presence === "absent" && tag.present) {
      errors[`${base}.present`] = "presence=absent 时不能标记为在位";
    }

    if (tag.kind === "ai" || tag.kind === "di") {
      if (tag.writable) errors[`${base}.writable`] = "输入点不能可写";
      if (tag.initial !== undefined) {
        errors[`${base}.initial`] = "输入点不能设置上电初始值";
      }
    } else {
      if (!tag.writable) errors[`${base}.writable`] = "输出点必须可写";
      if (tag.kind === "ao" && tag.initial !== undefined) {
        if (typeof tag.initial !== "number" || !Number.isFinite(tag.initial)) {
          errors[`${base}.initial`] = "AO 的初始值必须是数字";
        } else if (tag.range && (tag.initial < tag.range[0] || tag.initial > tag.range[1])) {
          errors[`${base}.initial`] = "初始值必须落在量程内";
        }
      }
      if (tag.kind === "do" && tag.initial !== undefined && typeof tag.initial !== "boolean") {
        errors[`${base}.initial`] = "DO 的初始值必须是 ON/OFF";
      }
    }

    if (tag.noise_sigma !== undefined && (!Number.isFinite(tag.noise_sigma) || tag.noise_sigma < 0)) {
      errors[`${base}.noise`] = "噪声幅值必须是非负数";
    }
  });

  // ---------------- 设备 ----------------
  const equipmentIds = new Set<string>();
  let hxCount = 0;
  let valveCount = 0;
  let pumpCount = 0;

  const ref = (tagId: string) => tagByIdLookup(tags, tagId);

  equipment.forEach((item, index) => {
    const base = `equipment.${index}`;
    if (badId(item.id)) {
      errors[`${base}.id`] = "id 不能为空、不能含空白，最多 32 字符";
    } else if (equipmentIds.has(item.id)) {
      errors[`${base}.id`] = "设备 id 重复";
    } else {
      equipmentIds.add(item.id);
    }
    if (isBlank(item.label)) {
      errors[`${base}.label`] = "显示名称不能为空";
    }

    switch (item.type) {
      case "heat_exchanger":
        hxCount += 1;
        break;
      case "valve": {
        valveCount += 1;
        checkSegment(errors, base, item, segmentIds);
        checkOrder(errors, base, item.order);
        const cmd = ref(item.cmd);
        const pos = ref(item.pos);
        if (!cmd) errors[`${base}.cmd`] = "开度指令点不存在";
        else if (cmd.kind !== "ao" || !cmd.writable) {
          errors[`${base}.cmd`] = "开度指令必须是可写的 AO";
        }
        if (!pos) errors[`${base}.pos`] = "开度反馈点不存在";
        else if (pos.kind !== "ai") errors[`${base}.pos`] = "开度反馈必须是 AI";
        break;
      }
      case "pump": {
        pumpCount += 1;
        checkSegment(errors, base, item, segmentIds);
        checkOrder(errors, base, item.order);
        const runCmd = ref(item.run_cmd);
        const run = ref(item.run);
        const speed = ref(item.speed_cmd);
        const fault = item.fault ? ref(item.fault) : undefined;
        if (!runCmd) errors[`${base}.run_cmd`] = "启停命令点不存在";
        else if (runCmd.kind !== "do" || !runCmd.writable) {
          errors[`${base}.run_cmd`] = "启停命令必须是可写的 DO";
        }
        if (!run) errors[`${base}.run`] = "运行反馈点不存在";
        else if (run.kind !== "di") errors[`${base}.run`] = "运行反馈必须是 DI";
        if (!speed) errors[`${base}.speed_cmd`] = "转速命令点不存在";
        else if (speed.kind !== "ao" || !speed.writable) {
          errors[`${base}.speed_cmd`] = "转速命令必须是可写的 AO";
        }
        if (item.fault && !fault) errors[`${base}.fault`] = "故障反馈点不存在";
        else if (fault && fault.kind !== "di") {
          errors[`${base}.fault`] = "故障反馈必须是 DI";
        }
        break;
      }
    }
  });

  if (hxCount !== 1) errors["equipment.counts"] = `需要且只能有 1 台板换，当前 ${hxCount} 台`;
  if (valveCount > 1) errors["equipment.counts"] = `最多 1 个比例阀，当前 ${valveCount} 个`;
  if (pumpCount < 1 || pumpCount > 2) {
    errors["equipment.counts"] = `需要 1–2 台泵，当前 ${pumpCount} 台`;
  }

  return errors;
}

function tagByIdLookup(tags: TagConfig[], id: string) {
  return tags.find((tag) => tag.id === id);
}

function checkSegment(
  errors: ConfigErrors,
  base: string,
  item: Extract<Equipment, { segment: string }>,
  segmentIds: Set<string>,
) {
  if (!item.segment) errors[`${base}.segment`] = "需要选择管段";
  else if (!segmentIds.has(item.segment)) errors[`${base}.segment`] = "管段不存在";
}

function checkOrder(errors: ConfigErrors, base: string, order: number) {
  if (!isInteger(order)) errors[`${base}.order`] = "order 必须是整数";
}
