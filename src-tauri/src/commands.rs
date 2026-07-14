use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, State, Emitter};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SeparationTask {
    pub task_id: String,
    pub status: String,
    pub progress: u32,
    pub status_text: String,
    pub logs: Vec<String>,
    pub updated_at: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stems: Option<HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_dir: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct StreamState {
    pub is_recording: bool,
    pub audio_buffer: Vec<u8>,
}

#[derive(Clone)]
pub struct AppState {
    pub analyzer: Arc<Mutex<crate::dsp::metrics::VocalAnalyzer>>,
    pub stream_state: Arc<Mutex<StreamState>>,
    pub separation_tasks: Arc<Mutex<HashMap<String, SeparationTask>>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            analyzer: Arc::new(Mutex::new(crate::dsp::metrics::VocalAnalyzer::new(44100.0, 500.0))),
            stream_state: Arc::new(Mutex::new(StreamState {
                is_recording: false,
                audio_buffer: Vec::new(),
            })),
            separation_tasks: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

pub fn get_data_dir(app_handle: &AppHandle) -> PathBuf {
    if let Ok(path_str) = std::env::var("VOCALMAP_DATA_DIR") {
        if !path_str.is_empty() {
            return PathBuf::from(path_str);
        }
    }
    app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from(""))
}

pub fn get_backend_dir(app_handle: &AppHandle) -> PathBuf {
    // 之前用于指向 Python backend 目录，现在后端已迁移至 Rust，
    // license.key 统一放在数据目录 (AppData) 中。
    let dir = get_data_dir(app_handle);
    let _ = std::fs::create_dir_all(&dir);
    dir
}

fn now_secs() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}

fn clean_path_for_python(path: &Path) -> String {
    let s = path.to_string_lossy().to_string();
    if s.starts_with(r"\\?\") {
        s[4..].to_string()
    } else {
        s
    }
}

fn generate_task_id() -> String {
    use std::time::SystemTime;
    let seed = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let mut state = seed;
    let mut token = String::new();
    for _ in 0..8 {
        state = state.wrapping_mul(6364136223846793005).wrapping_add(1);
        let val = (state >> 32) as u32;
        let char_code = (val % 36) as u8;
        let c = match char_code {
            0..=9 => b'0' + char_code,
            _ => b'a' + (char_code - 10),
        };
        token.push(c as char);
    }
    token
}

struct ModelInfo {
    config_path: &'static str,
    ckpt_path: &'static str,
    instruments: &'static [&'static str],
    extract_instrumental: bool,
}

fn get_model_registry_info(model_key: &str) -> Option<ModelInfo> {
    match model_key {
        "logic_roformer_6s" => Some(ModelInfo {
            config_path: "logic_bsroformer/configs/logic_pro_config_v1.yaml",
            ckpt_path: "model/logic_roformer.ckpt",
            instruments: &["bass", "drums", "other", "vocals", "guitar", "piano", "instrumental"],
            extract_instrumental: true,
        }),
        "bs_roformer_karaoke" => Some(ModelInfo {
            config_path: "logic_bsroformer/configs/config_karaoke_frazer_becruily.yaml",
            ckpt_path: "model/bs_roformer_karaoke_frazer_becruily.ckpt",
            instruments: &["vocals", "instrumental"],
            extract_instrumental: true,
        }),
        _ => None,
    }
}

// ---------- 1. License & Activation Commands ----------

#[tauri::command]
pub fn vmap_get_license_status(app_handle: AppHandle, machine_id: String) -> serde_json::Value {
    let data_dir = get_data_dir(&app_handle);
    let backend_dir = get_backend_dir(&app_handle);

    let cloud_url = std::env::var("VMAP_CLOUD_URL").unwrap_or_else(|_| "http://66.112.209.251:8000".to_string());
    let url = format!("{}/api/verify_license?machine_id={}", cloud_url, urlencoding::encode(&machine_id));

    // Try online verification first
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build();
    if let Ok(cl) = client {
        if let Ok(resp) = cl.get(&url).send() {
            if let Ok(data) = resp.json::<serde_json::Value>() {
                if data.get("valid").and_then(|v| v.as_bool()).unwrap_or(false) {
                    if let (Some(payload), Some(signature)) = (data.get("license_payload"), data.get("license_signature")) {
                        let license_path = backend_dir.join("license.key");
                        let license_obj = serde_json::json!({
                            "license_payload": payload,
                            "license_signature": signature
                        });
                        if let Ok(license_str) = serde_json::to_string(&license_obj) {
                            let _ = std::fs::write(&license_path, license_str);
                        }
                    }
                }
                return data;
            }
        }
    }

    // Offline fallback
    match crate::license_verifier::verify::verify_pro_license(&data_dir, &backend_dir, &machine_id) {
        Ok(payload) => {
            serde_json::json!({
                "valid": true,
                "plan_type": payload.get("plan_type"),
                "expires_at": payload.get("expires_at"),
                "message": "许可证有效 (离线验证)"
            })
        }
        Err(err) => {
            serde_json::json!({
                "valid": false,
                "message": err
            })
        }
    }
}

