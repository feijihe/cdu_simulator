use std::collections::HashMap;
use std::path::Path;

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
pub struct PointTable {
    pub meta: Meta,
    /// 设备拓扑；省略时只能用 place.loop / place.branch 描述传感器位置
    #[serde(default)]
    pub topology: Option<Topology>,
    #[serde(default)]
    pub plant: PlantConfig,
    #[serde(default)]
    pub signal: SignalConfig,
    #[serde(default)]
    pub noise: NoiseConfig,
    pub tags: Vec<Tag>,
}

#[derive(Debug, Deserialize)]
pub struct Meta {
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub notes: Vec<String>,
}

#[derive(Debug, Deserialize, Clone, Copy)]
pub struct PlantConfig {
    #[serde(default = "default_load")]
    pub load_kw: f64,
    #[serde(default = "default_ua")]
    pub ua_kw_per_k: f64,
    #[serde(default = "default_capacity")]
    pub loop_capacity_kj_per_k: f64,
    #[serde(default = "default_facility")]
    pub facility_supply_c: f64,
    /// 比例阀 0→100% 行程时间，秒
    #[serde(default = "default_valve_stroke")]
    pub valve_stroke_s: f64,
}

impl Default for PlantConfig {
    fn default() -> Self {
        Self {
            load_kw: default_load(),
            ua_kw_per_k: default_ua(),
            loop_capacity_kj_per_k: default_capacity(),
            facility_supply_c: default_facility(),
            valve_stroke_s: default_valve_stroke(),
        }
    }
}

/// 传感器噪声。幅值按工程量程的百分比给，带一阶相关性（更像真实变送器而不是纯白噪声）。
#[derive(Debug, Deserialize, Clone, Copy)]
pub struct NoiseConfig {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default = "default_noise_seed")]
    pub seed: u64,
    #[serde(default = "default_sigma_pct")]
    pub sigma_pct: f64,
    #[serde(default = "default_tau")]
    pub tau_s: f64,
}

impl Default for NoiseConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            seed: default_noise_seed(),
            sigma_pct: default_sigma_pct(),
            tau_s: default_tau(),
        }
    }
}

fn default_noise_seed() -> u64 {
    0x9E37_79B9_7F4A_7C15
}
fn default_sigma_pct() -> f64 {
    0.05
}
fn default_tau() -> f64 {
    2.0
}

/// 原始信号量程。寄存器里放的是信号值，不是工程值。
#[derive(Debug, Deserialize, Serialize, Clone, Copy, PartialEq)]
pub struct SignalConfig {
    #[serde(default)]
    pub kind: SignalKind,
    #[serde(default = "default_signal_range")]
    pub range: [f64; 2],
}

impl Default for SignalConfig {
    fn default() -> Self {
        Self {
            kind: SignalKind::Current,
            range: default_signal_range(),
        }
    }
}

#[derive(Debug, Deserialize, Serialize, Clone, Copy, Default, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SignalKind {
    /// 电流，默认 µA
    #[default]
    Current,
    /// 电压，默认 mV
    Voltage,
    /// ADC 码
    Adc,
    /// 数字温度（PT100 等），默认 0.1 °C/LSB
    Rtd,
}

impl SignalKind {
    pub fn label(self) -> &'static str {
        match self {
            SignalKind::Current => "mA",
            SignalKind::Voltage => "V",
            SignalKind::Adc => "ADC",
            SignalKind::Rtd => "RTD",
        }
    }

    pub fn raw_unit(self) -> &'static str {
        match self {
            SignalKind::Current => "uA",
            SignalKind::Voltage => "mV",
            SignalKind::Adc => "count",
            SignalKind::Rtd => "0.1",
        }
    }
}

/// 上电初始值：模拟量用数字，开关量用布尔。
#[derive(Debug, Deserialize, Clone, Copy)]
#[serde(untagged)]
pub enum Initial {
    Number(f64),
    Bool(bool),
}

#[derive(Debug, Deserialize, Clone)]
pub struct Tag {
    pub id: String,
    pub desc: String,
    pub kind: Kind,
    #[serde(default)]
    pub unit: Option<String>,
    #[serde(default)]
    pub range: Option<[f64; 2]>,
    #[serde(default)]
    pub presence: Presence,
    #[serde(default = "default_true")]
    pub present: bool,
    pub modbus: Modbus,
    /// 单点信号量程，覆盖表级默认值
    #[serde(default)]
    pub signal: Option<SignalConfig>,
    /// 系统图位置；没有 place 的点只出现在点位表里
    #[serde(default)]
    pub place: Option<Place>,
    /// 单点噪声幅值（工程量单位），覆盖 noise.sigma_pct
    #[serde(default)]
    pub noise_sigma: Option<f64>,
    /// 上电初始命令值（仅对 AO/DO 生效）
    #[serde(default)]
    pub initial: Option<Initial>,
    #[serde(default)]
    pub writable: bool,
    /// tags.yaml 中的原始单位，用于单位换算；不参与序列化
    #[serde(skip)]
    pub base_unit: String,
}

