use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug)]
struct SysState {
    lrt: i64,
}

pub fn check_clock_tampering(data_dir: &Path) -> Result<(), String> {
    let state_path = data_dir.join(".sys_state");
    
    let current_time = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    if state_path.exists() {
        if let Ok(data) = fs::read(&state_path) {
            let decrypted_bytes: Vec<u8> = data.iter().map(|&b| b ^ 0x5A).collect();
            if let Ok(decrypted_str) = String::from_utf8(decrypted_bytes) {
                if let Ok(state) = serde_json::from_str::<SysState>(&decrypted_str) {
                    if current_time < state.lrt {
                        return Err("系统检测到本地时间异常，请同步您的系统时间后重试。".to_string());
                    }
                }
            }
        }
    }

    // Write updated time
    let state = SysState { lrt: current_time };
    if let Ok(state_str) = serde_json::to_string(&state) {
        let encrypted_bytes: Vec<u8> = state_str.as_bytes().iter().map(|&b| b ^ 0x5A).collect();
        let _ = fs::write(&state_path, encrypted_bytes);
    }

    Ok(())
}