#[tauri::command]
pub fn vmap_activate_license(app_handle: AppHandle, cdk: String, machine_id: String, overwrite: Option<bool>) -> serde_json::Value {
    let backend_dir = get_backend_dir(&app_handle);
    let cloud_url = std::env::var("VMAP_CLOUD_URL").unwrap_or_else(|_| "http://66.112.209.251:8000".to_string());
    let url = format!("{}/api/activate_cdk", cloud_url);

    let body = serde_json::json!({
        "cdk": cdk,
        "machine_id": machine_id,
        "overwrite": overwrite.unwrap_or(false)
    });

    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build();
    match client {
        Ok(cl) => {
            match cl.post(&url)
                .header("X-VocalMap-Platform", "desktop")
                .json(&body)
                .send() {
                Ok(resp) => {
                    if let Ok(data) = resp.json::<serde_json::Value>() {
                        if data.get("success").and_then(|v| v.as_bool()).unwrap_or(false) {
                            if let (Some(payload), Some(signature)) = (data.get("license_payload"), data.get("license_signature")) {
                                let license_path = backend_dir.join("license.key");
                                let license_obj = serde_json::json!({
                                    "license_payload": payload,
                                    "license_signature": signature
                                });
                                if let Ok(license_str) = serde_json::to_string(&license_obj) {
                                    let _ = std::fs::write(&license_path, license_str);
                                }
                            }
                        }
                        return data;
                    }
                    serde_json::json!({
                        "success": false,
                        "message": "激活响应解析失败"
                    })
                }
                Err(err) => {
                    serde_json::json!({
                        "success": false,
                        "message": format!("无法连接许可证服务器: {}", err)
                    })
                }
            }
        }
        Err(e) => {
            serde_json::json!({
                "success": false,
                "message": format!("构建 HTTP 客户端失败: {}", e)
            })
        }
    }
}

#[tauri::command]
pub fn vmap_deactivate_license(app_handle: AppHandle, machine_id: String) -> serde_json::Value {
    let backend_dir = get_backend_dir(&app_handle);
    let cloud_url = std::env::var("VMAP_CLOUD_URL").unwrap_or_else(|_| "http://66.112.209.251:8000".to_string());
    let url = format!("{}/api/deactivate_device", cloud_url);

    let body = serde_json::json!({
        "machine_id": machine_id
    });

    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build();
        
    let result = match client {
        Ok(cl) => {
            match cl.post(&url).json(&body).send() {
                Ok(resp) => {
                    if let Ok(data) = resp.json::<serde_json::Value>() {
                        data
                    } else {
                        serde_json::json!({
                            "success": false,
                            "message": "解绑响应解析失败"
                        })
                    }
                }
                Err(err) => {
                    serde_json::json!({
                        "success": false,
                        "message": format!("无法连接许可证服务器: {}", err)
                    })
                }
            }
        }
        Err(e) => {
            serde_json::json!({
                "success": false,
                "message": format!("构建 HTTP 客户端失败: {}", e)
            })
        }
    };
    
    let success = result.get("success").and_then(|v| v.as_bool()).unwrap_or(false);
    if success {
        let license_path = backend_dir.join("license.key");
        if license_path.exists() {
            let _ = std::fs::remove_file(license_path);
        }
    }
    
    result
}

// ---------- 2. Offline Analysis Commands ----------

#[tauri::command]
pub async fn vmap_analyze_buffer(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    buffer: Vec<u8>,
) -> Result<serde_json::Value, String> {
    let data_dir = get_data_dir(&app_handle);
    let backend_dir = get_backend_dir(&app_handle);

    // Check license first
    let machine_id = crate::internal_get_machine_id(&app_handle);
    let _payload = crate::license_verifier::verify::verify_pro_license(&data_dir, &backend_dir, &machine_id)
        .map_err(|e| e)?;

    let (loudness_gate, clarity_threshold, noise_silence_threshold, sample_rate) = {
        let analyzer_lock = state.analyzer.lock().unwrap();
        (
            analyzer_lock.loudness_gate,
            analyzer_lock.clarity_threshold,
            analyzer_lock.noise_silence_threshold,
            analyzer_lock.sample_rate,
        )
    };

    let report = tauri::async_runtime::spawn_blocking(move || {
        crate::dsp::metrics::generate_comprehensive_report(
            &buffer,
            loudness_gate,
            clarity_threshold,
            noise_silence_threshold,
            sample_rate,
            2048,
        )
    })
    .await
    .map_err(|e| format!("Analysis task failed: {}", e))?;

    Ok(serde_json::to_value(report).unwrap())
}