#[derive(Debug, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Ai,
    Ao,
    Di,
    Do,
}

impl Kind {
    pub fn label(self) -> &'static str {
        match self {
            Kind::Ai => "AI",
            Kind::Ao => "AO",
            Kind::Di => "DI",
            Kind::Do => "DO",
        }
    }

    pub fn is_analog(self) -> bool {
        matches!(self, Kind::Ai | Kind::Ao)
    }
}

#[derive(Debug, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Presence {
    Always,
    Optional,
    Absent,
}

impl Default for Presence {
    fn default() -> Self {
        Presence::Always
    }
}

/// 传感器在系统图上的归属：一次侧 / 二次侧，板换前 / 板换后。
#[derive(Debug, Deserialize, Serialize, Clone, Copy, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum LoopSide {
    Primary,
    Secondary,
}

impl LoopSide {
    pub fn label(self) -> &'static str {
        match self {
            LoopSide::Primary => "primary",
            LoopSide::Secondary => "secondary",
        }
    }
}

#[derive(Debug, Deserialize, Serialize, Clone, Copy, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum Branch {
    PreHx,
    PostHx,
}

impl Branch {
    pub fn label(self) -> &'static str {
        match self {
            Branch::PreHx => "pre_hx",
            Branch::PostHx => "post_hx",
        }
    }
}

/// 传感器位置。推荐用 `segment` 引用 `topology.segments` 的 id；
/// 没有 topology 的旧点表可以继续用 `loop` + `branch`。
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct Place {
    #[serde(rename = "loop", default, skip_serializing_if = "Option::is_none")]
    pub loop_side: Option<LoopSide>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub branch: Option<Branch>,
    /// 管段 id
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub segment: Option<String>,
    /// 同一管段内的顺序，沿流向递增
    #[serde(default)]
    pub order: i32,
}

impl Place {
    pub fn loop_label(&self) -> Option<&'static str> {
        self.loop_side.map(LoopSide::label)
    }

    pub fn branch_label(&self) -> Option<&'static str> {
        self.branch.map(Branch::label)
    }
}

/// 系统图的设备拓扑。管段描述「有哪些管路、属于哪个回路、流向哪边」，
/// 设备描述「装在哪个管段的什么位置、对应哪些点位」。
///
/// 传感器仍然放在 `tags[].place`，通过 `segment` 挂到管段上；
/// 设备与传感器的 `order` 共用一条坐标轴，渲染时按 order 沿流向排布。
#[derive(Debug, Deserialize, Serialize, Clone, Default)]
pub struct Topology {
    #[serde(default)]
    pub segments: Vec<Segment>,
    #[serde(default)]
    pub equipment: Vec<Equipment>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct Segment {
    pub id: String,
    #[serde(default)]
    pub label: String,
    #[serde(rename = "loop")]
    pub loop_side: LoopSide,
    pub branch: Branch,
    /// 图上流向；省略时按「一次侧进 / 二次侧出朝板换」推导
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub direction: Option<Direction>,
    /// 该管段的流量测点；同一回路的其他管段会复用它做流动动画
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub flow: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Direction {
    Forward,
    Reverse,
}

impl Direction {
    pub fn label(self) -> &'static str {
        match self {
            Direction::Forward => "forward",
            Direction::Reverse => "reverse",
        }
    }

    /// 默认流向：一次侧进水与二次侧供液朝板换，另两条离开板换。
    fn default_for(loop_side: LoopSide, branch: Branch) -> Self {
        match (loop_side, branch) {
            (LoopSide::Primary, Branch::PreHx) | (LoopSide::Secondary, Branch::PostHx) => {
                Direction::Forward
            }
            _ => Direction::Reverse,
        }
    }
}

impl Segment {
    pub fn loop_label(&self) -> &'static str {
        self.loop_side.label()
    }

