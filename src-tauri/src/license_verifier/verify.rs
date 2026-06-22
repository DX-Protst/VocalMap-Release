use base64::{engine::general_purpose::STANDARD, Engine as _};
use rsa::{pkcs1::DecodeRsaPublicKey, Pkcs1v15Sign, RsaPublicKey};
use sha2::{Digest, Sha256};
use std::path::Path;

const OBFUSCATED_KEY_BYTES: &[u8] = &[
    119, 119, 119, 119, 119, 24, 31, 29, 19, 20, 122, 8, 9, 27, 122, 10, 15, 24, 22, 19, 25, 122,
    17, 31, 3, 119, 119, 119, 119, 119, 80, 23, 19, 29, 16, 27, 53, 29, 24, 27, 16, 10, 16, 50,
    27, 51, 43, 105, 59, 55, 28, 20, 47, 62, 49, 41, 18, 42, 110, 47, 51, 48, 50, 107, 52, 113,
    15, 25, 106, 3, 55, 51, 17, 49, 105, 32, 24, 41, 20, 34, 51, 35, 18, 29, 9, 98, 22, 109, 51,
    24, 45, 62, 52, 13, 99, 80, 48, 28, 63, 27, 21, 108, 9, 62, 109, 56, 2, 111, 107, 111, 61,
    49, 29, 29, 24, 23, 56, 109, 21, 110, 40, 104, 62, 54, 59, 25, 13, 24, 56, 28, 12, 110, 63,
    14, 20, 53, 60, 106, 61, 43, 60, 105, 42, 105, 60, 49, 40, 31, 108, 9, 25, 43, 107, 46, 57,
    109, 17, 40, 44, 52, 80, 10, 99, 52, 30, 30, 20, 25, 41, 52, 22, 3, 22, 98, 57, 2, 28, 23,
    49, 63, 50, 111, 105, 17, 50, 59, 111, 110, 23, 27, 113, 98, 3, 8, 21, 15, 17, 35, 43, 9,
    55, 51, 15, 99, 48, 24, 117, 16, 22, 21, 113, 31, 99, 27, 61, 23, 24, 27, 27, 31, 103, 80,
    119, 119, 119, 119, 119, 31, 20, 30, 122, 8, 9, 27, 122, 10, 15, 24, 22, 19, 25, 122, 17,
    31, 3, 119, 119, 119, 119, 119,
];

pub fn get_public_key_pem() -> String {
    OBFUSCATED_KEY_BYTES.iter().map(|&b| (b ^ 0x5A) as char).collect()
}

pub fn verify_pro_license(
    data_dir: &Path,
    backend_dir: &Path,
) -> Result<serde_json::Value, String> {
    // 1. Clock tampering check
    super::clock::check_clock_tampering(data_dir)?;

    // 2. Decode public key
    let pem = get_public_key_pem();
    let public_key = RsaPublicKey::from_pkcs1_pem(&pem)
        .map_err(|e| format!("RSA Public key is missing or corrupted: {}", e))?;

    // 3. Load license.key
    let license_path = backend_dir.join("license.key");
    if !license_path.exists() {
        return Err("未找到许可证文件。请先购买 Pro 版并激活。".to_string());
    }

    let license_content = std::fs::read_to_string(&license_path)
        .map_err(|e| format!("无法读取许可证文件: {}", e))?;

    let data: serde_json::Value = serde_json::from_str(&license_content)
        .map_err(|e| format!("许可证格式错误: {}", e))?;

    let payload_str = data
        .get("license_payload")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "缺少 license_payload".to_string())?;

    let signature_b64 = data
        .get("license_signature")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "缺少 license_signature".to_string())?;

    // 4. Verify signature
    let signature = STANDARD
        .decode(signature_b64)
        .map_err(|e| format!("签名 Base64 解码失败: {}", e))?;

    let mut hasher = Sha256::new();
    hasher.update(payload_str.as_bytes());
    let hashed = hasher.finalize();

    public_key
        .verify(Pkcs1v15Sign::new::<Sha256>(), &hashed, &signature)
        .map_err(|_| "许可证签名伪造或遭篡改！".to_string())?;

    // 5. Check expiration and machine_id binding
    let payload: serde_json::Value = serde_json::from_str(payload_str)
        .map_err(|e| format!("解析 payload 失败: {}", e))?;

    let expires_at = payload.get("expires_at").and_then(|v| v.as_f64());
    if let Some(exp) = expires_at {
        let current_time = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as f64)
            .unwrap_or(0.0);
        if current_time > exp {
            return Err("您的许可证已过期，请续费。".to_string());
        }
    }

    let payload_machine_id = payload.get("machine_id").and_then(|v| v.as_str());
    let current_machine_id = machine_uid::get().unwrap_or_else(|_| "unknown_machine_id".to_string());

    if let Some(pmid) = payload_machine_id {
        if pmid != current_machine_id {
            return Err("该许可证不属于当前设备，请勿盗用！".to_string());
        }
    } else {
        return Err("许可证数据残缺，缺少机器码绑定信息！".to_string());
    }

    Ok(payload)
}
