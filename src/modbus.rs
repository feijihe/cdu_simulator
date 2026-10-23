use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::sync::{Arc, RwLock};
use std::thread;
use std::time::Duration;

use anyhow::{Context, Result};

use crate::state::SimState;
use crate::tags::Area;

pub fn serve(addr: SocketAddr, state: Arc<RwLock<SimState>>) -> Result<()> {
    let listener = TcpListener::bind(addr).with_context(|| format!("监听 {addr} 失败"))?;
    for incoming in listener.incoming() {
        match incoming {
            Ok(stream) => {
                let peer = stream
                    .peer_addr()
                    .map(|a| a.to_string())
                    .unwrap_or_else(|_| "?".to_string());
                eprintln!("[modbus] client {peer} connected");
                let state = state.clone();
                thread::spawn(move || {
                    if let Err(err) = handle(stream, state) {
                        eprintln!("[modbus] {peer} closed: {err}");
                    }
                });
            }
            Err(err) => eprintln!("[modbus] accept failed: {err}"),
        }
    }
    Ok(())
}

fn handle(mut stream: TcpStream, state: Arc<RwLock<SimState>>) -> Result<()> {
    stream.set_read_timeout(Some(Duration::from_secs(300)))?;
    stream.set_nodelay(true).ok();

    let mut header = [0u8; 7];
    let mut pdu = vec![0u8; 260];

    loop {
        match stream.read_exact(&mut header) {
            Ok(()) => {}
            Err(err) if err.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(()),
            Err(err) => return Err(err.into()),
        }

        let txn = u16::from_be_bytes([header[0], header[1]]);
        let proto = u16::from_be_bytes([header[2], header[3]]);
        let len = u16::from_be_bytes([header[4], header[5]]) as usize;
        if proto != 0 || !(2..=254).contains(&len) {
            return Ok(());
        }

        let pdu_len = len - 1;
        stream.read_exact(&mut pdu[..pdu_len])?;
        let response = process(&pdu[..pdu_len], &state);

        let mut frame = Vec::with_capacity(7 + response.len());
        frame.extend_from_slice(&txn.to_be_bytes());
        frame.extend_from_slice(&0u16.to_be_bytes());
        frame.extend_from_slice(&((response.len() + 1) as u16).to_be_bytes());
        frame.push(header[6]);
        frame.extend_from_slice(&response);
        stream.write_all(&frame)?;
    }
}

fn process(pdu: &[u8], state: &RwLock<SimState>) -> Vec<u8> {
    let fc = pdu[0];
    let body = &pdu[1..];
    match fc {
        0x01 => read_bits(state, Area::Coil, fc, body),
        0x02 => read_bits(state, Area::Discrete, fc, body),
        0x03 => read_regs(state, Area::Holding, fc, body),
        0x04 => read_regs(state, Area::Input, fc, body),
        0x05 => write_single_coil(body, state),
        0x06 => write_single_reg(body, state),
        0x0F => write_coils(body, state),
        0x10 => write_regs(body, state),
        _ => exception(fc, 0x01),
    }
}

fn exception(fc: u8, code: u8) -> Vec<u8> {
    vec![fc | 0x80, code]
}

fn read_regs(state: &RwLock<SimState>, area: Area, fc: u8, body: &[u8]) -> Vec<u8> {
    if body.len() != 4 {
        return exception(fc, 0x03);
    }
    let start = u16::from_be_bytes([body[0], body[1]]);
    let qty = u16::from_be_bytes([body[2], body[3]]);

    match state.read().unwrap().read_regs(area, start, qty) {
        Ok(words) => {
            let mut out = Vec::with_capacity(2 + words.len() * 2);
            out.push(fc);
            out.push((words.len() * 2) as u8);
            for word in words {
                out.extend_from_slice(&word.to_be_bytes());
            }
            out
        }
        Err(code) => exception(fc, code),
    }
}

