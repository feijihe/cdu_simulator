use crate::state::SimState;
use crate::tags::PlantConfig;

/// 1 m3/h 水的热容流率，kW/K
const CP_KW_PER_M3H: f64 = 1.161;

/// M0 水力 + 集总热模型。
///
/// 一次侧：比例阀开度 -> Q1 -> 板换一次侧热容流率 C1
/// 二次侧：双泵转速 -> Q2 -> 热容流率 C2，机柜负载把回水加热
/// 板换：逆流 ε-NTU，解出 T22，再用回路热容积分
pub struct Plant {
    cfg: PlantConfig,
    valve_pos: f64,
    t22: f64,
    pumps: [Pump; 2],
}

struct Pump {
    run: bool,
    speed: f64,
    fault: bool,
    start_t: f64,
    stop_t: f64,
}

impl Pump {
    fn new() -> Self {
        Self {
            run: false,
            speed: 0.0,
            fault: false,
            start_t: 0.0,
            stop_t: 0.0,
        }
    }

    fn step(&mut self, dt: f64, run_cmd: bool, speed_cmd: f64) {
        if self.fault {
            self.run = false;
            self.speed = 0.0;
            return;
        }

        if run_cmd && !self.run {
            self.start_t += dt;
            if self.start_t >= 1.5 {
                self.run = true;
                self.start_t = 0.0;
            }
        } else {
            self.start_t = 0.0;
        }

        if !run_cmd && self.run {
            self.stop_t += dt;
            if self.stop_t >= 1.0 {
                self.run = false;
                self.stop_t = 0.0;
            }
        } else {
            self.stop_t = 0.0;
        }

        let target = if self.run {
            // 不再设最低转速：指令 0% 时泵不输出流量
            speed_cmd.clamp(0.0, 100.0)
        } else {
            0.0
        };
        let rate = 60.0 * dt;
        self.speed += (target - self.speed).clamp(-rate, rate);
    }
}

/// 逆流板换换热量，kW
fn hx_heat(t21: f64, t11: f64, c1: f64, c2: f64, ua: f64) -> f64 {
    if c1 <= 1e-9 || c2 <= 1e-9 {
        return 0.0;
    }
    let cmin = c1.min(c2);
    let cmax = c1.max(c2);
    let cr = cmin / cmax;
    let ntu = ua / cmin;
    let eps = if (1.0 - cr).abs() < 1e-9 {
        ntu / (1.0 + ntu)
    } else {
        let e = (-ntu * (1.0 - cr)).exp();
        (1.0 - e) / (1.0 - cr * e)
    };
    (eps * cmin * (t21 - t11)).max(0.0)
}

impl Plant {
    pub fn new(cfg: PlantConfig) -> Self {
        Self {
            t22: cfg.facility_supply_c + 2.0,
            cfg,
            valve_pos: 0.0,
            pumps: [Pump::new(), Pump::new()],
        }
    }

    /// 按当前命令初始化执行器位置（上电默认状态，不经过行程）。
    pub fn prime(&mut self, state: &SimState) {
        self.valve_pos = state.value("VALVE_CMD").clamp(0.0, 100.0);
        for (i, pump) in self.pumps.iter_mut().enumerate() {
            let prefix = format!("PUMP{}", i + 1);
            let run = state.bit(&format!("{prefix}_RUN_CMD"));
            let speed = state.value(&format!("{prefix}_SPEED_CMD"));
            pump.run = run;
            pump.speed = if run { speed.clamp(0.0, 100.0) } else { 0.0 };
            pump.start_t = 0.0;
            pump.stop_t = 0.0;
        }
    }

