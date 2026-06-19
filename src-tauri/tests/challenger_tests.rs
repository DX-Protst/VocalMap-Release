use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use app_lib::commands::{AppState, vmap_separate_audio};
use tauri::Manager;

const TEST_PUBLIC_KEY: &str = "-----BEGIN RSA PUBLIC KEY-----\n\
MIGJAoGBAIvQunW9U5SO/DXsEP8/7lwFKh4E49KSQj7Owh/hkLko7Lmofo1YXsgo\n\
DIXPg/sus1kfr8v/gQyRcZnHXcVuSRBZJEuxCfhIwuMd2QwrrxZKu13l8T2+q1kJ\n\
ZFWLTWhlOVc1eXgy/HzlvnH5dCMqiilRJHgtl8ul5uExA+nGLEv5AgMBAAE=\n\
-----END RSA PUBLIC KEY-----";

const TEST_PRIVATE_KEY: &str = "-----BEGIN RSA PRIVATE KEY-----\n\
[COMPROMISED KEY REMOVED]\n\
-----END RSA PRIVATE KEY-----";

fn sign_payload(payload_str: &str, priv_key_pem: &str) -> String {
    use rsa::{pkcs1::DecodeRsaPrivateKey, Pkcs1v15Sign, RsaPrivateKey};
    use sha2::{Digest, Sha256};
    use base64::{engine::general_purpose::STANDARD, Engine as _};

    let private_key = RsaPrivateKey::from_pkcs1_pem(priv_key_pem).unwrap();
    let mut hasher = Sha256::new();
    hasher.update(payload_str.as_bytes());
    let hashed = hasher.finalize();
    let signature = private_key
        .sign(Pkcs1v15Sign::new::<Sha256>(), &hashed)
        .unwrap();
    STANDARD.encode(signature)
}

fn verify_test_license(
    payload_str: &str,
    signature_b64: &str,
    pub_key_pem: &str,
) -> Result<serde_json::Value, String> {
    use rsa::{pkcs1::DecodeRsaPublicKey, Pkcs1v15Sign, RsaPublicKey};
    use sha2::{Digest, Sha256};
    use base64::{engine::general_purpose::STANDARD, Engine as _};

    let public_key = RsaPublicKey::from_pkcs1_pem(pub_key_pem)
        .map_err(|e| format!("RSA Public key error: {}", e))?;

    let signature = STANDARD
        .decode(signature_b64)
        .map_err(|e| format!("Base64 decode failed: {}", e))?;

    let mut hasher = Sha256::new();
    hasher.update(payload_str.as_bytes());
    let hashed = hasher.finalize();

    public_key
        .verify(Pkcs1v15Sign::new::<Sha256>(), &hashed, &signature)
        .map_err(|_| "Signature verification failed".to_string())?;

    let payload: serde_json::Value = serde_json::from_str(payload_str)
        .map_err(|e| format!("Parse payload failed: {}", e))?;

    let expires_at = payload.get("expires_at").and_then(|v| v.as_f64());
    if let Some(exp) = expires_at {
        let current_time = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs() as f64)
            .unwrap_or(0.0);
        if current_time > exp {
            return Err("Expired".to_string());
        }
    }

    Ok(payload)
}

struct CleanupGuard {
    backup_path: PathBuf,
    target_path: PathBuf,
}

impl Drop for CleanupGuard {
    fn drop(&mut self) {
        if self.backup_path.exists() {
            let _ = fs::copy(&self.backup_path, &self.target_path);
            let _ = fs::remove_file(&self.backup_path);
            println!("[CleanupGuard] Restored inference.py from backup.");
        }
    }
}

#[test]
fn test_clock_tampering_boundaries() {
    let temp_dir = std::env::temp_dir();
    let state_dir = temp_dir.join("vmap_test_tamper_boundaries");
    let _ = fs::create_dir_all(&state_dir);
    let state_path = state_dir.join(".sys_state");

    // Scenario 1: Empty file should be treated as no file (should not panic or fail, should write fresh state and return Ok)
    fs::write(&state_path, "").unwrap();
    let res = app_lib::license_verifier::clock::check_clock_tampering(&state_dir);
    assert!(res.is_ok(), "Empty sys_state should be handled gracefully");
    assert!(state_path.exists());
    let data = fs::read(&state_path).unwrap();
    assert!(!data.is_empty());

    // Scenario 2: Corrupted non-XOR bytes should be handled gracefully
    fs::write(&state_path, b"corrupted bytes here").unwrap();
    let res = app_lib::license_verifier::clock::check_clock_tampering(&state_dir);
    assert!(res.is_ok(), "Corrupted sys_state should be handled gracefully");
    let data = fs::read(&state_path).unwrap();
    assert!(!data.is_empty());

    // Scenario 3: Future time retrofit should block pro features
    let future_time = (SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64) + 10000;
    let state_json = serde_json::json!({ "lrt": future_time });
    let state_str = serde_json::to_string(&state_json).unwrap();
    let encrypted_bytes: Vec<u8> = state_str.as_bytes().iter().map(|&b| b ^ 0x5A).collect();
    fs::write(&state_path, encrypted_bytes).unwrap();

    let res = app_lib::license_verifier::clock::check_clock_tampering(&state_dir);
    assert!(res.is_err(), "Clock tampering should be detected");
    assert!(res.unwrap_err().contains("本地时间异常"));

    let _ = fs::remove_dir_all(&state_dir);
}

