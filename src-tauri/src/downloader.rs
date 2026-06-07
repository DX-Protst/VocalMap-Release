use tauri::{AppHandle, Emitter, command, Manager};
use std::path::PathBuf;
use std::fs;
use reqwest::blocking::Client;
use std::io::Write;

#[command]
pub fn check_dependencies(app: AppHandle) -> bool {
    let resolver = app.path();
    let root_dir = resolver.resource_dir().unwrap_or_else(|_| PathBuf::from(""));
    
    let runtime_path = if cfg!(debug_assertions) {
        std::env::current_dir().unwrap().join("../python_runtime")
    } else {
        root_dir.join("_up_").join("python_runtime")
    };
    
    let app_data_dir = app.path().app_data_dir().unwrap_or_else(|_| PathBuf::from(""));
    let model_dir = app_data_dir.join("model");
    let site_packages_dir = app_data_dir.join("site-packages");
    let torch_check = site_packages_dir.join("torch");
    
    let python_exe = runtime_path.join("python.exe");
    let model1 = model_dir.join("logic_roformer.ckpt");
    let model2 = model_dir.join("bs_roformer_karaoke_frazer_becruily.ckpt");

    python_exe.exists() && model1.exists() && model2.exists() && torch_check.exists()
}

#[derive(Clone, serde::Serialize)]
struct ProgressPayload {
    message: String,
    percent: f64,
}

fn emit_progress(app: &AppHandle, msg: &str, pct: f64) {
    let _ = app.emit("download-progress", ProgressPayload {
        message: msg.to_string(),
        percent: pct,
    });
}

#[derive(Clone, serde::Serialize)]
struct ConsolePayload {
    line: String,
}

fn emit_console(app: &AppHandle, line: &str) {
    let _ = app.emit("download-console", ConsolePayload {
        line: line.to_string(),
    });
}

#[command]
pub async fn start_download(app: AppHandle) -> Result<serde_json::Value, String> {
    let resolver = app.path();
    let root_dir = resolver.resource_dir().unwrap_or_else(|_| PathBuf::from(""));
    
    let runtime_path = if cfg!(debug_assertions) {
        std::env::current_dir().unwrap().join("../python_runtime")
    } else {
        root_dir.join("_up_").join("python_runtime")
    };
    
    let app_data_dir = app.path().app_data_dir().unwrap_or_else(|_| PathBuf::from(""));
    let model_dir = app_data_dir.join("model");
    let site_packages_dir = app_data_dir.join("site-packages");
    
    if !model_dir.exists() {
        fs::create_dir_all(&model_dir).map_err(|e| e.to_string())?;
    }

    let python_exe = runtime_path.join("python.exe");
    let model1 = model_dir.join("logic_roformer.ckpt");
    let model2 = model_dir.join("bs_roformer_karaoke_frazer_becruily.ckpt");

    // Step 1: Install PyTorch
    emit_progress(&app, "正在下载核心引擎 (约5GB)... (此过程较长，进度条暂不变化，请耐心等待)", 10.0);
    emit_console(&app, "准备执行 pip install...");
    
    use std::process::{Command, Stdio};
    #[cfg(target_os = "windows")]
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    let mut cmd = Command::new(&python_exe);
    cmd.args([
        "-m", "pip", "install", 
        "torch", "torchvision", "torchaudio", 
        "--index-url", "https://mirrors.aliyun.com/pypi/simple/", 
        "--extra-index-url", "https://mirrors.aliyun.com/pytorch-wheels/cu118/",
        "--target", site_packages_dir.to_str().unwrap()
    ]);
    
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn pip: {}", e))?;

    let app_clone = app.clone();
    if let Some(stdout) = child.stdout.take() {
        std::thread::spawn(move || {
            use std::io::{BufRead, BufReader};
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                if let Ok(l) = line {
                    emit_console(&app_clone, &l);
                }
            }
        });
    }

    let app_clone2 = app.clone();
    if let Some(stderr) = child.stderr.take() {
        std::thread::spawn(move || {
            use std::io::{BufRead, BufReader};
            let reader = BufReader::new(stderr);
            for line in reader.lines() {
                if let Ok(l) = line {
                    emit_console(&app_clone2, &l);
                }
            }
        });
    }

    let status = child.wait().map_err(|e| format!("Failed to wait for pip: {}", e))?;

    if !status.success() {
        emit_console(&app, "Pip install failed with non-zero exit code.");
        return Err("Pip install failed".into());
    }
    
    emit_console(&app, "Pip install success.");

    // Step 2: Download models
    let client = Client::new();
    
    if !model1.exists() {
        download_file(&client, &app, "https://hf-mirror.com/ChanTrail/BS-RoFormer/resolve/main/logic_bs_roformer.ckpt", &model1, "正在下载 6轨道模型 (699MB)...", 70.0, 0.15)?;
    }
    
    if !model2.exists() {
        download_file(&client, &app, "https://hf-mirror.com/becruily/bs-roformer-karaoke/resolve/main/bs_roformer_karaoke_frazer_becruily.ckpt", &model2, "正在下载 卡拉OK模型 (204MB)...", 85.0, 0.15)?;
    }

    emit_progress(&app, "所有环境与模型下载完成！", 100.0);

    Ok(serde_json::json!({ "success": true }))
}

fn download_file(client: &Client, app: &AppHandle, url: &str, dest: &PathBuf, msg_prefix: &str, base_pct: f64, weight: f64) -> Result<(), String> {
    let mut response = client.get(url).send().map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("Failed to download {}: {}", url, response.status()));
    }
    
    let total_size = response.content_length().unwrap_or(0);
    let mut file = fs::File::create(dest).map_err(|e| e.to_string())?;
    
    let mut downloaded: u64 = 0;
    let mut buffer = [0; 8192];
    
    use std::io::Read;
    while let Ok(n) = response.read(&mut buffer) {
        if n == 0 { break; }
        file.write_all(&buffer[..n]).map_err(|e| e.to_string())?;
        downloaded += n as u64;
        
        if total_size > 0 {
            let pct = (downloaded as f64 / total_size as f64) * 100.0;
            emit_progress(app, msg_prefix, base_pct + pct * weight);
        }
    }
    
    Ok(())
}
