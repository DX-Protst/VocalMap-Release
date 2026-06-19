pub mod downloader;
pub mod dsp;
pub mod license_verifier;
pub mod commands;

use tauri::{Manager, RunEvent};
use std::path::PathBuf;

struct ApiToken(String);

struct BackendPort(u16);

fn generate_token() -> String {
    use std::time::SystemTime;
    let seed = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let mut state = seed;
    let mut token = String::new();
    for _ in 0..32 {
        state = state.wrapping_mul(6364136223846793005).wrapping_add(1);
        let val = (state >> 32) as u32;
        let char_code = (val % 62) as u8;
        let c = match char_code {
            0..=9 => b'0' + char_code,
            10..=35 => b'a' + (char_code - 10),
            _ => b'A' + (char_code - 36),
        };
        token.push(c as char);
    }
    token
}

#[tauri::command]
fn get_machine_id() -> String {
    machine_uid::get().unwrap_or_else(|_| "unknown_machine_id".to_string())
}

#[tauri::command]
fn get_internal_token(token: tauri::State<'_, ApiToken>) -> String {
    token.0.clone()
}

#[tauri::command]
fn get_backend_port(port: tauri::State<'_, BackendPort>) -> u16 {
    port.0
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
    let token = generate_token();
    let token_clone = token.clone();
    let port = 5050; // Use a fixed port to avoid breakages in frontend

    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .setup(move |app| {
            app.manage(ApiToken(token_clone));
            app.manage(BackendPort(port));
            app.manage(commands::AppState::new());
            
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

            println!("[Tauri] Native backend initialized, Python FastAPI startup flow completely removed.");

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_machine_id,
            get_internal_token,
            get_backend_port,
            check_vcredist,
            downloader::check_dependencies,
            downloader::start_download,
            relaunch_app,
            commands::vmap_get_file_size,
            commands::vmap_get_license_status,
            commands::vmap_activate_license,
            commands::vmap_analyze_buffer,
            commands::vmap_separate_audio,
            commands::vmap_get_separation_task,
            commands::vmap_save_separation_to_disk,
            commands::vmap_export_tmap,
            commands::vmap_export_vmap,
            commands::vmap_convert_process,
            commands::vmap_stream_start_record,
            commands::vmap_stream_stop_record,
            commands::vmap_update_settings,
            commands::vmap_process_audio_chunk,
            commands::vmap_log
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, event| {
            if let RunEvent::Exit = event {
                println!("[Tauri] Application exit.");
            }
        });
}
