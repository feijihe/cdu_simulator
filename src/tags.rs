use std::collections::HashMap;
use std::path::Path;

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
pub struct PointTable {
    pub meta: Meta,
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
#[derive(Debug, Deserialize, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LoopSide {
    Primary,
    Secondary,
}

#[derive(Debug, Deserialize, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Branch {
    PreHx,
    PostHx,
}

#[derive(Debug, Deserialize, Serialize, Clone, Copy)]
pub struct Place {
    #[serde(rename = "loop")]
    pub loop_side: LoopSide,
    pub branch: Branch,
    /// 同一管段内的顺序，沿流向递增
    #[serde(default)]
    pub order: i32,
}

impl Place {
    pub fn loop_label(&self) -> &'static str {
        match self.loop_side {
            LoopSide::Primary => "primary",
            LoopSide::Secondary => "secondary",
        }
    }

    pub fn branch_label(&self) -> &'static str {
        match self.branch {
            Branch::PreHx => "pre_hx",
            Branch::PostHx => "post_hx",
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
    /// 只读 tags.yaml，不叠加 overrides.yaml。
    pub fn load_plain(path: &Path) -> Result<Self> {
        let text = std::fs::read_to_string(path)
            .with_context(|| format!("读取 {} 失败", path.display()))?;
        let mut table: PointTable = serde_yaml::from_str(&text)
            .with_context(|| format!("解析 {} 失败", path.display()))?;
        for tag in &mut table.tags {
            tag.base_unit = tag.unit.clone().unwrap_or_default();
        }
        table.validate()?;
        Ok(table)
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
        println!(
            "{:<18} {:<4} {:<4} {:<6} {:<6} {:<12} {:<10} {:<18} {}",
            "ID", "DIR", "FC", "ADDR", "UNIT", "RANGE", "RAW", "PLACE", "STATE"
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
                .map(|p| format!("{}/{}#{}", p.loop_label(), p.branch_label(), p.order))
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
