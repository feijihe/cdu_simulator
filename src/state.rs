use std::collections::HashMap;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::tags::{Area, Initial, Kind, PointTable, SignalConfig, SignalKind};

struct Rng {
    state: u64,
}

impl Rng {
    fn new(seed: u64) -> Self {
        Self {
            state: if seed == 0 { 0x9E37_79B9_7F4A_7C15 } else { seed },
        }
    }

    fn next_u64(&mut self) -> u64 {
        let mut x = self.state;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.state = x;
        x.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }

    fn gauss(&mut self) -> f64 {
        let u1 = ((self.next_u64() >> 11) as f64 + 0.5) / (1u64 << 53) as f64;
        let u2 = ((self.next_u64() >> 11) as f64 + 0.5) / (1u64 << 53) as f64;
        (-2.0 * u1.ln()).sqrt() * (std::f64::consts::TAU * u2).cos()
    }
}

#[derive(Debug, Default, Clone, Copy, Serialize)]
pub struct Boundary {
    pub facility_c: Option<f64>,
    pub return_c: Option<f64>,
    pub ua_kw_per_k: Option<f64>,
}

/// 当前仿真值 + Modbus 访问逻辑。
///
/// - `values` / `bits` 与点表下标一一对应，存的是工程值。
/// - Modbus 读写的是原始信号（µA / mV / ADC 码），由点表的 range 与
///   signal.range 做线性换算。
pub struct SimState {
    pub table: PointTable,
    values: Vec<f64>,
    reported: Vec<f64>,
    noise_state: Vec<f64>,
    rng: Rng,
    bits: Vec<bool>,
    index: HashMap<(Area, u16), usize>,
    by_id: HashMap<String, usize>,
    overlay_path: PathBuf,
    pub boundary: Boundary,
    /// 模型当前使用的一次侧进水 / 二次侧回水温度（未叠加传感器噪声）
    pub effective_facility_c: f64,
    pub effective_return_c: f64,
}

#[derive(Debug, Deserialize)]
pub struct TagPatch {
    #[serde(default)]
    pub addr: Option<u16>,
    #[serde(default)]
    pub present: Option<bool>,
    #[serde(default)]
    pub signal: Option<SignalConfig>,
    #[serde(default)]
    pub range: Option<[f64; 2]>,
    #[serde(default)]
    pub unit: Option<String>,
}

#[derive(Serialize)]
pub struct PlaceInfo {
    #[serde(rename = "loop", skip_serializing_if = "Option::is_none")]
    pub loop_side: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch: Option<&'static str>,
    /// place 里配置的管段 id（用于按 topology 渲染）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub segment: Option<String>,
    pub order: i32,
}

#[derive(Serialize)]
pub struct PointSample {
    pub id: String,
    pub desc: String,
    pub kind: &'static str,
    pub unit: String,
    pub v: f64,
    pub raw: u16,
    pub present: bool,
    pub range: [f64; 2],
    pub addr: u16,
    pub signal_kind: &'static str,
    pub signal_range: [f64; 2],
    pub place: Option<PlaceInfo>,
}

#[derive(Serialize)]
pub struct Snapshot {
    pub ts: u64,
    pub points: Vec<PointSample>,
    pub boundary: Boundary,
    pub facility_c: f64,
    pub return_c: f64,
    pub ua_kw_per_k: f64,
}

impl SimState {
    pub fn new(table: PointTable, overlay_path: PathBuf) -> Self {
        let mut values = vec![0.0; table.tags.len()];
        let mut bits = vec![false; table.tags.len()];
        let mut index = HashMap::new();
        let mut by_id = HashMap::new();

        for (i, tag) in table.tags.iter().enumerate() {
            by_id.insert(tag.id.clone(), i);
            if !tag.writable {
                if let Some([lo, hi]) = tag.range {
                    values[i] = (lo + hi) / 2.0;
                }
            }
            match (tag.kind, tag.initial) {
                (Kind::Ao, Some(Initial::Number(value))) => {
                    let [lo, hi] = tag.range.unwrap_or([0.0, 100.0]);
                    values[i] = value.clamp(lo, hi);
                }
                (Kind::Do, Some(Initial::Bool(on))) => bits[i] = on,
                _ => {}
            }
            index.insert((tag.area(), tag.modbus.addr), i);
        }

        let reported = values.clone();
        let noise_state = vec![0.0; values.len()];
        let rng = Rng::new(table.noise.seed);

        Self {
            table,
            values,
            reported,
            noise_state,
            rng,
            bits,
            index,
            by_id,
            overlay_path,
            boundary: Boundary::default(),
            effective_facility_c: 30.0,
            effective_return_c: 32.0,
        }
    }