// ---------- 3. Source Separation Commands ----------
#[tauri::command]
#[allow(unused_variables, unreachable_code)]
pub fn vmap_separate_audio(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    file_path: String,
    model_key: String,
    force_cpu: bool,
) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "android")]
    {
        return Err("移动端不支持AI音轨分离功能".to_string());
    }
    let data_dir = get_data_dir(&app_handle);
    let backend_dir = get_backend_dir(&app_handle);

    // Check license first
    let machine_id = crate::internal_get_machine_id(&app_handle);
    let _payload = crate::license_verifier::verify::verify_pro_license(&data_dir, &backend_dir, &machine_id)
        .map_err(|e| e)?;

    let model_info = get_model_registry_info(&model_key)
        .ok_or_else(|| format!("Unknown model key: {}", model_key))?;

    let resolver = app_handle.path();
    let root_dir = resolver.resource_dir().unwrap_or_else(|_| PathBuf::from(""));
    let root_dir = if cfg!(debug_assertions) {
        std::env::current_dir().unwrap().join("..")
    } else {
        root_dir.join("_up_")
    };

    let python_exe = data_dir.join("python_runtime").join("python.exe");
    let inference_script = root_dir.join("logic_bsroformer").join("inference.py");
    let model_dir = std::env::var("VOCALMAP_MODEL_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| data_dir.join("model"));

    let ckpt_name = Path::new(model_info.ckpt_path).file_name().unwrap();
    let ckpt_path = model_dir.join(ckpt_name);

    let config_path = if model_info.config_path.starts_with("model/") {
        let config_name = Path::new(model_info.config_path).file_name().unwrap();
        model_dir.join(config_name)
    } else {
        root_dir.join(model_info.config_path.replace("/", "\\"))
    };

    let task_id = generate_task_id();
    let temp_dir = std::env::temp_dir();
    let task_dir = temp_dir.join(format!("vocalmap_sep_{}", task_id));
    std::fs::create_dir_all(&task_dir).map_err(|e| format!("Failed to create task dir: {}", e))?;

    let src_path = Path::new(&file_path);
    let ext = src_path.extension().and_then(|e| e.to_str()).unwrap_or("wav");
    let input_name = format!("input.{}", ext);
    let copied_input_path = task_dir.join(&input_name);
    std::fs::copy(&file_path, &copied_input_path)
        .map_err(|e| format!("Failed to copy input file: {}", e))?;

    let output_dir = task_dir.join("output");

    let initial_task = SeparationTask {
        task_id: task_id.clone(),
        status: "processing".to_string(),
        progress: 0,
        status_text: "任务已创建，正在准备分离引擎...".to_string(),
        logs: vec![format!(
            "Task {} created. Input file copied to {}",
            task_id,
            clean_path_for_python(&copied_input_path)
        )],
        updated_at: now_secs(),
        stems: None,
        output_dir: Some(clean_path_for_python(&output_dir)),
        error: None,
    };

    {
        let mut tasks = state.separation_tasks.lock().unwrap();
        tasks.insert(task_id.clone(), initial_task);
    }

    // Spawn background execution
    let app_handle_clone = app_handle.clone();
    let state_clone = state.inner().clone();
    let task_id_clone = task_id.clone();
    let _model_key_clone = model_key.clone();

    std::thread::spawn(move || {
        let run_separation = || -> Result<HashMap<String, String>, String> {
            let python_exe_clean = clean_path_for_python(&python_exe);
            let mut cmd = std::process::Command::new(&python_exe_clean);
            cmd.args(&[
                "-B",
                "-u",
                &clean_path_for_python(&inference_script),
                "--model_type",
                "bs_roformer",
                "--config_path",
                &clean_path_for_python(&config_path),
                "--start_check_point",
                &clean_path_for_python(&ckpt_path),
                "--input_folder",
                &clean_path_for_python(&task_dir),
                "--store_dir",
                &clean_path_for_python(&output_dir),
            ]);
            if model_info.extract_instrumental {
                cmd.arg("--extract_instrumental");
            }
            if force_cpu {
                cmd.arg("--force_cpu");
            }

            let logic_dir = root_dir.join("logic_bsroformer");
            let data_dir = get_data_dir(&app_handle_clone);
            let site_packages = data_dir.join("site-packages");
            let mut path_var = format!("{};{}", clean_path_for_python(&logic_dir), clean_path_for_python(&site_packages));
            if let Ok(existing) = std::env::var("PYTHONPATH") {
                path_var = format!("{};{}", path_var, existing);
            }
            cmd.env("PYTHONPATH", path_var);
            cmd.env("PYTHONUNBUFFERED", "1");
            cmd.env("PYTHONIOENCODING", "utf-8");

            cmd.stdout(std::process::Stdio::piped());
            cmd.stderr(std::process::Stdio::piped());
            #[cfg(target_os = "windows")]
            {
                use std::os::windows::process::CommandExt;
                cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
            }

            let mut child = cmd.spawn().map_err(|e| format!("[VMAP_V2_FIXED] Failed to spawn Python process: {} | Executable: {}", e, python_exe_clean))?;

            // Read lines and parse progress
            let stdout = child.stdout.take().unwrap();
            let reader = std::io::BufReader::new(stdout);
            use std::io::BufRead;

            for line_res in reader.lines() {
                if let Ok(line) = line_res {
                    let clean_line = line.trim();
                    if clean_line.is_empty() {
                        continue;
                    }

                    let mut progress_update = None;
                    let mut status_update = None;

                    if let Some(idx) = clean_line.find("VMAP_PROGRESS ") {
                        let json_str = &clean_line[idx + "VMAP_PROGRESS ".len()..];
                        if let Ok(payload) = serde_json::from_str::<serde_json::Value>(json_str) {
                            if let Some(p) = payload.get("progress").and_then(|v| v.as_u64()) {
                                progress_update = Some(p as u32);
                            }
                            if let Some(msg) = payload.get("message").and_then(|v| v.as_str()) {
                                status_update = Some(msg.to_string());
                            } else if let Some(stage) = payload.get("stage").and_then(|v| v.as_str()) {
                                status_update = Some(stage.to_string());
                            }
                        }
                    } else if clean_line.contains("Error") || clean_line.contains("Traceback") || clean_line.contains("Errno") || clean_line.contains("can't open file") {
                        let mut tasks = state_clone.separation_tasks.lock().unwrap();
                        if let Some(t) = tasks.get_mut(&task_id_clone) {
                            t.error = Some(format!("[VMAP_V2_FIXED] {}", clean_line));
                        }
                    }

                    // Update task logs and state in database
                    {
                        let mut tasks = state_clone.separation_tasks.lock().unwrap();
                        if let Some(t) = tasks.get_mut(&task_id_clone) {
                            t.logs.push(clean_line.to_string());
                            if let Some(p) = progress_update {
                                t.progress = p;
                            }
                            if let Some(ref st) = status_update {
                                t.status_text = st.clone();
                            }
                            t.updated_at = now_secs();
                            let _ = app_handle_clone.emit("separation-progress", t.clone());
                        }
                    }
                }
            }

            let status = child.wait().map_err(|e| format!("Process wait failed: {}", e))?;
            if !status.success() {
                // Read stderr to report errors
                let mut err_msg = "Python process exited with error status".to_string();
                if let Some(mut stderr) = child.stderr.take() {
                    let mut err_str = String::new();
                    use std::io::Read;
                    let _ = stderr.read_to_string(&mut err_str);
                    if !err_str.is_empty() {
                        err_msg = format!("{}: {}", err_msg, err_str);
                    }
                }
                return Err(err_msg);
            }

            // Collect stems
            // Outputs are in output_dir / "input" / "{instr}.wav"
            let out_folder = output_dir.join("input");
            let mut stems = HashMap::new();
            for &instr in model_info.instruments {
                let path_lower = out_folder.join(format!("{}.wav", instr.to_lowercase()));
                let path_cap = out_folder.join(format!("{}.wav", uppercase_first(instr)));
                
                if path_lower.exists() {
                    stems.insert(instr.to_string(), path_lower.to_string_lossy().to_string());
                } else if path_cap.exists() {
                    stems.insert(instr.to_string(), path_cap.to_string_lossy().to_string());
                } else {
                    // Check output folder directly if missing
                    let p2_lower = output_dir.join(format!("{}.wav", instr.to_lowercase()));
                    let p2_cap = output_dir.join(format!("{}.wav", uppercase_first(instr)));
                    if p2_lower.exists() {
                        stems.insert(instr.to_string(), p2_lower.to_string_lossy().to_string());
                    } else if p2_cap.exists() {
                        stems.insert(instr.to_string(), p2_cap.to_string_lossy().to_string());
                    }
                }
            }
            stems.insert("_mix".to_string(), file_path.clone());
            Ok(stems)
        };

        match run_separation() {
            Ok(stems) => {
                let mut tasks = state_clone.separation_tasks.lock().unwrap();
                if let Some(t) = tasks.get_mut(&task_id_clone) {
                    t.status = "completed".to_string();
                    t.progress = 100;
                    t.status_text = "分离完成".to_string();
                    t.stems = Some(stems);
                    t.updated_at = now_secs();
                    let _ = app_handle_clone.emit("separation-progress", t.clone());
                }
            }
            Err(e) => {
                let mut tasks = state_clone.separation_tasks.lock().unwrap();
                if let Some(t) = tasks.get_mut(&task_id_clone) {
                    t.status = "error".to_string();
                    t.status_text = "分离出错".to_string();
                    t.error = Some(e);
                    t.updated_at = now_secs();
                    let _ = app_handle_clone.emit("separation-progress", t.clone());
                }
            }
        }
    });

    Ok(serde_json::json!({
        "task_id": task_id,
        "status": "processing",
        "worker_started": true,
        "progress_protocol": "threaded-progress-v2"
    }))
}

