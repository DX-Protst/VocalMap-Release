use tauri::{AppHandle, Emitter, command, Manager};
use std::path::PathBuf;
use std::fs;
use reqwest::blocking::Client;
use std::io::Write;

#[command]
pub fn check_dependencies(app: AppHandle) -> bool {
    let app_data_dir = app.path().app_data_dir().unwrap_or_else(|_| PathBuf::from(""));
    let runtime_path = app_data_dir.join("python_runtime");
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
    tauri::async_runtime::spawn_blocking(move || {
        let app_data_dir = app.path().app_data_dir().unwrap_or_else(|_| PathBuf::from(""));
        let runtime_path = app_data_dir.join("python_runtime");
        let model_dir = app_data_dir.join("model");
        let site_packages_dir = app_data_dir.join("site-packages");
        
        if !model_dir.exists() {
            fs::create_dir_all(&model_dir).map_err(|e| e.to_string())?;
        }

        let python_exe = runtime_path.join("python.exe");
        let model1 = model_dir.join("logic_roformer.ckpt");
        let model2 = model_dir.join("bs_roformer_karaoke_frazer_becruily.ckpt");

        // Step 0: Download and extract python_runtime if needed
        let client = Client::new();
        let runtime_zip = app_data_dir.join("python_runtime.zip");
        
        if !python_exe.exists() {
            if !runtime_zip.exists() {
                emit_progress(&app, "正在下载运行环境 (约150MB)...", 5.0);
                download_file(&client, &app, "https://ghproxy.net/https://github.com/DX-Protst/VocalMap-Release/releases/download/v0.0.1/python_runtime.zip", &runtime_zip, "正在下载 运行环境...", 5.0, 0.15)?;
            } else {
                emit_progress(&app, "检测到本地已有 python_runtime.zip，跳过下载...", 5.0);
                emit_console(&app, "检测到本地压缩包，直接进入解压流程...");
            }
            
            emit_progress(&app, "正在解压运行环境...", 20.0);
            emit_console(&app, "Extracting python_runtime.zip (This may take a minute)...");
            
            let file = fs::File::open(&runtime_zip).map_err(|e| e.to_string())?;
            let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
            
            for i in 0..archive.len() {
                let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
                let outpath = match file.enclosed_name() {
                    Some(path) => app_data_dir.join(path),
                    None => continue,
                };
                
                if (*file.name()).ends_with('/') {
                    fs::create_dir_all(&outpath).map_err(|e| e.to_string())?;
                } else {
                    if let Some(p) = outpath.parent() {
                        if !p.exists() {
                            fs::create_dir_all(p).map_err(|e| e.to_string())?;
                        }
                    }
                    let mut outfile = fs::File::create(&outpath).map_err(|e| e.to_string())?;
                    std::io::copy(&mut file, &mut outfile).map_err(|e| e.to_string())?;
                }
            }
                
            let _ = fs::remove_file(&runtime_zip);
        }

        let torch_check = site_packages_dir.join("torch");
        if !torch_check.exists() {
            // Step 1: Install PyTorch
            emit_progress(&app, "正在下载核心引擎 (约5GB)... (此过程较长，进度条暂不变化，请耐心等待)", 30.0);
            emit_console(&app, "准备执行 pip install...");
            
            use std::process::{Command, Stdio};
            #[cfg(target_os = "windows")]
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;

            let mut cmd = Command::new(&python_exe);
            cmd.env("PYTHONUNBUFFERED", "1");
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
        } else {
            emit_progress(&app, "检测到本地已有 PyTorch 核心，跳过安装...", 50.0);
            emit_console(&app, "检测到已安装 PyTorch，跳过 PIP 安装流程...");
        }

        // Step 2: Download models
        if !model1.exists() {
            download_file(&client, &app, "https://ghproxy.net/https://github.com/DX-Protst/VocalMap-Release/releases/download/v0.0.1/logic_roformer.ckpt", &model1, "正在下载 6轨道模型 (699MB)...", 70.0, 0.15)?;
        } else {
            emit_progress(&app, "检测到本地已有 6轨道模型，跳过下载...", 70.0);
            emit_console(&app, "检测到本地已有模型1，跳过下载...");
        }
        
        if !model2.exists() {
            download_file(&client, &app, "https://ghproxy.net/https://github.com/DX-Protst/VocalMap-Release/releases/download/v0.0.1/bs_roformer_karaoke_frazer_becruily.ckpt", &model2, "正在下载 卡拉OK模型 (204MB)...", 85.0, 0.15)?;
        } else {
            emit_progress(&app, "检测到本地已有 卡拉OK模型，跳过下载...", 85.0);
            emit_console(&app, "检测到本地已有模型2，跳过下载...");
        }

        emit_progress(&app, "所有环境与模型部署完成！", 100.0);

        Ok(serde_json::json!({ "success": true }))
    })
    .await
    .map_err(|e| format!("Task panicked: {}", e))?
}

fn download_file(client: &Client, app: &AppHandle, url: &str, dest: &PathBuf, msg_prefix: &str, base_pct: f64, weight: f64) -> Result<(), String> {
    emit_console(app, &format!("开始下载: {}", url));
    let mut response = client.get(url).send().map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        emit_console(app, &format!("下载失败: HTTP {}", response.status()));
        return Err(format!("Failed to download {}: {}", url, response.status()));
    }
    
    let total_size = response.content_length().unwrap_or(0);
    emit_console(app, &format!("文件总大小: {} MB", total_size / 1024 / 1024));
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