    /// 手动设定边界温度（一次侧进水 / 二次侧回水）与板换 UA。
    pub fn set_boundary(
        &mut self,
        facility_c: Option<f64>,
        return_c: Option<f64>,
        ua_kw_per_k: Option<f64>,
    ) {
        if let Some(value) = facility_c {
            self.boundary.facility_c = Some(value.clamp(0.0, 80.0));
        }
        if let Some(value) = return_c {
            self.boundary.return_c = Some(value.clamp(0.0, 80.0));
        }
        if let Some(value) = ua_kw_per_k {
            self.boundary.ua_kw_per_k = Some(value.clamp(0.1, 500.0));
        }
    }

    pub fn clear_boundary(&mut self) {
        self.boundary = Boundary::default();
    }

    /// Web 配置页提交：校验、写入 overrides.yaml，再替换运行中的点表。
    pub fn apply_config(&mut self, mut table: PointTable) -> Result<(), String> {
        // 配置页只编辑 topology / tags，其余段沿用当前运行配置
        table.meta = self.table.meta.clone();
        table.plant = self.table.plant;
        table.signal = self.table.signal;
        table.noise = self.table.noise;

        let old_tags: HashMap<String, (String, Kind)> = self
            .table
            .tags
            .iter()
            .map(|tag| (tag.id.clone(), (tag.base_unit.clone(), tag.kind)))
            .collect();

        for tag in &mut table.tags {
            // 已有位号且类型不变时保留模型内部单位；新增或改类型的点用当前单位
            tag.base_unit = old_tags
                .get(&tag.id)
                .filter(|(_, kind)| *kind == tag.kind)
                .map(|(unit, _)| unit.clone())
                .unwrap_or_else(|| tag.unit.clone().unwrap_or_default());
        }
        if let Some(topology) = table.topology.as_mut() {
            topology.fill_defaults();
        }
        table.validate().map_err(|err| format!("{err:#}"))?;

        crate::tags::write_overlay(&self.overlay_path, &table)
            .map_err(|err| format!("保存配置失败: {err:#}"))?;
        self.replace_table(table);
        Ok(())
    }

    /// 用新点表替换运行状态；同 id 且同类型的点保留当前值。
    pub fn replace_table(&mut self, table: PointTable) {
        let old_kinds: HashMap<String, Kind> = self
            .table
            .tags
            .iter()
            .map(|tag| (tag.id.clone(), tag.kind))
            .collect();
        let old_by_id = std::mem::take(&mut self.by_id);
        let old_values = std::mem::take(&mut self.values);
        let old_bits = std::mem::take(&mut self.bits);

        let mut values = vec![0.0; table.tags.len()];
        let mut bits = vec![false; table.tags.len()];
        let mut by_id = HashMap::new();

        for (i, tag) in table.tags.iter().enumerate() {
            by_id.insert(tag.id.clone(), i);

            if let Some(&old) = old_by_id.get(&tag.id) {
                if old_kinds.get(&tag.id) == Some(&tag.kind) {
                    values[i] = old_values[old];
                    bits[i] = old_bits[old];
                    continue;
                }
            }

            match (tag.kind, tag.initial) {
                (Kind::Ao, Some(Initial::Number(value))) => {
                    let [lo, hi] = tag.range.unwrap_or([0.0, 100.0]);
                    values[i] = value.clamp(lo, hi);
                }
                (Kind::Do, Some(Initial::Bool(on))) => bits[i] = on,
                _ => {
                    if !tag.writable {
                        if let Some([lo, hi]) = tag.range {
                            values[i] = (lo + hi) / 2.0;
                        }
                    }
                }
            }
        }

        self.table = table;
        self.by_id = by_id;
        self.values = values;
        self.bits = bits;
        self.reported = self.values.clone();
        self.noise_state = vec![0.0; self.values.len()];
        self.rebuild_index();
    }

    pub fn save_overlay(&self) -> Result<(), String> {
        crate::tags::write_overlay(&self.overlay_path, &self.table)
            .map_err(|err| format!("保存配置失败: {err:#}"))
    }

    /// 在每个仿真步之后刷新「传感器读数」：真实值是 values，读数带噪声。
    pub fn update_sensors(&mut self, dt: f64) {
        let cfg = self.table.noise;
        if !cfg.enabled {
            self.reported.copy_from_slice(&self.values);
            return;
        }

        let rho = (-dt / cfg.tau_s.max(0.01)).exp();
        let scale = (1.0 - rho * rho).max(0.0).sqrt();

        for i in 0..self.table.tags.len() {
            let tag = &self.table.tags[i];
            if tag.kind != Kind::Ai || !tag.present {
                self.reported[i] = self.values[i];
                continue;
            }
            let [lo, hi] = tag.range.unwrap_or([0.0, 1.0]);
            // 真值为 0 时不给噪声：停泵后流量、关阀后开度等应稳定读 0
            if self.values[i].abs() < 1e-9 {
                self.noise_state[i] = 0.0;
                self.reported[i] = 0.0;
                continue;
            }
            let sigma = tag
                .noise_sigma
                .unwrap_or((hi - lo) * cfg.sigma_pct / 100.0);
            let sample = rho * self.noise_state[i] + sigma * scale * self.rng.gauss();
            self.noise_state[i] = sample;
            self.reported[i] = (self.values[i] + sample).clamp(lo, hi);
        }
    }