    pub fn branch_label(&self) -> &'static str {
        self.branch.label()
    }

    /// 配置值，缺省按回路与板换前后推导。
    pub fn direction(&self) -> Direction {
        self.direction
            .unwrap_or_else(|| Direction::default_for(self.loop_side, self.branch))
    }
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Equipment {
    HeatExchanger(HeatExchanger),
    Valve(Valve),
    Pump(Pump),
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct HeatExchanger {
    pub id: String,
    #[serde(default)]
    pub label: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct Valve {
    pub id: String,
    #[serde(default)]
    pub label: String,
    /// 安装管段
    pub segment: String,
    /// 管段内位置
    #[serde(default)]
    pub order: i32,
    /// 开度指令（AO）
    pub cmd: String,
    /// 开度反馈（AI）
    pub pos: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct Pump {
    pub id: String,
    #[serde(default)]
    pub label: String,
    /// 安装管段
    pub segment: String,
    /// 管段内位置；同 order 的泵按并联画
    #[serde(default)]
    pub order: i32,
    /// 启停命令（DO）
    pub run_cmd: String,
    /// 运行反馈（DI）
    pub run: String,
    /// 转速指令（AO）
    pub speed_cmd: String,
    /// 故障反馈（DI，选装）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fault: Option<String>,
}

impl Equipment {
    pub fn id(&self) -> &str {
        match self {
            Equipment::HeatExchanger(e) => &e.id,
            Equipment::Valve(e) => &e.id,
            Equipment::Pump(e) => &e.id,
        }
    }

    pub fn label(&self) -> &str {
        match self {
            Equipment::HeatExchanger(e) => &e.label,
            Equipment::Valve(e) => &e.label,
            Equipment::Pump(e) => &e.label,
        }
    }

    pub fn label_mut(&mut self) -> &mut String {
        match self {
            Equipment::HeatExchanger(e) => &mut e.label,
            Equipment::Valve(e) => &mut e.label,
            Equipment::Pump(e) => &mut e.label,
        }
    }

    pub fn kind_label(&self) -> &'static str {
        match self {
            Equipment::HeatExchanger(_) => "heat_exchanger",
            Equipment::Valve(_) => "valve",
            Equipment::Pump(_) => "pump",
        }
    }

    pub fn segment(&self) -> Option<&str> {
        match self {
            Equipment::HeatExchanger(_) => None,
            Equipment::Valve(e) => Some(&e.segment),
            Equipment::Pump(e) => Some(&e.segment),
        }
    }

    pub fn order(&self) -> Option<i32> {
        match self {
            Equipment::HeatExchanger(_) => None,
            Equipment::Valve(e) => Some(e.order),
            Equipment::Pump(e) => Some(e.order),
        }
    }

    /// 设备引用的点位，用于校验与打印。
    pub fn tag_refs(&self) -> Vec<(&'static str, &str)> {
        match self {
            Equipment::HeatExchanger(_) => Vec::new(),
            Equipment::Valve(e) => vec![("cmd", &e.cmd), ("pos", &e.pos)],
            Equipment::Pump(e) => {
                let mut refs = vec![
                    ("run_cmd", e.run_cmd.as_str()),
                    ("run", e.run.as_str()),
                    ("speed_cmd", e.speed_cmd.as_str()),
                ];
                if let Some(fault) = &e.fault {
                    refs.push(("fault", fault.as_str()));
                }
                refs
            }
        }
    }
}

impl Topology {
    pub fn segment(&self, id: &str) -> Option<&Segment> {
        self.segments.iter().find(|s| s.id == id)
    }

    /// 补全可省略字段，保证序列化给前端的拓扑是完整的。
    pub fn fill_defaults(&mut self) {
        for seg in &mut self.segments {
            if seg.label.is_empty() {
                seg.label = seg.id.clone();
            }
            if seg.direction.is_none() {
                seg.direction = Some(seg.direction());
            }
        }
        for eq in &mut self.equipment {
            if eq.label().is_empty() {
                let id = eq.id().to_string();
                *eq.label_mut() = id;
            }
        }
    }

    /// `--dump-points` 时打印拓扑摘要。
    pub fn print_summary(&self) {
        let count = |kind: &str| {
            self.equipment
                .iter()
                .filter(|e| e.kind_label() == kind)
                .count()
        };
        println!(
            "拓扑: {} 条管段, {} 台设备 (板换 {}, 比例阀 {}, 泵 {})",
            self.segments.len(),
            self.equipment.len(),
            count("heat_exchanger"),
            count("valve"),
            count("pump")
        );
        println!(
            "{:<10} {:<10} {:<10} {:<8} LABEL",
            "SEG", "LOOP", "BRANCH", "DIR"
        );
        for seg in &self.segments {
            println!(
                "{:<10} {:<10} {:<10} {:<8} {}",
                seg.id,
                seg.loop_label(),
                seg.branch_label(),
                seg.direction().label(),
                seg.label
            );
        }
        println!();
        println!("{:<6} {:<16} {:<12} TAGS", "ID", "TYPE", "SEGMENT");
        for eq in &self.equipment {
            let location = match (eq.segment(), eq.order()) {
                (Some(seg), Some(order)) => format!("{seg}#{order}"),
                _ => "-".to_string(),
            };
            let mut tags = eq
                .tag_refs()
                .iter()
                .map(|(role, id)| format!("{role}={id}"))
                .collect::<Vec<_>>()
                .join(" ");
            if tags.is_empty() {
                tags = "-".to_string();
            }
            println!(
                "{:<6} {:<16} {:<12} {}",
                eq.id(),
                eq.kind_label(),
                location,
                tags
            );
        }
    }
}

#[derive(Debug, Deserialize, Clone)]
pub struct Modbus {
    pub fc: u8,
    pub addr: u16,
}

fn default_true() -> bool {
    true
}

fn default_load() -> f64 {
    30.0
}
fn default_ua() -> f64 {
    8.0
}
fn default_capacity() -> f64 {
    400.0
}
fn default_facility() -> f64 {
    30.0
}
fn default_valve_stroke() -> f64 {
    90.0
}
fn default_signal_range() -> [f64; 2] {
    [4000.0, 20000.0]
}

/// Modbus 数据区。地址空间按区隔离，线圈与保持寄存器可以同号。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Area {
    Coil,
    Discrete,
    Holding,
    Input,
}

impl Area {
    pub fn from_fc(fc: u8) -> Result<Self> {
        Ok(match fc {
            1 | 5 | 15 => Area::Coil,
            2 => Area::Discrete,
            3 | 6 | 16 => Area::Holding,
            4 => Area::Input,
            other => bail!("不支持的 Modbus 功能码: {other}"),
        })
    }
}

impl Tag {
    pub fn area(&self) -> Area {
        match self.kind {
            Kind::Ai | Kind::Ao => Area::Holding,
            Kind::Di | Kind::Do => Area::Coil,
        }
    }

    pub fn effective_signal(&self, table: &PointTable) -> SignalConfig {
        self.signal.unwrap_or(table.signal)
    }

    /// 模型内部单位 -> 当前配置单位
    pub fn to_display(&self, value: f64) -> f64 {
        match self.unit.as_deref() {
            Some(unit) if !unit.is_empty() => convert_unit(value, &self.base_unit, unit),
            _ => value,
        }
    }

    /// 当前配置单位 -> 模型内部单位
    pub fn from_display(&self, value: f64) -> f64 {
        match self.unit.as_deref() {
            Some(unit) if !unit.is_empty() => convert_unit(value, unit, &self.base_unit),
            _ => value,
        }
    }

    pub fn to_raw(&self, table: &PointTable, value: f64) -> u16 {
        let sig = self.effective_signal(table);
        let [lo, hi] = self.range.unwrap_or([0.0, 100.0]);
        let display = self.to_display(value);
        let frac = ((display - lo) / (hi - lo)).clamp(0.0, 1.0);
        (sig.range[0] + frac * (sig.range[1] - sig.range[0]))
            .round()
            .clamp(0.0, 65535.0) as u16
    }

    pub fn from_raw(&self, table: &PointTable, raw: u16) -> f64 {
        let sig = self.effective_signal(table);
        let [lo, hi] = self.range.unwrap_or([0.0, 100.0]);
        let span = sig.range[1] - sig.range[0];
        if span.abs() < f64::EPSILON {
            return self.from_display(lo);
        }
        let frac = (raw as f64 - sig.range[0]) / span;
        let display = lo + frac * (hi - lo);
        self.from_display(display.clamp(lo, hi))
    }
}

fn canonical(value: f64, unit: &str) -> Option<(f64, &'static str)> {
    let u = unit.trim().to_lowercase();
    Some(match u.as_str() {
        "bar" => (value, "pressure"),
        "kpa" => (value * 0.01, "pressure"),
        "mpa" => (value * 10.0, "pressure"),
        "psi" => (value * 0.068_947_572_9, "pressure"),
        "c" | "°c" | "degc" => (value, "temperature"),
        "f" | "°f" | "degf" => ((value - 32.0) / 1.8, "temperature"),
        "k" => (value - 273.15, "temperature"),
        "m3/h" | "m³/h" => (value, "flow"),
        "l/min" => (value * 0.06, "flow"),
        "l/s" => (value * 3.6, "flow"),
        "gpm" => (value * 0.227_124_7, "flow"),
        _ => return None,
    })
}

fn from_canonical(value: f64, family: &str, unit: &str) -> Option<f64> {
    let u = unit.trim().to_lowercase();
    Some(match (family, u.as_str()) {
        ("pressure", "bar") => value,
        ("pressure", "kpa") => value / 0.01,
        ("pressure", "mpa") => value / 10.0,
        ("pressure", "psi") => value / 0.068_947_572_9,
        ("temperature", "c") | ("temperature", "°c") | ("temperature", "degc") => value,
        ("temperature", "f") | ("temperature", "°f") | ("temperature", "degf") => {
            value * 1.8 + 32.0
        }
        ("temperature", "k") => value + 273.15,
        ("flow", "m3/h") | ("flow", "m³/h") => value,
        ("flow", "l/min") => value / 0.06,
        ("flow", "l/s") => value / 3.6,
        ("flow", "gpm") => value / 0.227_124_7,
        _ => return None,
    })
}

/// 支持压力（bar/kPa/MPa/psi）、温度（°C/°F/K）、流量（m³/h、L/min、L/s、GPM）互换；
/// 未知单位或不同量纲时原样返回。
pub fn convert_unit(value: f64, from: &str, to: &str) -> f64 {
    if from.trim().to_lowercase() == to.trim().to_lowercase() {
        return value;
    }
    let Some((base, family)) = canonical(value, from) else {
        return value;
    };
    from_canonical(base, family, to).unwrap_or(value)
}

/// 运行时覆盖，持久化到 config/overrides.yaml。
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct TagOverride {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub addr: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub signal: Option<SignalConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub range: Option<[f64; 2]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unit: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub present: Option<bool>,
}

pub fn overrides_path(config: &Path) -> std::path::PathBuf {
    config.with_file_name("overrides.yaml")
}

pub fn read_overrides(path: &Path) -> Result<Vec<TagOverride>> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let text = std::fs::read_to_string(path)
        .with_context(|| format!("读取 {} 失败", path.display()))?;
    if text.trim().is_empty() {
        return Ok(Vec::new());
    }
    serde_yaml::from_str(&text).with_context(|| format!("解析 {} 失败", path.display()))
}

