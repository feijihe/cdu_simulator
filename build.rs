use std::path::Path;
use std::process::Command;

fn main() {
    println!("cargo:rerun-if-changed=web/src");
    println!("cargo:rerun-if-changed=web/index.html");
    println!("cargo:rerun-if-changed=web/package.json");
    println!("cargo:rerun-if-changed=web/vite.config.ts");
    println!("cargo:rerun-if-changed=web/tailwind.config.js");
    println!("cargo:rerun-if-changed=web/postcss.config.js");
    println!("cargo:rerun-if-changed=web/tsconfig.json");
    println!("cargo:rerun-if-env-changed=CDU_SKIP_WEB_BUILD");

    let dist = Path::new("web/dist/index.html");
    let skip = std::env::var_os("CDU_SKIP_WEB_BUILD").is_some();

    if skip {
        if !dist.exists() {
            panic!(
                "CDU_SKIP_WEB_BUILD 已设置，但 web/dist/index.html 不存在；\
                 请先运行 `pnpm --dir web build`"
            );
        }
        return;
    }

    let manifest = std::env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| ".".to_string());
    let status = if cfg!(windows) {
        Command::new("cmd")
            .args(["/C", "pnpm", "--dir", "web", "build"])
            .current_dir(&manifest)
            .status()
    } else {
        Command::new("pnpm")
            .args(["--dir", "web", "build"])
            .current_dir(&manifest)
            .status()
    };

    match status {
        Ok(status) if status.success() => {}
        Ok(status) => panic!(
            "前端构建失败（pnpm --dir web build，退出码 {status}）；\
             请先 `pnpm --dir web install`，或设置 CDU_SKIP_WEB_BUILD=1 并自行构建 web/dist"
        ),
        Err(err) => panic!(
            "无法运行 pnpm（{err}）；请先 `pnpm --dir web install`，\
             或设置 CDU_SKIP_WEB_BUILD=1 并自行构建 web/dist"
        ),
    }

    if !dist.exists() {
        panic!("前端构建完成后仍找不到 web/dist/index.html");
    }
}