    pub fn value(&self, id: &str) -> f64 {
        self.by_id
            .get(id)
            .map(|&idx| self.values[idx])
            .unwrap_or(0.0)
    }

    pub fn bit(&self, id: &str) -> bool {
        self.by_id
            .get(id)
            .map(|&idx| self.bits[idx])
            .unwrap_or(false)
    }

    pub fn set_value(&mut self, id: &str, value: f64) {
        if let Some(&idx) = self.by_id.get(id) {
            self.values[idx] = value;
        }
    }

    pub fn set_bit(&mut self, id: &str, value: bool) {
        if let Some(&idx) = self.by_id.get(id) {
            self.bits[idx] = value;
        }
    }

    /// 选装点缺失时按 0 输出，与控制程序约定「0 表示未安装」。
    pub fn apply_absent(&mut self) {
        for (i, tag) in self.table.tags.iter().enumerate() {
            if !tag.present {
                self.values[i] = 0.0;
                self.bits[i] = false;
            }
        }
    }

    /// 手动写模拟量命令（阀门开度、泵转速），按点的工程量程校验并转成内部单位。
    pub fn set_command_value(&mut self, id: &str, value: f64) -> Result<(), String> {
        let idx = *self.by_id.get(id).ok_or_else(|| format!("未知点位 {id}"))?;
        let tag = &self.table.tags[idx];
        if !tag.writable || !tag.kind.is_analog() {
            return Err(format!("{id} 不是可写的模拟量点"));
        }
        if !value.is_finite() {
            return Err("数值无效".to_string());
        }
        let [lo, hi] = tag.range.unwrap_or([0.0, 100.0]);
        let display = value.clamp(lo, hi);
        let base = tag.from_display(display);
        self.values[idx] = base;
        self.reported[idx] = base;
        Ok(())
    }

    /// 手动写开关量命令（泵启停）。
    pub fn set_command_bit(&mut self, id: &str, on: bool) -> Result<(), String> {
        let idx = *self.by_id.get(id).ok_or_else(|| format!("未知点位 {id}"))?;
        let tag = &self.table.tags[idx];
        if !tag.writable || tag.kind.is_analog() {
            return Err(format!("{id} 不是可写的开关量点"));
        }
        self.bits[idx] = on;
        Ok(())
    }

    /// 修改点位地址 / 信号制式 / 在位状态，校验后持久化到 overrides.yaml。
    pub fn patch_tag(&mut self, id: &str, patch: TagPatch) -> Result<(), String> {
        let idx = *self.by_id.get(id).ok_or_else(|| format!("未知点位 {id}"))?;

        if let Some([lo, hi]) = patch.range {
            if lo >= hi {
                return Err(format!("工程量程需要 max > min（收到 {lo}..{hi}）"));
            }
        }
        if let Some(unit) = &patch.unit {
            if unit.trim().is_empty() {
                return Err("工程单位不能为空".to_string());
            }
        }

        let old = self.table.tags[idx].clone();

        {
            let tag = &mut self.table.tags[idx];
            if let Some(addr) = patch.addr {
                tag.modbus.addr = addr;
            }
            if let Some(present) = patch.present {
                tag.present = present;
            }
            if let Some(range) = patch.range {
                tag.range = Some(range);
            }
            if let Some(unit) = &patch.unit {
                tag.unit = Some(unit.trim().to_string());
            }
            if let Some(sig) = patch.signal {
                if !tag.kind.is_analog() {
                    self.table.tags[idx] = old;
                    return Err(format!("{id} 是开关量，不能设置信号量程"));
                }
                tag.signal = Some(sig);
            }
        }

        if let Err(err) = self.table.validate() {
            self.table.tags[idx] = old;
            return Err(err.to_string());
        }

        self.rebuild_index();
        self.save_overlay()
            .map_err(|err| format!("已应用但保存失败: {err}"))?;

        Ok(())
    }

    fn rebuild_index(&mut self) {
        self.index.clear();
        for (i, tag) in self.table.tags.iter().enumerate() {
            self.index.insert((tag.area(), tag.modbus.addr), i);
        }
    }