fn read_bits(state: &RwLock<SimState>, area: Area, fc: u8, body: &[u8]) -> Vec<u8> {
    if body.len() != 4 {
        return exception(fc, 0x03);
    }
    let start = u16::from_be_bytes([body[0], body[1]]);
    let qty = u16::from_be_bytes([body[2], body[3]]);

    match state.read().unwrap().read_bits(area, start, qty) {
        Ok(bits) => {
            let mut out = vec![fc, ((bits.len() + 7) / 8) as u8];
            let mut byte = 0u8;
            for (i, bit) in bits.iter().enumerate() {
                if *bit {
                    byte |= 1 << (i % 8);
                }
                if i % 8 == 7 {
                    out.push(byte);
                    byte = 0;
                }
            }
            if bits.len() % 8 != 0 {
                out.push(byte);
            }
            out
        }
        Err(code) => exception(fc, code),
    }
}

fn write_single_coil(body: &[u8], state: &RwLock<SimState>) -> Vec<u8> {
    if body.len() != 4 {
        return exception(0x05, 0x03);
    }
    let addr = u16::from_be_bytes([body[0], body[1]]);
    let raw = u16::from_be_bytes([body[2], body[3]]);
    let value = match raw {
        0xFF00 => true,
        0x0000 => false,
        _ => return exception(0x05, 0x03),
    };

    match state.write().unwrap().write_bits(Area::Coil, addr, &[value]) {
        Ok(()) => vec![0x05, body[0], body[1], body[2], body[3]],
        Err(code) => exception(0x05, code),
    }
}

fn write_single_reg(body: &[u8], state: &RwLock<SimState>) -> Vec<u8> {
    if body.len() != 4 {
        return exception(0x06, 0x03);
    }
    let addr = u16::from_be_bytes([body[0], body[1]]);
    let value = u16::from_be_bytes([body[2], body[3]]);

    match state.write().unwrap().write_regs(Area::Holding, addr, &[value]) {
        Ok(()) => vec![0x06, body[0], body[1], body[2], body[3]],
        Err(code) => exception(0x06, code),
    }
}

fn write_coils(body: &[u8], state: &RwLock<SimState>) -> Vec<u8> {
    if body.len() < 5 {
        return exception(0x0F, 0x03);
    }
    let start = u16::from_be_bytes([body[0], body[1]]);
    let qty = u16::from_be_bytes([body[2], body[3]]) as usize;
    let byte_count = body[4] as usize;
    if qty == 0 || qty > 1968 || byte_count != (qty + 7) / 8 || body.len() != 5 + byte_count {
        return exception(0x0F, 0x03);
    }

    let mut values = Vec::with_capacity(qty);
    for i in 0..qty {
        let byte = body[5 + i / 8];
        values.push((byte >> (i % 8)) & 1 == 1);
    }

    match state
        .write()
        .unwrap()
        .write_bits(Area::Coil, start, &values)
    {
        Ok(()) => vec![0x0F, body[0], body[1], body[2], body[3]],
        Err(code) => exception(0x0F, code),
    }
}

fn write_regs(body: &[u8], state: &RwLock<SimState>) -> Vec<u8> {
    if body.len() < 5 {
        return exception(0x10, 0x03);
    }
    let start = u16::from_be_bytes([body[0], body[1]]);
    let qty = u16::from_be_bytes([body[2], body[3]]) as usize;
    let byte_count = body[4] as usize;
    if qty == 0 || qty > 123 || byte_count != qty * 2 || body.len() != 5 + byte_count {
        return exception(0x10, 0x03);
    }

    let mut words = Vec::with_capacity(qty);
    for i in 0..qty {
        words.push(u16::from_be_bytes([body[5 + i * 2], body[6 + i * 2]]));
    }

    match state
        .write()
        .unwrap()
        .write_regs(Area::Holding, start, &words)
    {
        Ok(()) => vec![0x10, body[0], body[1], body[2], body[3]],
        Err(code) => exception(0x10, code),
    }
}