fn uppercase_first(s: &str) -> String {
    let mut c = s.chars();
    match c.next() {
        None => String::new(),
        Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
    }
}

#[tauri::command]
pub fn vmap_get_separation_task(
    state: State<'_, AppState>,
    task_id: String,
) -> Result<serde_json::Value, String> {
    let tasks = state.separation_tasks.lock().unwrap();
    if let Some(task) = tasks.get(&task_id) {
        Ok(serde_json::to_value(task).unwrap())
    } else {
        Err("Task not found".to_string())
    }
}

#[tauri::command]
pub fn vmap_save_separation_to_disk(
    state: State<'_, AppState>,
    task_id: String,
    stem: String,
    save_path: String,
) -> Result<serde_json::Value, String> {
    let tasks = state.separation_tasks.lock().unwrap();
    let task = tasks.get(&task_id).ok_or_else(|| "Task not found".to_string())?;
    if task.status != "completed" {
        return Err("Task not completed".to_string());
    }
    let stems = task.stems.as_ref().ok_or_else(|| "Stems not found".to_string())?;
    let src_path = stems.get(&stem).ok_or_else(|| format!("Stem {} not found", stem))?;

    std::fs::copy(src_path, &save_path).map_err(|e| format!("Failed to copy file: {}", e))?;

    Ok(serde_json::json!({ "status": "success" }))
}