    pub fn raw_of(&self, idx: usize) -> u16 {
        let tag = &self.table.tags[idx];
        if !tag.present {
            return 0;
        }
        if tag.kind.is_analog() {
            tag.to_raw(&self.table, self.reported[idx])
        } else {
            self.bits[idx] as u16
        }
    }

    pub fn snapshot(&self) -> Snapshot {
        let points = self
            .table
            .tags
            .iter()
            .enumerate()
            .map(|(i, tag)| {
                let sig = tag.effective_signal(&self.table);
                let kind = match sig.kind {
                    SignalKind::Current => "current",
                    SignalKind::Voltage => "voltage",
                    SignalKind::Adc => "adc",
                    SignalKind::Rtd => "rtd",
                };
                PointSample {
                    id: tag.id.clone(),
                    desc: tag.desc.clone(),
                    kind: tag.kind.label(),
                    unit: tag.unit.clone().unwrap_or_default(),
                    v: if tag.present {
                        if tag.kind.is_analog() {
                            tag.to_display(self.reported[i])
                        } else {
                            self.bits[i] as u8 as f64
                        }
                    } else {
                        0.0
                    },
                    raw: self.raw_of(i),
                    present: tag.present,
                    range: tag.range.unwrap_or([0.0, 0.0]),
                    addr: tag.modbus.addr,
                    signal_kind: kind,
                    signal_range: sig.range,
                    place: tag.place.as_ref().map(|p| {
                        // segment 只写了管段时，从拓扑补出 loop/branch，前端按管段渲染前仍可用旧字段
                        let segment = p.segment.as_deref().and_then(|id| {
                            self.table
                                .topology
                                .as_ref()
                                .and_then(|topo| topo.segment(id))
                        });
                        PlaceInfo {
                            loop_side: p.loop_label().or_else(|| segment.map(|s| s.loop_label())),
                            branch: p
                                .branch_label()
                                .or_else(|| segment.map(|s| s.branch_label())),
                            segment: p.segment.clone(),
                            order: p.order,
                        }
                    }),
                }
            })
            .collect();

        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        Snapshot {
            ts,
            points,
            boundary: self.boundary,
            facility_c: self.effective_facility_c,
            return_c: self.effective_return_c,
            ua_kw_per_k: self
                .boundary
                .ua_kw_per_k
                .unwrap_or(self.table.plant.ua_kw_per_k),
        }
    }

    pub fn read_regs(&self, area: Area, start: u16, qty: u16) -> Result<Vec<u16>, u8> {
        if qty == 0 || qty > 125 {
            return Err(0x03);
        }
        if start as u32 + qty as u32 > 65536 {
            return Err(0x02);
        }

        let mut out = vec![0u16; qty as usize];
        let begin = start as usize;
        for (i, tag) in self.table.tags.iter().enumerate() {
            if tag.area() != area {
                continue;
            }
            let addr = tag.modbus.addr as usize;
            if addr >= begin && addr < begin + qty as usize {
                out[addr - begin] = self.raw_of(i);
            }
        }
        Ok(out)
    }

    pub fn write_regs(&mut self, area: Area, start: u16, words: &[u16]) -> Result<(), u8> {
        if words.is_empty() {
            return Err(0x03);
        }
        if area != Area::Holding {
            return Err(0x02);
        }

        let begin = start as usize;
        for (offset, raw) in words.iter().enumerate() {
            let addr = (begin + offset) as u16;
            let idx = *self.index.get(&(area, addr)).ok_or(0x02u8)?;
            let tag = &self.table.tags[idx];
            if !tag.writable {
                return Err(0x02);
            }
            self.values[idx] = tag.from_raw(&self.table, *raw);
            self.reported[idx] = self.values[idx];
        }
        Ok(())
    }

    pub fn read_bits(&self, area: Area, start: u16, qty: u16) -> Result<Vec<bool>, u8> {
        if qty == 0 || qty > 2000 {
            return Err(0x03);
        }
        if start as u32 + qty as u32 > 65536 {
            return Err(0x02);
        }

        let mut out = vec![false; qty as usize];
        let begin = start as usize;
        for (i, tag) in self.table.tags.iter().enumerate() {
            if tag.area() != area {
                continue;
            }
            let addr = tag.modbus.addr as usize;
            if addr >= begin && addr < begin + qty as usize {
                out[addr - begin] = self.bits[i];
            }
        }
        Ok(out)
    }

    pub fn write_bits(&mut self, area: Area, start: u16, values: &[bool]) -> Result<(), u8> {
        let begin = start as usize;
        for (offset, value) in values.iter().enumerate() {
            let addr = (begin + offset) as u16;
            let idx = *self.index.get(&(area, addr)).ok_or(0x02u8)?;
            if !self.table.tags[idx].writable {
                return Err(0x02);
            }
            self.bits[idx] = *value;
        }
        Ok(())
    }
}