pub fn write_overrides(path: &Path, list: &[TagOverride]) -> Result<()> {
    let text = serde_yaml::to_string(list)?;
    std::fs::write(path, text).with_context(|| format!("写入 {} 失败", path.display()))
}

impl PointTable {
    pub fn apply_override(&mut self, ov: &TagOverride) -> Result<()> {
        let tag = self
            .tags
            .iter_mut()
            .find(|t| t.id == ov.id)
            .with_context(|| format!("overrides.yaml 中未知点位 {}", ov.id))?;
        if let Some(addr) = ov.addr {
            tag.modbus.addr = addr;
        }
        if let Some(present) = ov.present {
            tag.present = present;
        }
        if let Some(sig) = ov.signal {
            if !tag.kind.is_analog() {
                bail!("点位 {} 是开关量，不能设置信号量程", ov.id);
            }
            tag.signal = Some(sig);
        }
        if let Some(range) = ov.range {
            tag.range = Some(range);
        }
        if let Some(unit) = &ov.unit {
            tag.unit = Some(unit.clone());
        }
        Ok(())
    }
}

impl PointTable {
    /// 从 YAML 文本解析并校验点表。`base_unit` 在这里固化，后续改单位不影响模型含义。
    pub fn parse(text: &str) -> Result<Self> {
        let mut table: PointTable = serde_yaml::from_str(text).context("解析点表失败")?;
        for tag in &mut table.tags {
            tag.base_unit = tag.unit.clone().unwrap_or_default();
        }
        if let Some(topology) = table.topology.as_mut() {
            topology.fill_defaults();
        }
        table.validate()?;
        Ok(table)
    }