#[tauri::command]
pub fn vmap_export_tmap(
    state: State<'_, AppState>,
    task_id: String,
    save_path: String,
) -> Result<serde_json::Value, String> {
    let tasks = state.separation_tasks.lock().unwrap();
    let task = tasks.get(&task_id).ok_or_else(|| "Task not found".to_string())?;
    if task.status != "completed" {
        return Err("Task not completed".to_string());
    }
    let stems = task.stems.as_ref().ok_or_else(|| "Stems not found".to_string())?;
    let vocals_path = stems
        .get("vocals")
        .or_else(|| stems.get("Vocals"))
        .ok_or_else(|| "Vocals stem not found".to_string())?;
    let inst_path = stems
        .get("instrumental")
        .or_else(|| stems.get("Instrumental"))
        .ok_or_else(|| "Instrumental stem not found".to_string())?;

    let blocks = crate::dsp::metrics::generate_quantized_pitch_track(vocals_path, 44100.0, 2048);
    if blocks.is_empty() {
        return Err("音高提取失败或数据太短".to_string());
    }

    let blocks_str = serde_json::to_string(&blocks).map_err(|e| e.to_string())?;
    std::fs::write(&save_path, blocks_str).map_err(|e| format!("Failed to write tmap: {}", e))?;

    let webm_path = save_path.replace(".tmap", "") + ".webm";
    std::fs::copy(inst_path, &webm_path).map_err(|e| format!("Failed to copy webm: {}", e))?;

    Ok(serde_json::json!({
        "status": "success",
        "tmap_path": save_path,
        "webm_path": webm_path
    }))
}