#[test]
fn test_production_license_verification() {
    let temp_dir = std::env::temp_dir();
    let data_dir = temp_dir.join("vmap_prod_license_data");
    let _ = fs::create_dir_all(&data_dir);

    // Read the actual production key
    let project_root = std::env::current_dir().unwrap();
    let prod_license_path = project_root.join("..").join("backend").join("license.key");
    assert!(prod_license_path.exists(), "Production license.key not found at {:?}", prod_license_path);

    let license_content = fs::read_to_string(&prod_license_path).unwrap();
    let mut license_json: serde_json::Value = serde_json::from_str(&license_content).unwrap();

    let backend_dir = temp_dir.join("vmap_prod_license_backend");
    let _ = fs::create_dir_all(&backend_dir);
    let test_license_key_path = backend_dir.join("license.key");

    // Scenario 1: Valid offline license verification should pass
    fs::write(&test_license_key_path, &license_content).unwrap();
    let res = app_lib::license_verifier::verify::verify_pro_license(&data_dir, &backend_dir);
    assert!(res.is_ok(), "Valid production license offline verification failed: {:?}", res);
    let payload = res.unwrap();
    assert_eq!(payload.get("plan_type").unwrap().as_str().unwrap(), "lifetime");

    // Scenario 2: Tampered payload should fail
    let original_payload = license_json.get("license_payload").unwrap().as_str().unwrap().to_string();
    let tampered_payload = original_payload.replace("lifetime", "monthly");
    license_json["license_payload"] = serde_json::Value::String(tampered_payload);
    fs::write(&test_license_key_path, serde_json::to_string(&license_json).unwrap()).unwrap();
    let res = app_lib::license_verifier::verify::verify_pro_license(&data_dir, &backend_dir);
    assert!(res.is_err(), "Tampered payload verification should fail");
    assert!(res.unwrap_err().contains("许可证签名伪造或遭篡改"));

    // Scenario 3: Tampered signature should fail
    license_json["license_payload"] = serde_json::Value::String(original_payload);
    let original_signature = license_json.get("license_signature").unwrap().as_str().unwrap().to_string();
    let mut tampered_sig = original_signature;
    if !tampered_sig.is_empty() {
        tampered_sig.replace_range(0..1, "X");
    }
    license_json["license_signature"] = serde_json::Value::String(tampered_sig);
    fs::write(&test_license_key_path, serde_json::to_string(&license_json).unwrap()).unwrap();
    let res = app_lib::license_verifier::verify::verify_pro_license(&data_dir, &backend_dir);
    assert!(res.is_err(), "Tampered signature verification should fail");

    // Cleanup
    let _ = fs::remove_dir_all(&data_dir);
    let _ = fs::remove_dir_all(&backend_dir);
}

#[test]
fn test_license_expiration_check_with_test_key() {
    // Scenario 1: Expired license (expires_at is in the past)
    let expired_time = (SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64) - 1000;
    let payload = serde_json::json!({
        "machine_id": "test-machine",
        "plan_type": "monthly",
        "expires_at": expired_time
    });
    let payload_str = serde_json::to_string(&payload).unwrap();
    let sig = sign_payload(&payload_str, TEST_PRIVATE_KEY);
    let res = verify_test_license(&payload_str, &sig, TEST_PUBLIC_KEY);
    assert!(res.is_err(), "Expired license should fail");
    assert_eq!(res.unwrap_err(), "Expired");

    // Scenario 2: Active license (expires_at is in the future)
    let future_time = (SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64) + 10000;
    let payload = serde_json::json!({
        "machine_id": "test-machine",
        "plan_type": "monthly",
        "expires_at": future_time
    });
    let payload_str = serde_json::to_string(&payload).unwrap();
    let sig = sign_payload(&payload_str, TEST_PRIVATE_KEY);
    let res = verify_test_license(&payload_str, &sig, TEST_PUBLIC_KEY);
    assert!(res.is_ok(), "Active future license failed verification: {:?}", res);

    // Scenario 3: Lifetime license (expires_at is null)
    let payload = serde_json::json!({
        "machine_id": "test-machine",
        "plan_type": "lifetime",
        "expires_at": null
    });
    let payload_str = serde_json::to_string(&payload).unwrap();
    let sig = sign_payload(&payload_str, TEST_PRIVATE_KEY);
    let res = verify_test_license(&payload_str, &sig, TEST_PUBLIC_KEY);
    assert!(res.is_ok(), "Lifetime license failed verification: {:?}", res);
}