    /// 只读 tags.yaml，不叠加 overrides.yaml。
    pub fn load_plain(path: &Path) -> Result<Self> {
        let text = std::fs::read_to_string(path)
            .with_context(|| format!("读取 {} 失败", path.display()))?;
        Self::parse(&text).with_context(|| format!("解析 {} 失败", path.display()))
    }

    pub fn load(path: &Path) -> Result<Self> {
        let mut table = Self::load_plain(path)?;

        let ov_path = overrides_path(path);
        for ov in read_overrides(&ov_path)? {
            table.apply_override(&ov)?;
        }
        table
            .validate()
            .with_context(|| format!("应用 {} 后校验失败", ov_path.display()))?;
        Ok(table)
    }

    pub fn validate(&self) -> Result<()> {
        if self.noise.sigma_pct < 0.0 || self.noise.tau_s <= 0.0 {
            bail!("noise.sigma_pct 不能为负，noise.tau_s 必须大于 0");
        }
        let mut ids: HashMap<&str, ()> = HashMap::new();
        let mut spans: HashMap<(Area, u16), &str> = HashMap::new();

        for tag in &self.tags {
            if let Some(sigma) = tag.noise_sigma {
                if sigma < 0.0 {
                    bail!("点 {} 的噪声幅值不能为负", tag.id);
                }
            }
            if ids.insert(tag.id.as_str(), ()).is_some() {
                bail!("重复的点 id: {}", tag.id);
            }

            if tag.kind.is_analog() {
                match tag.range {
                    Some([lo, hi]) if lo < hi => {}
                    Some([lo, hi]) => bail!("点 {} 的量程无效: {lo}..{hi}", tag.id),
                    None => bail!("模拟量点 {} 缺少 range", tag.id),
                }
            }

            if tag.writable && matches!(tag.kind, Kind::Ai | Kind::Di) {
                bail!("输入点 {} 不能标记 writable", tag.id);
            }

            let area = tag.area();
            if area != Area::from_fc(tag.modbus.fc)? {
                bail!(
                    "点 {} 的 kind ({}) 与 fc ({}) 不匹配",
                    tag.id,
                    tag.kind.label(),
                    tag.modbus.fc
                );
            }

            let sig = tag.effective_signal(self);
            if sig.range[0] >= sig.range[1] {
                bail!("点 {} 的信号量程无效: {:?}", tag.id, sig.range);
            }
            if tag.kind.is_analog() && (sig.range[0] < 0.0 || sig.range[1] > 65535.0) {
                bail!(
                    "点 {} 的信号量程超出 u16 范围: {}..{}",
                    tag.id,
                    sig.range[0],
                    sig.range[1]
                );
            }

            if let Some(prev) = spans.insert((area, tag.modbus.addr), tag.id.as_str()) {
                bail!(
                    "点 {} 与 {} 地址重叠: fc {} addr {}",
                    tag.id,
                    prev,
                    tag.modbus.fc,
                    tag.modbus.addr
                );
            }
        }

        self.validate_topology()?;
        Ok(())
    }