#[tauri::command]
pub fn vmap_export_vmap(
    state: State<'_, AppState>,
    task_id: String,
    save_path: String,
) -> Result<serde_json::Value, String> {
    let tasks = state.separation_tasks.lock().unwrap();
    let task = tasks.get(&task_id).ok_or_else(|| "Task not found".to_string())?;
    if task.status != "completed" {
        return Err("Task not completed".to_string());
    }
    let stems = task.stems.as_ref().ok_or_else(|| "Stems not found".to_string())?;
    let vocals_path = stems
        .get("vocals")
        .or_else(|| stems.get("Vocals"))
        .ok_or_else(|| "Vocals stem not found".to_string())?;
    let inst_path = stems
        .get("instrumental")
        .or_else(|| stems.get("Instrumental"))
        .ok_or_else(|| "Instrumental stem not found".to_string())?;

    let timeline = crate::dsp::metrics::generate_continuous_pitch_track(vocals_path, 44100.0, 2048);
    if timeline.is_empty() {
        return Err("音高提取失败或数据太短".to_string());
    }

    let timeline_obj = serde_json::json!({
        "status": "success",
        "timeline": timeline
    });
    let timeline_str = serde_json::to_string(&timeline_obj).map_err(|e| e.to_string())?;
    std::fs::write(&save_path, timeline_str).map_err(|e| format!("Failed to write vmap: {}", e))?;

    let webm_path = save_path.replace(".vmap", "") + ".webm";
    std::fs::copy(inst_path, &webm_path).map_err(|e| format!("Failed to copy webm: {}", e))?;

    Ok(serde_json::json!({
        "status": "success",
        "vmap_path": save_path,
        "webm_path": webm_path
    }))
}