#[test]
fn test_subprocess_spawning_and_progress_streaming() {
    let project_root = std::env::current_dir().unwrap();
    let logic_dir = project_root.join("..").join("logic_bsroformer");
    let inference_script = logic_dir.join("inference.py");
    let backup_script = logic_dir.join("inference.py.bak");

    assert!(inference_script.exists(), "inference.py not found at {:?}", inference_script);

    // Backup the original inference.py
    fs::copy(&inference_script, &backup_script).unwrap();
    let _guard = CleanupGuard {
        backup_path: backup_script,
        target_path: inference_script.clone(),
    };

    // Write mock inference.py
    let mock_py = r#"import os, sys, json, time, argparse

parser = argparse.ArgumentParser()
parser.add_argument("--input_folder")
parser.add_argument("--store_dir")
parser.add_argument("--model_type")
parser.add_argument("--config_path")
parser.add_argument("--start_check_point")
parser.add_argument("--extract_instrumental", action="store_true")
parser.add_argument("--force_cpu", action="store_true")
args, unknown = parser.parse_known_args()

print("[TEST-MOCK] Script started.", flush=True)
print('VMAP_PROGRESS {"progress": 10, "message": "Starting separation"}', flush=True)
time.sleep(0.1)
print('VMAP_PROGRESS {"progress": 50, "stage": "Processing vocals"}', flush=True)
time.sleep(0.1)
print('VMAP_PROGRESS {"progress": 90, "message": "Finalizing output"}', flush=True)
time.sleep(0.1)

# Write dummy files to the output folder expected by the Rust side
out_dir = os.path.join(args.store_dir, "input")
os.makedirs(out_dir, exist_ok=True)
with open(os.path.join(out_dir, "vocals.wav"), "w") as f:
    f.write("mock vocals")
with open(os.path.join(out_dir, "instrumental.wav"), "w") as f:
    f.write("mock instrumental")

sys.exit(0)
"#;
    fs::write(&inference_script, mock_py).unwrap();

    // Setup isolation env variable for license check to succeed
    let temp_dir = std::env::temp_dir();
    let test_data_dir = temp_dir.join("vmap_subproc_test_data");
    let _ = fs::create_dir_all(&test_data_dir);
    std::env::set_var("VOCALMAP_DATA_DIR", test_data_dir.to_string_lossy().to_string());

    // Create a dummy input WAV file
    let dummy_input = test_data_dir.join("test_input.wav");
    fs::write(&dummy_input, "dummy wav header and content").unwrap();

    // Mock/Real Tauri application setup with Wry runtime
    let app = tauri::Builder::default()
        .setup(|app| {
            app.manage(AppState::new());
            Ok(())
        })
        .build(tauri::generate_context!())
        .unwrap();
    let state = app.state::<AppState>();

    // Call the tauri command vmap_separate_audio
    let res = vmap_separate_audio(
        app.handle().clone(),
        state.clone(),
        dummy_input.to_string_lossy().to_string(),
        "bs_roformer_karaoke".to_string(),
        true,
    );

    assert!(res.is_ok(), "Failed to call vmap_separate_audio: {:?}", res);
    let res_val = res.unwrap();
    let task_id = res_val.get("task_id").unwrap().as_str().unwrap().to_string();

    println!("Triggered separation task: {}", task_id);

    // Poll the separation task status from State
    let mut completed = false;
    let mut progress_history = Vec::new();
    let max_polls = 50; // 50 * 100ms = 5 seconds max

    for _ in 0..max_polls {
        thread::sleep(Duration::from_millis(100));
        let tasks = state.separation_tasks.lock().unwrap();
        if let Some(task) = tasks.get(&task_id) {
            progress_history.push(task.progress);
            if task.status == "completed" {
                completed = true;
                break;
            } else if task.status == "error" {
                panic!("Task failed with error: {:?}", task.error);
            }
        }
    }

    assert!(completed, "Task did not complete within the timeout!");

    // Verify task state properties after completion
    let tasks = state.separation_tasks.lock().unwrap();
    let task = tasks.get(&task_id).unwrap();

    println!("Task final logs: {:?}", task.logs);
    println!("Progress history: {:?}", progress_history);

    // Assert progress reached 100
    assert_eq!(task.progress, 100);
    assert_eq!(task.status, "completed");
    assert_eq!(task.status_text, "分离完成");

    // Check that we captured our VMAP_PROGRESS messages in logs
    let logs_str = task.logs.join("\n");
    assert!(logs_str.contains("Starting separation"), "Log missing 'Starting separation'");
    assert!(logs_str.contains("Processing vocals"), "Log missing 'Processing vocals'");
    assert!(logs_str.contains("Finalizing output"), "Log missing 'Finalizing output'");

    // Verify stems were parsed and stored
    let stems = task.stems.as_ref().expect("Stems should be populated");
    assert!(stems.contains_key("vocals"), "vocals stem missing");
    assert!(stems.contains_key("instrumental"), "instrumental stem missing");

    // Cleanup temp directory
    let _ = fs::remove_dir_all(&test_data_dir);
}