    /// 校验拓扑与点位引用：
    /// - 管段 id 唯一，设备 id 唯一；
    /// - 恰好 1 台板换、最多 1 个比例阀、至少 1 台泵；
    /// - 设备引用的点位存在且方向（AI/AO/DI/DO）、可写性正确；
    /// - 传感器的 place.segment 存在，且 loop/branch 与管段定义一致（如果同时写了）。
    fn validate_topology(&self) -> Result<()> {
        let Some(topo) = &self.topology else {
            for tag in &self.tags {
                if let Some(place) = &tag.place {
                    if place.segment.is_some() {
                        bail!("点 {} 使用了 place.segment，但点表没有 topology 段", tag.id);
                    }
                    if place.loop_side.is_none() || place.branch.is_none() {
                        bail!("点 {} 的 place 需要同时给出 loop 与 branch", tag.id);
                    }
                }
            }
            return Ok(());
        };

        if topo.segments.is_empty() {
            bail!("topology.segments 不能为空");
        }

        let mut segments: HashMap<&str, &Segment> = HashMap::new();
        let mut slots: HashMap<(LoopSide, Branch), &str> = HashMap::new();
        for seg in &topo.segments {
            if seg.id.trim().is_empty() {
                bail!("topology.segments 中存在空 id");
            }
            if segments.insert(seg.id.as_str(), seg).is_some() {
                bail!("重复的管段 id: {}", seg.id);
            }
            if let Some(prev) = slots.insert((seg.loop_side, seg.branch), seg.id.as_str()) {
                bail!(
                    "管段 {} 与 {} 的 loop/branch 重复（每个回路每个板换侧只能有一条管段）",
                    seg.id,
                    prev
                );
            }
            if let Some(flow) = &seg.flow {
                let tag =
                    self.tags.iter().find(|t| t.id == *flow).with_context(|| {
                        format!("管段 {} 的 flow 点 {} 不在点表中", seg.id, flow)
                    })?;
                if tag.kind != Kind::Ai {
                    bail!("管段 {} 的 flow 点 {} 必须是 AI", seg.id, flow);
                }
                let on_segment = tag
                    .place
                    .as_ref()
                    .is_some_and(|place| match &place.segment {
                        Some(id) => id == &seg.id,
                        None => {
                            place.loop_side == Some(seg.loop_side)
                                && place.branch == Some(seg.branch)
                        }
                    });
                if !on_segment {
                    bail!("管段 {} 的 flow 点 {} 不在该管段上", seg.id, flow);
                }
            }
        }

        let mut equipment_ids: HashMap<&str, ()> = HashMap::new();
        let mut hx_count = 0;
        let mut valve_count = 0;
        let mut pump_count = 0;

        for eq in &topo.equipment {
            if eq.id().trim().is_empty() {
                bail!("topology.equipment 中存在空 id");
            }
            if equipment_ids.insert(eq.id(), ()).is_some() {
                bail!("重复的设备 id: {}", eq.id());
            }

            if let Some(segment) = eq.segment() {
                if !segments.contains_key(segment) {
                    bail!("设备 {} 引用了不存在的管段 {}", eq.id(), segment);
                }
            }

            match eq {
                Equipment::HeatExchanger(_) => hx_count += 1,
                Equipment::Valve(v) => {
                    valve_count += 1;
                    self.expect_tag(&v.cmd, "比例阀开度指令", Kind::Ao, true)?;
                    self.expect_tag(&v.pos, "比例阀开度反馈", Kind::Ai, false)?;
                }
                Equipment::Pump(p) => {
                    pump_count += 1;
                    self.expect_tag(&p.run_cmd, "泵启停命令", Kind::Do, true)?;
                    self.expect_tag(&p.run, "泵运行反馈", Kind::Di, false)?;
                    self.expect_tag(&p.speed_cmd, "泵转速指令", Kind::Ao, true)?;
                    if let Some(fault) = &p.fault {
                        self.expect_tag(fault, "泵故障反馈", Kind::Di, false)?;
                    }
                }
            }
        }

        if hx_count != 1 {
            bail!("topology 需要且只能有 1 台 heat_exchanger，当前 {hx_count} 台");
        }
        if valve_count > 1 {
            bail!("当前只支持 1 个比例阀，topology 中有 {valve_count} 个");
        }
        if pump_count == 0 {
            bail!("topology 至少需要 1 台 pump");
        }
        if pump_count > 2 {
            bail!("当前模型最多支持 2 台泵（阶段 3 扩展到 N 台），topology 中有 {pump_count} 台");
        }

        for tag in &self.tags {
            let Some(place) = &tag.place else {
                continue;
            };
            match (&place.segment, place.loop_side, place.branch) {
                (Some(id), loop_side, branch) => {
                    let segment = segments
                        .get(id.as_str())
                        .with_context(|| format!("点 {} 的 place.segment {} 不存在", tag.id, id))?;
                    if let Some(loop_side) = loop_side {
                        if loop_side != segment.loop_side {
                            bail!(
                                "点 {} 的 place.loop ({}) 与管段 {} 的 loop ({}) 不一致",
                                tag.id,
                                loop_side.label(),
                                id,
                                segment.loop_label()
                            );
                        }
                    }
                    if let Some(branch) = branch {
                        if branch != segment.branch {
                            bail!(
                                "点 {} 的 place.branch ({}) 与管段 {} 的 branch ({}) 不一致",
                                tag.id,
                                branch.label(),
                                id,
                                segment.branch_label()
                            );
                        }
                    }
                }
                (None, Some(_), Some(_)) => {}
                (None, _, _) => bail!(
                    "点 {} 的 place 需要 segment，或同时给出 loop 与 branch",
                    tag.id
                ),
            }
        }

        Ok(())
    }

