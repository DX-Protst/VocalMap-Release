use std::fs;
use std::path::PathBuf;
use std::process::Command;
use serde::Deserialize;
use app_lib::dsp::metrics::VocalAnalyzer;

#[derive(Deserialize, Debug)]
#[allow(dead_code)]
struct PythonResult {
    time: f64,
    pitch: f64,
    clarity: f64,
}

fn get_project_root() -> PathBuf {
    std::env::current_dir().unwrap()
}

#[test]
fn test_dsp_comparison() {
    let project_root = get_project_root();
    let temp_dir = std::env::temp_dir();
    let wav_path = temp_dir.join("synthetic_440.wav");
    let json_path = temp_dir.join("python_results.json");

    // 1. Generate synthetic WAV: 1.0 second of 440Hz sine wave
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: 44100,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer = hound::WavWriter::create(&wav_path, spec).unwrap();
    let duration_secs = 1.5;
    let num_samples = (44100.0 * duration_secs) as usize;
    for i in 0..num_samples {
        let t = i as f64 / 44100.0;
        // Constant 440 Hz sine wave
        let sample = (2.0 * std::f64::consts::PI * 440.0 * t).sin() * 0.5;
        writer.write_sample((sample * 32767.0) as i16).unwrap();
    }
    writer.finalize().unwrap();

    // 2. Invoke legacy Python engine to get baseline JSON
    let python_exe = project_root.join("..").join("python_runtime").join("python.exe");
    let process_script = project_root.join("..").join("backend").join("process_wav.py");

    assert!(python_exe.exists(), "python.exe not found at {:?}", python_exe);
    assert!(process_script.exists(), "process_wav.py not found at {:?}", process_script);

    let status = Command::new(&python_exe)
        .arg(&process_script)
        .arg(&wav_path)
        .arg(&json_path)
        .status()
        .expect("Failed to execute python process");

    assert!(status.success(), "Python WAV processing script failed");

    // 3. Load Python results
    let json_content = fs::read_to_string(&json_path).unwrap();
    let python_results: Vec<PythonResult> = serde_json::from_str(&json_content).unwrap();

    // 4. Run Rust VocalAnalyzer on the same WAV
    let samples = app_lib::dsp::metrics::load_audio_to_mono_samples(wav_path.to_str().unwrap(), 44100).unwrap();
    
    let mut audio_bytes = Vec::with_capacity(samples.len() * 2);
    for &sample in &samples {
        let val = (sample * 32767.0).clamp(-32768.0, 32767.0) as i16;
        audio_bytes.extend_from_slice(&val.to_ne_bytes());
    }

    let mut rust_analyzer = VocalAnalyzer::new(44100.0, 500.0);
    rust_analyzer.clarity_threshold = 0.35;
    rust_analyzer.loudness_gate = 5.0;

    let chunk_size = 2048;
    let bytes_per_sample = 2;
    let chunk_bytes_len = chunk_size * bytes_per_sample;

    let mut rust_results = Vec::new();
    let mut i = 0;
    while i + chunk_bytes_len <= audio_bytes.len() {
        let chunk = &audio_bytes[i..i + chunk_bytes_len];
        
        // Emulate Python HPF + Wiener + MPM directly to compare pitch & clarity
        let raw_audio_data: Vec<f32> = chunk
            .chunks_exact(2)
            .map(|c| {
                let val = i16::from_ne_bytes([c[0], c[1]]);
                val as f32 / 32768.0
            })
            .collect();

        let audio_data = rust_analyzer.hpf.process(&raw_audio_data);
        let clean_audio = rust_analyzer.wiener.process(&audio_data, rust_analyzer.noise_silence_threshold as f32);

        let (pitch, clarity) = app_lib::dsp::mpm::mpm_pitch(&clean_audio, 44100.0, 0.35);
        rust_results.push((pitch, clarity));

        i += chunk_bytes_len;
    }

    // 5. Assert that pitch and clarity match within 1% error margin
    assert_eq!(rust_results.len(), python_results.len(), "Chunk count mismatch");

    for idx in 0..rust_results.len() {
        let (rust_pitch, rust_clarity) = rust_results[idx];
        let py = &python_results[idx];

        if py.pitch > 0.0 {
            assert!(rust_pitch > 0.0, "Rust failed to detect pitch at index {}", idx);
            let pitch_err = (rust_pitch - py.pitch).abs() / py.pitch;
            assert!(
                pitch_err <= 0.01,
                "Pitch mismatch at index {}: Rust = {}, Python = {} (err = {:.2}%)",
                idx, rust_pitch, py.pitch, pitch_err * 100.0
            );
            
            let clarity_err = (rust_clarity - py.clarity).abs();
            assert!(
                clarity_err <= 0.01,
                "Clarity mismatch at index {}: Rust = {}, Python = {} (err = {})",
                idx, rust_clarity, py.clarity, clarity_err
            );
        } else {
            assert!(rust_pitch <= 0.0, "Rust detected false pitch at index {}", idx);
        }
    }

    // Clean up
    let _ = fs::remove_file(wav_path);
    let _ = fs::remove_file(json_path);
}

#[test]
fn test_license_and_clock_tampering() {
    let temp_dir = std::env::temp_dir();
    let state_dir = temp_dir.join("vmap_test_state");
    let _ = fs::create_dir_all(&state_dir);

    // 1. Clock tampering: Write a future LRT
    let state_path = state_dir.join(".sys_state");
    let future_time = 9999999999i64; // Far future
    let state_json = serde_json::json!({ "lrt": future_time });
    let state_str = serde_json::to_string(&state_json).unwrap();
    let encrypted_bytes: Vec<u8> = state_str.as_bytes().iter().map(|&b| b ^ 0x5A).collect();
    fs::write(&state_path, encrypted_bytes).unwrap();

    // Verify clock tempering throws error
    let res = app_lib::license_verifier::clock::check_clock_tampering(&state_dir);
    assert!(res.is_err(), "Clock tampering was not detected!");
    assert!(res.unwrap_err().contains("本地时间异常"));

    // 2. Clear state and verify success
    let _ = fs::remove_file(&state_path);
    let res = app_lib::license_verifier::clock::check_clock_tampering(&state_dir);
    assert!(res.is_ok(), "Normal clock check failed: {:?}", res);

    // 3. License verification with missing key
    let res = app_lib::license_verifier::verify::verify_pro_license(&state_dir, &state_dir);
    assert!(res.is_err());
    assert!(res.unwrap_err().contains("未找到许可证文件"));

    // Clean up
    let _ = fs::remove_dir_all(&state_dir);
}

#[test]
fn test_real_license_verification() {
    let project_root = get_project_root();
    let backend_dir = project_root.join("..").join("backend");
    let temp_dir = std::env::temp_dir();
    let state_dir = temp_dir.join("vmap_real_license_test_state");
    let _ = fs::create_dir_all(&state_dir);

    // Call verification with real backend directory
    let res = app_lib::license_verifier::verify::verify_pro_license(&state_dir, &backend_dir);
    assert!(res.is_ok(), "Real license verification failed: {:?}", res);
    
    let payload = res.unwrap();
    assert_eq!(payload.get("machine_id").unwrap().as_str().unwrap(), "ca45c3e5-8070-45b3-af20-07f60ec64751");
    assert_eq!(payload.get("plan_type").unwrap().as_str().unwrap(), "lifetime");

    let _ = fs::remove_dir_all(&state_dir);
}