    pub fn step(&mut self, dt: f64, state: &mut SimState) {
        let valve_cmd = state.value("VALVE_CMD");
        let pump1_run = state.bit("PUMP1_RUN_CMD");
        let pump1_speed = state.value("PUMP1_SPEED_CMD");
        let pump2_run = state.bit("PUMP2_RUN_CMD");
        let pump2_speed = state.value("PUMP2_SPEED_CMD");

        // 比例阀：默认 90 s 走完 0..100%，可配置
        let target = valve_cmd.clamp(0.0, 100.0);
        let rate = 100.0 / self.cfg.valve_stroke_s.max(0.1) * dt;
        self.valve_pos += (target - self.valve_pos).clamp(-rate, rate);

        self.pumps[0].step(dt, pump1_run, pump1_speed);
        self.pumps[1].step(dt, pump2_run, pump2_speed);

        // 一次侧：阀开度 -> Q1
        let q1 = 0.4 * self.valve_pos;
        // 二次侧动力完全来自运行中的水泵；全部停泵时流量为 0
        let running_speed: f64 = self
            .pumps
            .iter()
            .filter(|pump| pump.run)
            .map(|pump| pump.speed)
            .sum();
        let q2 = 0.25 * running_speed;

        let p21 = 3.5;
        let p22 = p21 + 0.0006 * q2 * q2;
        let p11 = 4.5;
        let p12 = p11 - 0.0004 * q1 * q1;

        // ---- 热模型 ----
        let t11 = state
            .boundary
            .facility_c
            .unwrap_or(self.cfg.facility_supply_c)
            .clamp(0.0, 80.0);
        let c1 = q1 * CP_KW_PER_M3H;
        let c2 = q2 * CP_KW_PER_M3H;

        // 回水温度手动设定时：直接按板换换热量解出供液温度，
        // 保证 c1·(T12−T11) = c2·(T21−T22) = q_hx，瞬时能量守恒。
        // 未设定时：负载固定，回水温度由负载和流量决定，二次回路仍保留热容惯性。
        let forced_t21 = state.boundary.return_c.map(|value| value.clamp(0.0, 80.0));
        let ua = state
            .boundary
            .ua_kw_per_k
            .unwrap_or(self.cfg.ua_kw_per_k);
        let q_hx;
        let t21;

        if let Some(target) = forced_t21 {
            t21 = target;
            q_hx = hx_heat(target, t11, c1, c2, ua);
            self.t22 = if c2 > 1e-9 {
                (target - q_hx / c2).clamp(0.0, 80.0)
            } else {
                target
            };
        } else {
            let load = self.cfg.load_kw;
            let t21_in = if c2 > 2.0 {
                (self.t22 + load / c2).min(self.t22 + 30.0)
            } else {
                self.t22
            };
            q_hx = hx_heat(t21_in, t11, c1, c2, ua);
            let d_temp = dt * (load - q_hx) / self.cfg.loop_capacity_kj_per_k;
            self.t22 = (self.t22 + d_temp).clamp(0.0, 80.0);
            t21 = if c2 > 2.0 {
                self.t22 + load / c2
            } else {
                self.t22
            };
        }

        let t12 = if c1 > 1e-6 { t11 + q_hx / c1 } else { t11 };

        state.effective_facility_c = t11;
        state.effective_return_c = t21;

        state.set_value("Q1", q1);
        state.set_value("Q2", q2);
        state.set_value("P21", p21);
        state.set_value("P22", p22);
        state.set_value("P20", p21);
        state.set_value("P23", p22);
        state.set_value("P11", p11);
        state.set_value("P12", p12);
        state.set_value("P10", p11);
        state.set_value("P13", p12);
        state.set_value("LEVEL", 60.0);

        state.set_value("T11", t11);
        state.set_value("T12", t12);
        state.set_value("T21", t21);
        state.set_value("T22", self.t22);

        state.set_value("VALVE_POS", self.valve_pos);
        state.set_value("PH", 7.2);

        state.set_bit("PUMP1_RUN", self.pumps[0].run);
        state.set_bit("PUMP2_RUN", self.pumps[1].run);
        state.set_bit("PUMP1_FAULT", self.pumps[0].fault);
        state.set_bit("PUMP2_FAULT", self.pumps[1].fault);
        state.set_bit("LEAK_ALARM", false);
        state.set_bit("LEVEL_LOW", 60.0 < 20.0);
        state.set_bit("LEVEL_HIGH", 60.0 > 90.0);
        state.set_bit("SAFETY_VALVE_OPEN", p22 > 6.0);

        state.apply_absent();
    }
}