#[tauri::command]
pub fn vmap_convert_process(
    target_format: String,
    save_path: Option<String>,
    source_path: Option<String>,
    webm_source_path: Option<String>,
) -> Result<serde_json::Value, String> {
    let source = source_path.ok_or_else(|| "No source_path provided".to_string())?;
    let source_path_obj = Path::new(&source);
    if !source_path_obj.exists() {
        return Err("Source file does not exist".to_string());
    }

    let ext = source_path_obj
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_lowercase())
        .unwrap_or_default();

    let mut result = serde_json::json!({});

    if ext == "wav" || ext == "mp3" || ext == "flac" {
        if target_format == "tmap" {
            let data = crate::dsp::metrics::generate_quantized_pitch_track(&source, 44100.0, 2048);
            result = serde_json::json!({
                "status": "success",
                "data": {
                    "status": "success",
                    "blocks": data
                },
                "ext": "tmap"
            });
        } else if target_format == "vmap" {
            let data = crate::dsp::metrics::generate_continuous_pitch_track(&source, 44100.0, 2048);
            result = serde_json::json!({
                "status": "success",
                "data": {
                    "status": "success",
                    "timeline": data
                },
                "ext": "vmap"
            });
        } else {
            return Err(format!("Unsupported target format: {}", target_format));
        }
    } else if ext == "vmap" && target_format == "tmap" {
        // .vmap -> .tmap conversion
        let vmap_content =
            std::fs::read_to_string(&source).map_err(|e| format!("Failed to read vmap: {}", e))?;
        let vmap_data: serde_json::Value =
            serde_json::from_str(&vmap_content).map_err(|e| format!("Invalid vmap JSON: {}", e))?;

        let timeline_val = if vmap_data.is_object() && vmap_data.get("timeline").is_some() {
            vmap_data.get("timeline").unwrap()
        } else {
            &vmap_data
        };

        let timeline: Vec<crate::dsp::metrics::TimelinePoint> = serde_json::from_value(timeline_val.clone())
            .map_err(|e| format!("Invalid timeline structure: {}", e))?;

        let mut midis = Vec::new();
        let mut times = Vec::new();
        for point in &timeline {
            times.push(point.time);
            let pitch_hz = point.pitch;
            if pitch_hz > 0.0 {
                midis.push(69.0 + 12.0 * (pitch_hz / 440.0).log2());
            } else {
                midis.push(0.0);
            }
        }

        let filtered = crate::dsp::metrics::medfilt_1d(&midis, 7);

        let mut quantized = vec![0.0; filtered.len()];
        let mut current_q = 0.0;
        for i in 0..filtered.len() {
            let raw = filtered[i];
            if raw == 0.0 {
                current_q = 0.0;
                quantized[i] = 0.0;
            } else {
                if current_q == 0.0 {
                    current_q = raw.round();
                } else {
                    if (raw - current_q).abs() > 0.8 {
                        current_q = raw.round();
                    }
                }
                quantized[i] = current_q;
            }
        }

        let mut blocks = Vec::new();
        let mut current_midi = 0.0;
        let mut start_time = 0.0;

        for i in 0..times.len() {
            let m = quantized[i];
            let t = times[i] / 1000.0;
            if m != current_midi {
                if current_midi > 0.0 {
                    let duration = (t - start_time).max(0.0);
                    let block_type = if current_midi < 65.0 {
                        "chest"
                    } else if current_midi > 72.0 {
                        "head"
                    } else {
                        "mixed"
                    };
                    blocks.push(crate::dsp::metrics::QuantizedBlock {
                        start_time: (start_time * 1000.0).round() / 1000.0,
                        duration: (duration * 1000.0).round() / 1000.0,
                        midi: current_midi as i32,
                        block_type: block_type.to_string(),
                        instruction: "".to_string(),
                    });
                }
                current_midi = m;
                start_time = t;
            }
        }

        if current_midi > 0.0 {
            let last_time = times.last().copied().unwrap_or(0.0) / 1000.0;
            let duration = (last_time - start_time).max(0.0);
            let block_type = if current_midi < 65.0 {
                "chest"
            } else if current_midi > 72.0 {
                "head"
            } else {
                "mixed"
            };
            blocks.push(crate::dsp::metrics::QuantizedBlock {
                start_time: (start_time * 1000.0).round() / 1000.0,
                duration: (duration * 1000.0).round() / 1000.0,
                midi: current_midi as i32,
                block_type: block_type.to_string(),
                instruction: "".to_string(),
            });
        }

        let mut merged_blocks = Vec::new();
        for b in blocks {
            if merged_blocks.is_empty() {
                merged_blocks.push(b);
                continue;
            }
            let prev_idx = merged_blocks.len() - 1;
            let prev_end: f64 = merged_blocks[prev_idx].start_time + merged_blocks[prev_idx].duration;
            let gap = b.start_time - prev_end;
            if merged_blocks[prev_idx].midi == b.midi && gap < 0.25 {
                let new_dur = b.start_time + b.duration - merged_blocks[prev_idx].start_time;
                merged_blocks[prev_idx].duration = (new_dur * 1000.0).round() / 1000.0;
            } else {
                merged_blocks.push(b);
            }
        }

        let final_blocks: Vec<crate::dsp::metrics::QuantizedBlock> = merged_blocks
            .into_iter()
            .filter(|b| b.duration >= 0.15)
            .collect();

        result = serde_json::json!({
            "status": "success",
            "data": {
                "status": "success",
                "blocks": final_blocks
            },
            "ext": "tmap"
        });
    } else if ext == "tmap" && target_format == "vmap" {
        // .tmap -> .vmap conversion
        let tmap_content =
            std::fs::read_to_string(&source).map_err(|e| format!("Failed to read tmap: {}", e))?;
        let tmap_data: serde_json::Value =
            serde_json::from_str(&tmap_content).map_err(|e| format!("Invalid tmap JSON: {}", e))?;

        let blocks_val = if tmap_data.is_object() && tmap_data.get("blocks").is_some() {
            tmap_data.get("blocks").unwrap()
        } else {
            &tmap_data
        };

        let blocks: Vec<crate::dsp::metrics::QuantizedBlock> = serde_json::from_value(blocks_val.clone())
            .map_err(|e| format!("Invalid blocks structure: {}", e))?;

        let mut timeline = Vec::new();
        let end_time = blocks
            .iter()
            .map(|b| b.start_time + b.duration)
            .fold(0.0f64, f64::max);

        let mut current_time = 0.0;
        let step = 0.0464;
        while current_time <= end_time {
            let mut pitch = 0.0;
            for b in &blocks {
                if current_time >= b.start_time && current_time <= (b.start_time + b.duration) {
                    let midi = b.midi;
                    pitch = 440.0 * (2.0f64.powf((midi as f64 - 69.0) / 12.0));
                    break;
                }
            }
            timeline.push(crate::dsp::metrics::TimelinePoint {
                time: (current_time * 1000.0 * 10.0).round() / 10.0,
                pitch: (pitch * 100.0).round() / 100.0,
            });
            current_time += step;
        }

        result = serde_json::json!({
            "status": "success",
            "data": {
                "status": "success",
                "timeline": timeline
            },
            "ext": "vmap"
        });
    } else {
        return Err(format!("Unsupported conversion: {} -> {}", ext, target_format));
    }

    if let Some(ref save) = save_path {
        let data_to_save = result.get("data").unwrap();
        let data_str = serde_json::to_string(data_to_save).map_err(|e| e.to_string())?;
        std::fs::write(save, data_str).map_err(|e| format!("Failed to write output file: {}", e))?;

        let webm_path = save.replace(&format!(".{}", target_format), ".webm");
        if let Some(ref webm_src) = webm_source_path {
            if std::path::Path::new(webm_src).exists() {
                let _ = std::fs::copy(webm_src, &webm_path);
            }
        } else if ext == "wav" || ext == "mp3" || ext == "flac" {
            let _ = std::fs::copy(&source, &webm_path);
        }

        return Ok(serde_json::json!({
            "status": "success",
            "saved_path": save
        }));
    }

    Ok(result)
}

