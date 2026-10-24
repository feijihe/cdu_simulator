use std::net::SocketAddr;
use std::sync::{Arc, RwLock};
use std::time::Duration;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post, put};
use axum::{Json, Router};
use serde_json::json;
use tower_http::services::{ServeDir, ServeFile};

use crate::state::{SimState, TagPatch};
use crate::tags::PointTable;
use serde::Deserialize;

type AppState = Arc<RwLock<SimState>>;

#[derive(Debug, Deserialize)]
struct PointPatch {
    #[serde(default)]
    value: Option<f64>,
    #[serde(default)]
    on: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct BoundaryPatch {
    #[serde(default)]
    facility_c: Option<f64>,
    #[serde(default)]
    return_c: Option<f64>,
    #[serde(default)]
    ua_kw_per_k: Option<f64>,
}

pub fn serve(addr: SocketAddr, state: AppState) -> std::io::Result<()> {
    let app = Router::new()
        .route("/api/points", get(points))
        .route("/api/topology", get(topology))
        .route("/api/config", get(get_config).put(put_config))
        .route("/api/config/export", post(export_config))
        .route("/api/points/{id}", put(put_point))
        .route("/api/plant", put(put_boundary).delete(clear_boundary))
        .route("/api/tags/{id}", put(patch_tag))
        .route("/ws", get(ws))
        .fallback_service(
            ServeDir::new("web/dist").fallback(ServeFile::new("web/dist/index.html")),
        )
        .with_state(state);

    let runtime = tokio::runtime::Runtime::new()?;
    runtime.block_on(async move {
        let listener = tokio::net::TcpListener::bind(addr).await?;
        eprintln!("[http] listening on http://{addr}");
        axum::serve(listener, app).await
    })
}

async fn points(State(state): State<AppState>) -> impl IntoResponse {
    let guard = state.read().unwrap();
    Json(guard.snapshot())
}

/// 静态拓扑，前端加载一次即可；点表没配 topology 时返回 null。
async fn topology(State(state): State<AppState>) -> impl IntoResponse {
    let guard = state.read().unwrap();
    Json(guard.table.topology.clone())
}

/// 当前完整配置（生效值，已叠加 overrides.yaml）。
async fn get_config(State(state): State<AppState>) -> impl IntoResponse {
    let guard = state.read().unwrap();
    Json(guard.table.clone())
}

/// Web 配置页提交：严格校验 → 写 overrides.yaml → 热替换运行中的点表。
async fn put_config(State(state): State<AppState>, Json(payload): Json<PointTable>) -> Response {
    let result = state.write().unwrap().apply_config(payload);
    match result {
        Ok(()) => (StatusCode::OK, Json(json!({ "ok": true }))).into_response(),
        Err(message) => {
            (StatusCode::BAD_REQUEST, Json(json!({ "error": message }))).into_response()
        }
    }
}

/// 把配置草稿导出为完整的 tags.yaml，不写入运行状态。
async fn export_config(Json(mut payload): Json<PointTable>) -> Response {
    if let Some(topology) = payload.topology.as_mut() {
        topology.fill_defaults();
    }
    if let Err(err) = payload.validate() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": format!("{err:#}") })),
        )
            .into_response();
    }
    match serde_yaml::to_string(&payload) {
        Ok(yaml) => {
            let body = format!("# 由 cdu-sim Web 配置页导出\n{yaml}");
            (
                [
                    (header::CONTENT_TYPE, "application/yaml; charset=utf-8"),
                    (
                        header::CONTENT_DISPOSITION,
                        "attachment; filename=\"cdu-config.yaml\"",
                    ),
                ],
                body,
            )
                .into_response()
        }
        Err(err) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("导出失败: {err}") })),
        )
            .into_response(),
    }
}

async fn put_point(
    Path(id): Path<String>,
    State(state): State<AppState>,
    Json(patch): Json<PointPatch>,
) -> Response {
    let result = {
        let mut guard = state.write().unwrap();
        match (patch.value, patch.on) {
            (Some(value), _) => guard.set_command_value(&id, value),
            (None, Some(on)) => guard.set_command_bit(&id, on),
            _ => Err("请求需要 value 或 on".to_string()),
        }
    };

    match result {
        Ok(()) => (StatusCode::OK, Json(json!({ "ok": true }))).into_response(),
        Err(message) => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": message })),
        )
            .into_response(),
    }
}

async fn put_boundary(
    State(state): State<AppState>,
    Json(patch): Json<BoundaryPatch>,
) -> Response {
    state
        .write()
        .unwrap()
        .set_boundary(patch.facility_c, patch.return_c, patch.ua_kw_per_k);
    (StatusCode::OK, Json(json!({ "ok": true }))).into_response()
}

async fn clear_boundary(State(state): State<AppState>) -> Response {
    state.write().unwrap().clear_boundary();
    (StatusCode::OK, Json(json!({ "ok": true }))).into_response()
}

async fn patch_tag(    Path(id): Path<String>,
    State(state): State<AppState>,
    Json(patch): Json<TagPatch>,
) -> Response {
    let result = state.write().unwrap().patch_tag(&id, patch);
    match result {
        Ok(()) => (StatusCode::OK, Json(json!({ "ok": true }))).into_response(),
        Err(message) => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": message })),
        )
            .into_response(),
    }
}

async fn ws(ws: WebSocketUpgrade, State(state): State<AppState>) -> impl IntoResponse {
    ws.on_upgrade(move |socket| push_loop(socket, state))
}

async fn push_loop(mut socket: WebSocket, state: AppState) {
    // 5 Hz 推送整帧快照，前端只做渲染
    let mut tick = tokio::time::interval(Duration::from_millis(200));
    loop {
        tokio::select! {
            _ = tick.tick() => {
                let payload = {
                    let guard = state.read().unwrap();
                    serde_json::to_string(&guard.snapshot()).unwrap_or_default()
                };
                if socket.send(Message::Text(payload.into())).await.is_err() {
                    break;
                }
            }
            message = socket.recv() => {
                match message {
                    None | Some(Ok(Message::Close(_))) | Some(Err(_)) => break,
                    _ => {}
                }
            }
        }
    }
}
