mod http;
mod modbus;
mod net;
mod plant;
mod state;
mod tags;

use std::net::SocketAddr;
use std::path::PathBuf;
use std::process::ExitCode;
use std::sync::{Arc, RwLock};
use std::thread;
use std::time::Duration;

use anyhow::{bail, Context, Result};

/// 编译时嵌入的默认点表；没有外部 config/tags.yaml 时使用。
const EMBEDDED_CONFIG: &str = include_str!("../config/tags.yaml");

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(err) => {
            eprintln!("error: {err:#}");
            ExitCode::FAILURE
        }
    }
}

fn run() -> Result<()> {
    let mut config: Option<PathBuf> = None;
    let mut bind = "0.0.0.0:1502".to_string();
    let mut http_bind = "0.0.0.0:8080".to_string();
    let mut unit = 1u8;
    let mut dump = false;
    let mut no_noise = false;
    let mut no_overrides = false;
    let mut cold = false;
    let mut valve_stroke: Option<f64> = None;

    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "-c" | "--config" => {
                config = Some(args.next().context("--config 需要一个文件路径")?.into());
            }
            "--bind" => {
                bind = args.next().context("--bind 需要一个地址")?;
            }
            "--http" => {
                http_bind = args.next().context("--http 需要一个地址")?;
            }
            "--unit" => {
                unit = args
                    .next()
                    .context("--unit 需要一个数值")?
                    .parse()
                    .context("unit id 无效")?;
            }
            "--dump-points" => dump = true,
            "--no-noise" => no_noise = true,
            "--no-overrides" => no_overrides = true,
            "--cold" => cold = true,
            "--valve-stroke" => {
                valve_stroke = Some(
                    args.next()
                        .context("--valve-stroke 需要一个秒数")?
                        .parse()
                        .context("阀行程时间无效")?,
                );
            }
            "-h" | "--help" => {
                print_help();
                return Ok(());
            }
            other => bail!("未知参数: {other}（用 --help 查看用法）"),
        }
    }

    let config_path = config.or_else(|| {
        let local = PathBuf::from("config/tags.yaml");
        local.exists().then_some(local)
    });
    let (mut table, config_source, overlay_path) = match config_path {
        Some(path) => {
            let table = if no_overrides {
                tags::PointTable::load_plain(&path)?
            } else {
                tags::PointTable::load(&path)?
            };
            let source = path.display().to_string();
            (table, source, tags::overrides_path(&path))
        }
        None => {
            // 单文件运行：点表来自二进制，网页修改写到当前目录的 config/overrides.yaml
            let overlay = PathBuf::from("config/overrides.yaml");
            let table = if no_overrides {
                tags::PointTable::parse(EMBEDDED_CONFIG)?
            } else {
                tags::PointTable::parse_with_overlay(EMBEDDED_CONFIG, &overlay)?
            };
            (table, "内置".to_string(), overlay)
        }
    };
    if no_noise {
        table.noise.enabled = false;
    }
    if cold {
        // 测试用：忽略点表里的上电初始命令，从全零开始
        for tag in &mut table.tags {
            if tag.writable {
                tag.initial = None;
            }
        }
    }
    if let Some(stroke) = valve_stroke {
        if stroke <= 0.0 {
            bail!("--valve-stroke 必须大于 0");
        }
        table.plant.valve_stroke_s = stroke;
    }
    if dump {
        table.print_summary();
        return Ok(());
    }

    let plant_cfg = table.plant;
    let meta_name = table.meta.name.clone();
    let tag_count = table.tags.len();

    let state = Arc::new(RwLock::new(state::SimState::new(table, overlay_path)));
    let mut plant = plant::Plant::new(plant_cfg);
    {
        let mut guard = state.write().unwrap();
        if !cold {
            plant.prime(&guard);
        }
        plant.step(0.01, &mut guard);
        guard.update_sensors(0.01);
    }

    let engine_state = state.clone();
    thread::spawn(move || loop {
        thread::sleep(Duration::from_millis(100));
        let mut guard = engine_state.write().unwrap();
        plant.step(0.1, &mut guard);
        guard.update_sensors(0.1);
    });

    let addr: SocketAddr = bind
        .parse()
        .with_context(|| format!("无效的监听地址: {bind}"))?;
    let http_addr: SocketAddr = http_bind
        .parse()
        .with_context(|| format!("无效的 HTTP 监听地址: {http_bind}"))?;

    // 先绑定两个端口，再打印访问地址；这样端口被占用时不会先亮出一组假地址，
    // 用 :0 启动时也能显示系统实际分配的端口。
    let modbus_listener = modbus::bind(addr)?;
    let http_listener = http::bind(http_addr).with_context(|| format!("监听 {http_addr} 失败"))?;
    let modbus_addr = modbus_listener
        .local_addr()
        .context("读取 Modbus 监听地址失败")?;
    let http_addr = http_listener
        .local_addr()
        .context("读取 HTTP 监听地址失败")?;

    let http_state = state.clone();
    thread::spawn(move || {
        if let Err(err) = http::serve(http_listener, http_state) {
            eprintln!("[http] 启动失败: {err}");
        }
    });

    println!(
        "cdu-sim v{}  点表 {} ({} 点)",
        env!("CARGO_PKG_VERSION"),
        meta_name,
        tag_count
    );
    println!("config  {config_source}");

    println!();
    println!("web");
    for line in net::access_lines(http_addr, true) {
        println!("{line}");
    }

    println!();
    println!("modbus  unit id {unit}");
    for line in net::access_lines(modbus_addr, false) {
        println!("{line}");
    }

    modbus::serve(modbus_listener, state)?;
    Ok(())
}

fn print_help() {
    println!(
        "\
cdu-sim — CDU 模拟器

用法:
  cdu-sim [--config <path>] [--bind <addr>] [--http <addr>] [--unit <id>]
  cdu-sim --dump-points [--config <path>]

选项:
  -c, --config <path>   点表文件；省略时优先 config/tags.yaml，没有则用内置点表
      --bind <addr>     Modbus 监听地址，默认 0.0.0.0:1502
      --http <addr>     Web 监听地址，默认 0.0.0.0:8080
      --unit <id>       Modbus unit id，默认 1
      --dump-points     打印点表、拓扑与 Modbus 地址映射后退出
      --no-noise        关闭传感器噪声（测试用）
      --no-overrides    忽略 config/overrides.yaml（测试用）
      --cold            忽略上电初始命令，从全零开始（测试用）
      --valve-stroke <s> 覆盖比例阀 0→100% 行程时间（秒）
  -h, --help            显示帮助
"
    );
}