// ---------- 4. Real-time Streaming Commands ----------

#[tauri::command]
pub fn vmap_stream_start_record(state: State<'_, AppState>) {
    let mut analyzer = state.analyzer.lock().unwrap();
    let mut stream = state.stream_state.lock().unwrap();
    stream.is_recording = true;
    stream.audio_buffer.clear();
    analyzer.reset_state();
}

#[tauri::command]
pub fn vmap_get_file_size(path: String) -> Result<u64, String> {
    std::fs::metadata(&path)
        .map(|m| m.len())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmap_stream_stop_record(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let (loudness_gate, clarity_threshold, noise_silence_threshold, sample_rate) = {
        let analyzer_lock = state.analyzer.lock().unwrap();
        (
            analyzer_lock.loudness_gate,
            analyzer_lock.clarity_threshold,
            analyzer_lock.noise_silence_threshold,
            analyzer_lock.sample_rate,
        )
    };

    let audio_bytes = {
        let mut stream = state.stream_state.lock().unwrap();
        stream.is_recording = false;
        std::mem::take(&mut stream.audio_buffer)
    };

    let report = tauri::async_runtime::spawn_blocking(move || {
        crate::dsp::metrics::generate_comprehensive_report(
            &audio_bytes,
            loudness_gate,
            clarity_threshold,
            noise_silence_threshold,
            sample_rate,
            2048,
        )
    })
    .await
    .map_err(|e| format!("Analysis task failed: {}", e))?;

    Ok(serde_json::to_value(report).unwrap())
}

#[tauri::command]
pub fn vmap_update_settings(state: State<'_, AppState>, settings: serde_json::Value) {
    let mut analyzer = state.analyzer.lock().unwrap();
    analyzer.update_settings(&settings);
}

#[tauri::command]
pub fn vmap_process_audio_chunk(
    state: State<'_, AppState>,
    chunk: Vec<i16>,
) -> Result<serde_json::Value, String> {
    // Convert Vec<i16> to raw bytes
    let mut audio_bytes = Vec::with_capacity(chunk.len() * 2);
    for &val in &chunk {
        audio_bytes.extend_from_slice(&val.to_ne_bytes());
    }

    let mut analyzer = state.analyzer.lock().unwrap();
    let sample_rate = analyzer.sample_rate;
    let res = analyzer.process_chunk(&audio_bytes, sample_rate);

    // If recording, accumulate
    {
        let mut stream = state.stream_state.lock().unwrap();
        if stream.is_recording {
            stream.audio_buffer.extend_from_slice(&audio_bytes);
        }
    }

    Ok(serde_json::to_value(res).unwrap())
}

#[tauri::command]
pub fn vmap_log(message: String) {
    eprintln!("[FRONTEND EXCEPTION] {}", message);
}

#[tauri::command]
pub fn vmap_request_payment<R: tauri::Runtime>(
    _app_handle: tauri::AppHandle<R>,
    plan_type: String,
    machine_id: String,
) -> serde_json::Value {
    let cloud_url = std::env::var("VMAP_CLOUD_URL").unwrap_or_else(|_| "http://66.112.209.251:8000".to_string());
    let url = format!("{}/api/create_order", cloud_url);

    let body = serde_json::json!({
        "plan_type": plan_type,
        "machine_id": machine_id
    });

    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build();

    match client {
        Ok(cl) => {
            match cl.post(&url)
                .header("X-VocalMap-Platform", "desktop")
                .json(&body)
                .send() {
                Ok(resp) => {
                    if let Ok(data) = resp.json::<serde_json::Value>() {
                        data
                    } else {
                        serde_json::json!({
                            "status": "error",
                            "message": "支付响应解析失败"
                        })
                    }
                }
                Err(err) => {
                    serde_json::json!({
                        "status": "error",
                        "message": format!("无法连接支付服务器: {}", err)
                    })
                }
            }
        }
        Err(e) => {
            serde_json::json!({
                "status": "error",
                "message": format!("构建 HTTP 客户端失败: {}", e)
            })
        }
    }
}
