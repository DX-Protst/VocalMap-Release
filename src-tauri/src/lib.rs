pub mod downloader;

use std::process::{Command as StdCommand, Child};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::sync::Mutex;
use tauri::{Manager, RunEvent};
use std::path::PathBuf;

struct BackendProcess(Mutex<Option<Child>>);

#[tauri::command]
fn get_machine_id() -> String {
    machine_uid::get().unwrap_or_else(|_| "unknown_machine_id".to_string())
}

#[tauri::command]
fn check_vcredist() -> bool {
    #[cfg(target_os = "windows")]
    {
        std::path::Path::new("C:\\Windows\\System32\\vcruntime140.dll").exists()
    }
    #[cfg(not(target_os = "windows"))]
    {
        true
    }
}


#[tauri::command]
fn relaunch_app(app_handle: tauri::AppHandle) {
    app_handle.restart();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let resolver = app.path();
            let root_dir = resolver.resource_dir().unwrap_or_else(|_| PathBuf::from(""));
            
            // 启动 FastAPI 后端
            let python_exe = if cfg!(debug_assertions) {
                // 开发模式：假设 python_runtime 在项目根目录
                std::env::current_dir().unwrap().join("../python_runtime/python.exe")
            } else {
                root_dir.join("_up_").join("python_runtime").join("python.exe")
            };

            let backend_dir = if cfg!(debug_assertions) {
                std::env::current_dir().unwrap().join("../backend")
            } else {
                root_dir.join("_up_").join("backend")
            };
            
            let app_data_dir = app.path().app_data_dir().unwrap_or_else(|_| PathBuf::from(""));
            let model_dir = app_data_dir.join("model");
            let site_packages_dir = app_data_dir.join("site-packages");

            // Ensure directories exist
            if !app_data_dir.exists() {
                std::fs::create_dir_all(&app_data_dir).unwrap_or(());
            }
            if !model_dir.exists() {
                std::fs::create_dir_all(&model_dir).unwrap_or(());
            }
            if !site_packages_dir.exists() {
                std::fs::create_dir_all(&site_packages_dir).unwrap_or(());
            }

            println!("[Tauri] 尝试启动引擎: {:?}", python_exe);
            
            let mut cmd = StdCommand::new(&python_exe);
            cmd.args([
                    "-m", "uvicorn",
                    "app:app",
                    "--host", "127.0.0.1",
                    "--port", "5050",
                    "--log-level", "warning"
                ])
                .current_dir(&backend_dir)
                .env("VOCALMAP_HOST", "127.0.0.1")
                .env("VOCALMAP_PORT", "5050")
                .env("VOCALMAP_MODEL_DIR", model_dir.to_string_lossy().to_string())
                .env("VOCALMAP_DATA_DIR", app_data_dir.to_string_lossy().to_string())
                .env("PYTHONPATH", site_packages_dir.to_string_lossy().to_string())
                .env("VOCALMAP_PARENT_PID", std::process::id().to_string());                
            #[cfg(target_os = "windows")]
            cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
            
            // Redirect logs to appdata for debugging VM crashes
            let log_path = app_data_dir.join("backend_crash.log");
            if let Ok(log_file) = std::fs::File::create(&log_path) {
                cmd.stdout(log_file.try_clone().map(std::process::Stdio::from).unwrap_or_else(|_| std::process::Stdio::null()));
                cmd.stderr(log_file);
            }
            
            let child = cmd.spawn();

            match child {
                Ok(proc) => {
                    println!("[Tauri] FastAPI 后端已启动, PID: {}", proc.id());
                    app.manage(BackendProcess(Mutex::new(Some(proc))));
                }
                Err(e) => {
                    eprintln!("[Tauri] 启动 FastAPI 失败: {}", e);
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_machine_id,
            check_vcredist,
            downloader::check_dependencies,
            downloader::start_download,
            relaunch_app
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let RunEvent::Exit = event {
                // 退出时杀掉 Python 子进程树 (Windows: taskkill /T /F)
                if let Some(state) = app_handle.try_state::<BackendProcess>() {
                    if let Ok(mut process_opt) = state.0.lock() {
                        if let Some(mut proc) = process_opt.take() {
                            let pid = proc.id();
                            println!("[Tauri] 应用退出，终止 Python 引擎 PID: {}", pid);
                            let mut kill_cmd = StdCommand::new("taskkill");
                            kill_cmd.args(["/pid", &pid.to_string(), "/T", "/F"]);
                            
                            #[cfg(target_os = "windows")]
                            kill_cmd.creation_flags(0x08000000);
                            
                            let _ = kill_cmd.status();
                            let _ = proc.kill();
                        }
                    }
                }
            }
        });
}