    fn expect_tag(&self, id: &str, role: &str, kind: Kind, writable: bool) -> Result<()> {
        let tag = self
            .tags
            .iter()
            .find(|t| t.id == id)
            .with_context(|| format!("{role}点 {} 不在点表中", id))?;
        if tag.kind != kind {
            bail!(
                "{role}点 {} 应为 {}，实际为 {}",
                id,
                kind.label(),
                tag.kind.label()
            );
        }
        if writable && !tag.writable {
            bail!("{role}点 {} 必须标记 writable: true", id);
        }
        Ok(())
    }

    pub fn print_summary(&self) {
        let optional = self
            .tags
            .iter()
            .filter(|t| t.presence == Presence::Optional)
            .count();
        println!(
            "点表: {} v{}  ({} 点, {} 个选装)",
            self.meta.name,
            self.meta.version,
            self.tags.len(),
            optional
        );
        println!(
            "默认信号: {} {}..{} {}",
            self.signal.kind.label(),
            self.signal.range[0],
            self.signal.range[1],
            self.signal.kind.raw_unit()
        );
        for note in &self.meta.notes {
            println!("  note: {note}");
        }
        println!();
        if let Some(topo) = &self.topology {
            topo.print_summary();
            println!();
        } else {
            println!("拓扑: 未配置（系统图按 place.loop / place.branch 渲染）");
            println!();
        }
        println!(
            "{:<18} {:<4} {:<4} {:<6} {:<6} {:<12} {:<10} {:<18} STATE",
            "ID", "DIR", "FC", "ADDR", "UNIT", "RANGE", "RAW", "PLACE"
        );

        for tag in &self.tags {
            let range = tag
                .range
                .map(|[lo, hi]| format!("{lo}..{hi}"))
                .unwrap_or_default();
            let sig = tag.effective_signal(self);
            let raw = if tag.kind.is_analog() {
                format!("{}..{}", sig.range[0], sig.range[1])
            } else {
                "-".to_string()
            };
            let state = if !tag.present {
                "缺失"
            } else if tag.presence == Presence::Optional {
                "在位(选装)"
            } else {
                "在位"
            };
            let place = tag
                .place
                .as_ref()
                .map(
                    |p| match (p.segment.as_deref(), p.loop_label(), p.branch_label()) {
                        (Some(seg), _, _) => format!("{seg}#{}", p.order),
                        (None, Some(loop_label), Some(branch_label)) => {
                            format!("{loop_label}/{branch_label}#{}", p.order)
                        }
                        _ => format!("#{}", p.order),
                    },
                )
                .unwrap_or_default();
            println!(
                "{:<18} {:<4} {:<4} {:<6} {:<6} {:<12} {:<10} {:<18} {}",
                tag.id,
                tag.kind.label(),
                tag.modbus.fc,
                tag.modbus.addr,
                tag.unit.clone().unwrap_or_default(),
                range,
                raw,
                place,
                state
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const BASE: &str = r#"
meta: { name: test, version: "0" }
tags:
  - { id: VALVE_CMD, desc: 阀位指令, kind: ao, unit: "%", range: [0, 100], writable: true, modbus: { fc: 3, addr: 200 } }
  - { id: VALVE_POS, desc: 阀位反馈, kind: ai, unit: "%", range: [0, 100], modbus: { fc: 3, addr: 116 } }
  - { id: PUMP_RUN_CMD, desc: 泵启停, kind: do, writable: true, modbus: { fc: 1, addr: 16 } }
  - { id: PUMP_RUN, desc: 泵运行, kind: di, modbus: { fc: 1, addr: 0 } }
  - { id: PUMP_SPEED_CMD, desc: 泵转速, kind: ao, unit: "%", range: [0, 100], writable: true, modbus: { fc: 3, addr: 201 } }
  - { id: T11, desc: 温度, kind: ai, unit: "°C", range: [0, 80], place: { segment: s_in, order: 10 }, modbus: { fc: 3, addr: 101 } }
  - { id: Q2, desc: 流量, kind: ai, unit: "m3/h", range: [0, 10], place: { segment: s_in, order: 12 }, modbus: { fc: 3, addr: 102 } }
topology:
  segments:
    - { id: s_in, loop: secondary, branch: pre_hx, label: 回水, flow: Q2 }
    - { id: s_out, loop: secondary, branch: post_hx }
  equipment:
    - { id: HX1, type: heat_exchanger }
    - { id: V1, type: valve, segment: s_in, order: 5, cmd: VALVE_CMD, pos: VALVE_POS }
    - { id: P1, type: pump, segment: s_out, order: 20, run_cmd: PUMP_RUN_CMD, run: PUMP_RUN, speed_cmd: PUMP_SPEED_CMD }
"#;

    fn error(yaml: &str) -> String {
        PointTable::parse(yaml).unwrap_err().to_string()
    }

    #[test]
    fn parses_topology_and_fills_defaults() {
        let table = PointTable::parse(BASE).unwrap();
        let topo = table.topology.as_ref().unwrap();

        assert_eq!(topo.segments.len(), 2);
        assert_eq!(topo.segments[0].flow.as_deref(), Some("Q2"));
        assert_eq!(topo.segments[0].direction(), Direction::Reverse);
        assert_eq!(topo.segments[1].direction(), Direction::Forward);
        // 省略 label 时回落到 id；方向在解析阶段固化，便于直接序列化
        assert_eq!(topo.segments[1].label, "s_out");
        assert_eq!(topo.segments[0].direction, Some(Direction::Reverse));

        let kinds: Vec<_> = topo.equipment.iter().map(Equipment::kind_label).collect();
        assert_eq!(kinds, ["heat_exchanger", "valve", "pump"]);

        // 内部 tag 枚举序列化成带 type 字段的对象，前端按 type 选图标
        let json = serde_json::to_value(topo).unwrap();
        assert_eq!(json["equipment"][1]["type"], "valve");
        assert_eq!(json["equipment"][2]["speed_cmd"], "PUMP_SPEED_CMD");
    }

    #[test]
    fn sensor_resolves_place_from_segment() {
        let table = PointTable::parse(BASE).unwrap();
        let tag = table.tags.iter().find(|t| t.id == "T11").unwrap();
        let place = tag.place.as_ref().unwrap();
        assert_eq!(place.segment.as_deref(), Some("s_in"));
        assert_eq!(place.loop_label(), None);
        assert_eq!(
            table
                .topology
                .as_ref()
                .unwrap()
                .segment("s_in")
                .map(Segment::branch_label),
            Some("pre_hx")
        );
    }

    #[test]
    fn rejects_duplicate_segment() {
        let yaml = BASE.replace(
            "    - { id: s_out, loop: secondary, branch: post_hx }",
            "    - { id: s_in, loop: secondary, branch: post_hx }",
        );
        assert!(error(&yaml).contains("重复的管段"), "{}", error(&yaml));
    }

    #[test]
    fn rejects_duplicate_loop_branch() {
        let yaml = BASE.replace(
            "    - { id: s_out, loop: secondary, branch: post_hx }",
            "    - { id: s_out, loop: secondary, branch: pre_hx }",
        );
        assert!(
            error(&yaml).contains("loop/branch 重复"),
            "{}",
            error(&yaml)
        );
    }

    #[test]
    fn rejects_flow_point_on_other_segment() {
        let yaml = BASE.replace(
            "place: { segment: s_in, order: 12 }",
            "place: { segment: s_out, order: 12 }",
        );
        assert!(error(&yaml).contains("不在该管段上"), "{}", error(&yaml));
    }

    #[test]
    fn rejects_unknown_tag_in_equipment() {
        let yaml = BASE.replace("cmd: VALVE_CMD", "cmd: MISSING");
        assert!(error(&yaml).contains("不在点表中"), "{}", error(&yaml));
    }

    #[test]
    fn rejects_wrong_tag_direction() {
        let yaml = BASE.replace("speed_cmd: PUMP_SPEED_CMD", "speed_cmd: VALVE_POS");
        assert!(error(&yaml).contains("应为 AO"), "{}", error(&yaml));
    }

    #[test]
    fn rejects_place_contradicting_segment() {
        let yaml = BASE.replace(
            "place: { segment: s_in, order: 10 }",
            "place: { segment: s_in, loop: primary, order: 10 }",
        );
        assert!(error(&yaml).contains("不一致"), "{}", error(&yaml));
    }

    #[test]
    fn bundled_config_is_valid() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("config/tags.yaml");
        let table = PointTable::load_plain(&path).unwrap();
        let topology = table.topology.expect("config/tags.yaml 应带 topology");
        assert_eq!(topology.segments.len(), 4);
        assert_eq!(topology.equipment.len(), 4);
    }

    #[test]
    fn rejects_segment_without_topology() {
        let yaml = r#"
meta: { name: test, version: "0" }
tags:
  - { id: T11, desc: 温度, kind: ai, unit: "°C", range: [0, 80], place: { segment: s_in, order: 1 }, modbus: { fc: 3, addr: 101 } }
"#;
        assert!(error(yaml).contains("没有 topology"), "{}", error(yaml));
    }

    #[test]
    fn rejects_incomplete_place_without_topology() {
        let yaml = r#"
meta: { name: test, version: "0" }
tags:
  - { id: T11, desc: 温度, kind: ai, unit: "°C", range: [0, 80], place: { order: 1 }, modbus: { fc: 3, addr: 101 } }
"#;
        assert!(
            error(yaml).contains("同时给出 loop 与 branch"),
            "{}",
            error(yaml)
        );
    }
}
