//! 启动信息里的可访问地址，输出风格对齐 Vite 的 Local / Network。
//!
//! 监听在通配地址时，直接打印 `0.0.0.0` 既不能点击也不直观；这里改用
//! `localhost` 和当前局域网地址，方便终端直接打开或复制给 Modbus 客户端。

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, UdpSocket};

/// 返回某个监听地址对应的展示行（不含分组标题）。
pub fn access_lines(addr: SocketAddr, web: bool) -> Vec<String> {
    let lan = if addr.is_ipv4() { lan_ipv4() } else { None };
    access_lines_with(addr, web, lan)
}

fn access_lines_with(addr: SocketAddr, web: bool, lan: Option<Ipv4Addr>) -> Vec<String> {
    let port = addr.port();

    // 指定了具体网卡时，localhost 通常连不上，只展示这个地址。
    if !addr.ip().is_unspecified() && !addr.ip().is_loopback() {
        return vec![format!("  ➜  Network: {}", url(addr.ip(), port, web))];
    }

    let mut lines = vec![format!(
        "  ➜  Local:   {}",
        url(loopback_for(addr), port, web)
    )];

    if addr.ip().is_unspecified() {
        if let Some(ip) = lan.filter(|ip| !ip.is_loopback() && !ip.is_unspecified()) {
            lines.push(format!("  ➜  Network: {}", url(IpAddr::V4(ip), port, web)));
        } else {
            lines.push(format!(
                "  ➜  Network: 未检测到局域网地址（用 {} 指定）",
                expose_flag(web, addr)
            ));
        }
    } else {
        lines.push(format!(
            "  ➜  Network: 未开放（用 {} 开放到局域网）",
            expose_flag(web, addr)
        ));
    }

    lines
}

fn loopback_for(addr: SocketAddr) -> IpAddr {
    if addr.is_ipv4() {
        IpAddr::V4(Ipv4Addr::LOCALHOST)
    } else {
        IpAddr::V6(Ipv6Addr::LOCALHOST)
    }
}

fn url(ip: IpAddr, port: u16, web: bool) -> String {
    let host = match ip {
        // 浏览器里 localhost 比 127.0.0.1 更稳，终端也更容易识别成链接。
        IpAddr::V4(ip) if web && ip.is_loopback() => "localhost".to_string(),
        IpAddr::V4(ip) => ip.to_string(),
        IpAddr::V6(ip) if web && ip.is_loopback() => "localhost".to_string(),
        IpAddr::V6(ip) => format!("[{ip}]"),
    };
    if web {
        format!("http://{host}:{port}/")
    } else {
        format!("{host}:{port}")
    }
}

fn expose_flag(web: bool, addr: SocketAddr) -> String {
    let host = if addr.is_ipv4() { "0.0.0.0" } else { "[::]" };
    let flag = if web { "--http" } else { "--bind" };
    format!("{flag} {host}:{}", addr.port())
}

/// 通过默认路由探测本机局域网 IPv4；UDP connect 不会真的发包。
fn lan_ipv4() -> Option<Ipv4Addr> {
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    match socket.local_addr().ok()?.ip() {
        IpAddr::V4(ip) if !ip.is_loopback() && !ip.is_unspecified() => Some(ip),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn addr(value: &str) -> SocketAddr {
        value.parse().unwrap()
    }

    #[test]
    fn wildcard_web_shows_localhost_and_lan() {
        let lines = access_lines_with(
            addr("0.0.0.0:8080"),
            true,
            Some(Ipv4Addr::new(192, 168, 1, 23)),
        );
        assert_eq!(lines[0], "  ➜  Local:   http://localhost:8080/");
        assert_eq!(lines[1], "  ➜  Network: http://192.168.1.23:8080/");
    }

    #[test]
    fn wildcard_modbus_uses_literal_loopback() {
        let lines = access_lines_with(
            addr("0.0.0.0:1502"),
            false,
            Some(Ipv4Addr::new(192, 168, 1, 23)),
        );
        assert_eq!(lines[0], "  ➜  Local:   127.0.0.1:1502");
        assert_eq!(lines[1], "  ➜  Network: 192.168.1.23:1502");
    }

    #[test]
    fn loopback_hints_how_to_expose() {
        let lines = access_lines_with(addr("127.0.0.1:8080"), true, None);
        assert_eq!(lines[0], "  ➜  Local:   http://localhost:8080/");
        assert!(lines[1].contains("--http 0.0.0.0:8080"));
    }

    #[test]
    fn specific_address_only_shows_network() {
        let lines = access_lines_with(addr("192.168.1.5:8080"), true, None);
        assert_eq!(lines, vec!["  ➜  Network: http://192.168.1.5:8080/"]);
    }

    #[test]
    fn ipv6_addresses_are_bracketed() {
        let lines = access_lines_with(addr("[::1]:1502"), false, None);
        assert_eq!(lines[0], "  ➜  Local:   [::1]:1502");
    }

    #[test]
    fn missing_lan_falls_back_to_hint() {
        let lines = access_lines_with(addr("0.0.0.0:1502"), false, None);
        assert_eq!(lines[0], "  ➜  Local:   127.0.0.1:1502");
        assert!(lines[1].contains("--bind 0.0.0.0:1502"));
    }
}
