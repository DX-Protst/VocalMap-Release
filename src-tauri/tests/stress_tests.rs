use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};
use app_lib::commands::AppState;

// Helper function to simulate the lock ordering and execution of vmap_process_audio_chunk
fn simulate_process_audio_chunk(state: &AppState, chunk: &[i16]) -> Result<(f64, f64), String> {
    let mut audio_bytes = Vec::with_capacity(chunk.len() * 2);
    for &val in chunk {
        audio_bytes.extend_from_slice(&val.to_ne_bytes());
    }

    // Lock sequence: analyzer first, then stream_state
    let mut analyzer = state.analyzer.lock().unwrap();
    let sample_rate = analyzer.sample_rate;
    let res = analyzer.process_chunk(&audio_bytes, sample_rate);

    {
        let mut stream = state.stream_state.lock().unwrap();
        if stream.is_recording {
            stream.audio_buffer.extend_from_slice(&audio_bytes);
        }
    }

    Ok((res.pitch, res.metrics.loudness))
}

// Helper function to simulate the lock ordering of vmap_stream_start_record
fn simulate_stream_start_record(state: &AppState) {
    // Lock sequence: analyzer first, then stream_state
    let mut analyzer = state.analyzer.lock().unwrap();
    let mut stream = state.stream_state.lock().unwrap();
    stream.is_recording = true;
    stream.audio_buffer.clear();
    analyzer.reset_state();
}

// Helper function to simulate the lock ordering of vmap_stream_stop_record
fn simulate_stream_stop_record(state: &AppState) {
    // Lock sequence: analyzer first, then stream_state
    let _analyzer = state.analyzer.lock().unwrap();
    let mut stream = state.stream_state.lock().unwrap();
    stream.is_recording = false;
}

#[test]
fn test_lock_inversion_deadlock() {
    let state = Arc::new(AppState::new());
    
    // Create a channel or flag to coordinate threads
    let state_clone1 = Arc::clone(&state);
    let state_clone2 = Arc::clone(&state);

    let handle1 = thread::spawn(move || {
        let chunk = vec![0i16; 2048];
        for _ in 0..1000 {
            let _ = simulate_process_audio_chunk(&state_clone1, &chunk);
            thread::sleep(Duration::from_micros(10));
        }
    });

    let handle2 = thread::spawn(move || {
        for _ in 0..1000 {
            simulate_stream_start_record(&state_clone2);
            thread::sleep(Duration::from_micros(5));
            simulate_stream_stop_record(&state_clone2);
            thread::sleep(Duration::from_micros(5));
        }
    });

    // Wait for threads with a timeout
    let start = Instant::now();
    let timeout = Duration::from_secs(5);
    
    while start.elapsed() < timeout {
        if handle1.is_finished() && handle2.is_finished() {
            break;
        }
        thread::sleep(Duration::from_millis(50));
    }

    let timed_out = !handle1.is_finished() || !handle2.is_finished();
    assert!(!timed_out, "DEADLOCK DETECTED! Lock inversion caused threads to hang.");
}

#[test]
fn test_chunk_processing_performance() {
    let state = AppState::new();
    
    // Generate 1.0 second of 440Hz sine wave, split into chunks of 2048 samples
    let sample_rate = 44100.0;
    let hz = 440.0;
    let total_samples = 44100;
    let mut audio_data = Vec::with_capacity(total_samples);
    for i in 0..total_samples {
        let t = i as f64 / sample_rate;
        let sample = (2.0 * std::f64::consts::PI * hz * t).sin() * 0.5;
        audio_data.push((sample * 32767.0) as i16);
    }

    let chunk_size = 2048;
    let mut total_duration = Duration::ZERO;
    let mut chunk_count = 0;

    // We start recording so we accumulate buffer
    simulate_stream_start_record(&state);

    for chunk in audio_data.chunks(chunk_size) {
        if chunk.len() < chunk_size {
            break;
        }
        let start = Instant::now();
        let res = simulate_process_audio_chunk(&state, chunk);
        let elapsed = start.elapsed();
        
        assert!(res.is_ok());
        let (pitch, loudness) = res.unwrap();
        
        println!(
            "Chunk {}: pitch = {:.2} Hz, loudness = {:.2}, time = {:?}",
            chunk_count, pitch, loudness, elapsed
        );
        
        total_duration += elapsed;
        chunk_count += 1;
        
        // Assert processing is well within real-time limits
        // 2048 samples at 44.1kHz is ~46.4ms of audio.
        // Real-time processing must be much faster than 46.4ms (typically < 2ms).
        assert!(
            elapsed < Duration::from_millis(15),
            "Processing chunk took {:?}, exceeding 15ms threshold", elapsed
        );
    }

    let avg_duration = total_duration / chunk_count;
    println!("Average chunk processing time: {:?}", avg_duration);
}
