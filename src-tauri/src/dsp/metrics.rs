use serde::{Deserialize, Serialize};
use std::fs::File;
use symphonia::core::audio::AudioBufferRef;
use symphonia::core::audio::Signal;
use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::errors::Error;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AnalysisMetrics {
    pub loudness: f64,
    pub deviation: f64,
    pub stability: f64,
    pub brightness: f64,
    pub purity: f64,
    pub vibrato: f64,
    #[serde(rename = "vibrato_rate")]
    pub vibrato_rate: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ProcessChunkResult {
    pub pitch: f64,
    pub metrics: AnalysisMetrics,
}

pub struct VocalAnalyzer {
    pub sample_rate: f64,
    pub canvas_height: f64,
    pub pitch_history: Vec<f64>,
    pub current_note_history: Vec<f64>,
    pub jump_count: usize,
    pub hpf: crate::dsp::hpf::Butterworth4thOrderHPF,
    pub wiener: crate::dsp::wiener::WienerFilter,
    pub loudness_gate: f64,
    pub clarity_threshold: f64,
    pub noise_silence_threshold: f64,
}

impl VocalAnalyzer {
    pub fn new(sample_rate: f64, canvas_height: f64) -> Self {
        let hpf = crate::dsp::hpf::Butterworth4thOrderHPF::new(65.0, sample_rate);
        let wiener = crate::dsp::wiener::WienerFilter::new(2048);
        Self {
            sample_rate,
            canvas_height,
            pitch_history: Vec::new(),
            current_note_history: Vec::new(),
            jump_count: 0,
            hpf,
            wiener,
            loudness_gate: 8.0,
            clarity_threshold: 0.45,
            noise_silence_threshold: 20.0,
        }
    }

    pub fn update_settings(&mut self, settings: &serde_json::Value) {
        if let Some(obj) = settings.as_object() {
            if let Some(lg) = obj.get("loudness_gate") {
                if let Some(val) = lg.as_f64() {
                    self.loudness_gate = val;
                } else if let Some(val_str) = lg.as_str() {
                    if let Ok(val) = val_str.parse::<f64>() {
                        self.loudness_gate = val;
                    }
                }
            }
            if let Some(ct) = obj.get("clarity_threshold") {
                if let Some(val) = ct.as_f64() {
                    self.clarity_threshold = val;
                } else if let Some(val_str) = ct.as_str() {
                    if let Ok(val) = val_str.parse::<f64>() {
                        self.clarity_threshold = val;
                    }
                }
            }
            if let Some(nst) = obj.get("noise_silence_threshold") {
                if let Some(val) = nst.as_f64() {
                    self.noise_silence_threshold = val;
                } else if let Some(val_str) = nst.as_str() {
                    if let Ok(val) = val_str.parse::<f64>() {
                        self.noise_silence_threshold = val;
                    }
                }
            }
        }
    }

    pub fn reset_state(&mut self) {
        self.pitch_history.clear();
        self.current_note_history.clear();
        self.jump_count = 0;
        self.hpf.reset();
        self.wiener.reset();
    }

    pub fn process_chunk(&mut self, audio_bytes: &[u8], client_sample_rate: f64) -> ProcessChunkResult {
        if (self.sample_rate - client_sample_rate).abs() > 1e-5 {
            self.sample_rate = client_sample_rate;
            self.hpf.update_sample_rate(client_sample_rate);
        }

        // Convert u8 bytes to f32 normalized
        let raw_audio_data: Vec<f32> = audio_bytes
            .chunks_exact(2)
            .map(|chunk| {
                let val = i16::from_ne_bytes([chunk[0], chunk[1]]);
                val as f32 / 32768.0
            })
            .collect();

        // Apply HPF
        let audio_data = self.hpf.process(&raw_audio_data);

        // Apply Wiener Filter
        let clean_audio = self.wiener.process(&audio_data, self.noise_silence_threshold as f32);

        // Calculate clean loudness
        let audio_len = audio_data.len();
        let clean_rms = (clean_audio.iter().map(|&x| x * x).sum::<f32>() / audio_len as f32).sqrt();
        let dbfs = if clean_rms > 1e-10 {
            20.0 * clean_rms.log10()
        } else {
            -100.0
        };
        let loudness = ((dbfs + 60.0) / 60.0 * 100.0).clamp(0.0, 100.0);

        let mut deviation = 0.0;
        let mut stability = 0.0;
        let mut brightness = 0.0;
        let mut purity = 0.0;
        let mut vibrato_score = 0.0;
        let mut current_vibrato_rate = 0.0;
        let mut pitch = -1.0;

        if loudness as f64 >= self.loudness_gate {
            let (p_val, clarity) = crate::dsp::mpm::mpm_pitch(&clean_audio, self.sample_rate, self.clarity_threshold);
            pitch = p_val;

            if pitch > 0.0 {
                let midi_exact = 69.0 + 12.0 * (pitch / 440.0).log2();

                // Pitch jump handling
                let mut is_outlier = false;
                if !self.pitch_history.is_empty() {
                    if (midi_exact - self.pitch_history.last().copied().unwrap()).abs() > 3.0 {
                        self.jump_count += 1;
                        is_outlier = true;
                        if self.jump_count >= 2 {
                            self.pitch_history.clear();
                            self.current_note_history.clear();
                            self.jump_count = 0;
                            is_outlier = false; // Reset outlier for new note start
                        }
                    } else {
                        self.jump_count = 0;
                    }
                }

                if !is_outlier {
                    self.pitch_history.push(midi_exact);
                    self.current_note_history.push(midi_exact);
                    if self.pitch_history.len() > 45 {
                        self.pitch_history.remove(0);
                    }
                    if self.current_note_history.len() > 45 {
                        self.current_note_history.remove(0);
                    }
                }

                let mut expected_std = 0.0;

                // 1. Vibrato detection
                if self.pitch_history.len() >= 20 {
                    let (slope_v, intercept_v) = polyfit_1d(&self.pitch_history);
                    let centered: Vec<f64> = self
                        .pitch_history
                        .iter()
                        .enumerate()
                        .map(|(i, &val)| val - (slope_v * i as f64 + intercept_v))
                        .collect();

                    let mut zero_crossings_idx = Vec::new();
                    for i in 0..centered.len() - 1 {
                        let s1 = if centered[i] > 0.0 { 1 } else if centered[i] < 0.0 { -1 } else { 0 };
                        let s2 = if centered[i + 1] > 0.0 { 1 } else if centered[i + 1] < 0.0 { -1 } else { 0 };
                        if s1 != s2 {
                            zero_crossings_idx.push(i);
                        }
                    }

                    let mut exact_crossings = Vec::new();
                    for &z in &zero_crossings_idx {
                        let y1 = centered[z];
                        let y2 = centered[z + 1];
                        if (y1 - y2).abs() > 1e-10 {
                            exact_crossings.push(z as f64 + y1 / (y1 - y2));
                        } else {
                            exact_crossings.push(z as f64 + 0.5);
                        }
                    }

                    if exact_crossings.len() >= 3 {
                        let mut diffs = Vec::new();
                        for i in 0..exact_crossings.len() - 1 {
                            diffs.push(exact_crossings[i + 1] - exact_crossings[i]);
                        }
                        let avg_half_period_frames = diffs.iter().sum::<f64>() / diffs.len() as f64;
                        if avg_half_period_frames > 0.0 {
                            let fps = self.sample_rate / audio_len as f64;
                            let vibrato_rate = fps / (2.0 * avg_half_period_frames);

                            let max_val = centered.iter().copied().fold(f64::NEG_INFINITY, f64::max);
                            let min_val = centered.iter().copied().fold(f64::INFINITY, f64::min);
                            let vibrato_extent = max_val - min_val;

                            if vibrato_rate >= 4.0 && vibrato_rate <= 8.5 && vibrato_extent >= 0.3 && vibrato_extent <= 3.0 {
                                vibrato_score = ((vibrato_extent - 0.3) / 1.5 * 100.0).clamp(0.0, 100.0);
                                expected_std = (vibrato_extent / 2.0) * 0.707 * 100.0;
                                current_vibrato_rate = vibrato_rate;
                            }
                        }
                    }
                }

                // 2. Stability and Macro Deviation
                if self.current_note_history.len() > 3 {
                    let (slope_n, intercept_n) = polyfit_1d(&self.current_note_history);
                    let last_idx = (self.current_note_history.len() - 1) as f64;
                    let macro_pitch = slope_n * last_idx + intercept_n;
                    let nearest_midi = macro_pitch.round();
                    deviation = (macro_pitch - nearest_midi) * 100.0;

                    let mut residuals = Vec::new();
                    for (i, &val) in self.current_note_history.iter().enumerate() {
                        let trend = slope_n * i as f64 + intercept_n;
                        residuals.push(val - trend);
                    }
                    let mean_res = residuals.iter().sum::<f64>() / residuals.len() as f64;
                    let var_res =
                        residuals.iter().map(|&r| (r - mean_res).powi(2)).sum::<f64>() / residuals.len() as f64;
                    let std_dev = var_res.sqrt() * 100.0;

                    let adjusted_std = (std_dev - expected_std * 0.8).max(0.0);
                    stability = (100.0 - adjusted_std * 2.5).clamp(0.0, 100.0);
                } else {
                    stability = 100.0;
                    let nearest_midi = midi_exact.round();
                    deviation = (midi_exact - nearest_midi) * 100.0;
                }

                // 3. Brightness
                let hz_per_bin = self.sample_rate / audio_len as f64;
                let h1_bin = (pitch / hz_per_bin) as isize;
                let h2_bin = ((pitch * 2.0) / hz_per_bin) as isize;

                let get_peak_magnitude = |center_bin: isize, clean_mag: &[f32]| -> f64 {
                    let search_range = 3;
                    let start = (center_bin - search_range).max(0) as usize;
                    let end = ((center_bin + search_range + 1).max(0) as usize).min(clean_mag.len());
                    if start < end {
                        let mut max_val = 1e-10;
                        for i in start..end {
                            if clean_mag[i] as f64 > max_val {
                                max_val = clean_mag[i] as f64;
                            }
                        }
                        max_val
                    } else {
                        1e-10
                    }
                };

                let h1_mag = get_peak_magnitude(h1_bin, &self.wiener.last_clean_mag);
                let h2_mag = get_peak_magnitude(h2_bin, &self.wiener.last_clean_mag);

                let h1_h2_db = 20.0 * (h1_mag / (h2_mag + 1e-10)).log10();
                let brightness_raw = (h1_h2_db + 15.0) / 30.0 * 100.0;
                brightness = brightness_raw.clamp(5.0, 100.0);

                // 4. Purity (HNR)
                let hnr_db = 10.0 * (clarity / (1.0001 - clarity)).log10();
                purity = ((hnr_db - 2.5) / 13.5 * 100.0).clamp(0.0, 100.0);
            }
        }

        ProcessChunkResult {
            pitch,
            metrics: AnalysisMetrics {
                loudness: loudness as f64,
                deviation,
                stability,
                brightness,
                purity,
                vibrato: vibrato_score,
                vibrato_rate: current_vibrato_rate,
            },
        }
    }
}

fn polyfit_1d(y: &[f64]) -> (f64, f64) {
    let n = y.len() as f64;
    if n < 2.0 {
        return (0.0, 0.0);
    }
    let mean_x = (n - 1.0) / 2.0;
    let mean_y = y.iter().sum::<f64>() / n;

    let mut num = 0.0;
    let mut den = 0.0;
    for (i, &val) in y.iter().enumerate() {
        let dx = i as f64 - mean_x;
        num += dx * (val - mean_y);
        den += dx * dx;
    }
    let slope = if den != 0.0 { num / den } else { 0.0 };
    let intercept = mean_y - slope * mean_x;
    (slope, intercept)
}

pub fn medfilt_1d(data: &[f64], kernel_size: usize) -> Vec<f64> {
    let n = data.len();
    let mut result = vec![0.0; n];
    if n == 0 {
        return result;
    }
    let radius = kernel_size / 2;
    for i in 0..n {
        let mut window = Vec::new();
        for j in 0..kernel_size {
            let idx = (i + j).saturating_sub(radius);
            let idx = idx.min(n - 1);
            window.push(data[idx]);
        }
        window.sort_by(|a, b| a.partial_cmp(b).unwrap());
        result[i] = window[window.len() / 2];
    }
    result
}

pub fn load_audio_to_mono_samples(
    path: &str,
    target_sample_rate: u32,
) -> Result<Vec<f32>, Box<dyn std::error::Error>> {
    let src = File::open(path)?;
    let mss = MediaSourceStream::new(Box::new(src), Default::default());
    let hint = Hint::new();
    let probed = symphonia::default::get_probe().format(
        &hint,
        mss,
        &FormatOptions::default(),
        &MetadataOptions::default(),
    )?;
    let mut format = probed.format;
    let track = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
        .ok_or("no audio track found")?;
    let mut decoder =
        symphonia::default::get_codecs().make(&track.codec_params, &DecoderOptions::default())?;
    let track_id = track.id;

    let mut samples: Vec<f32> = Vec::new();
    let mut source_sample_rate = 0;

    loop {
        let packet = match format.next_packet() {
            Ok(packet) => packet,
            Err(Error::IoError(err)) => {
                if err.kind() == std::io::ErrorKind::UnexpectedEof {
                    break;
                }
                return Err(Box::new(err));
            }
            Err(err) => return Err(Box::new(err)),
        };

        if packet.track_id() != track_id {
            continue;
        }

        match decoder.decode(&packet) {
            Ok(decoded) => {
                if source_sample_rate == 0 {
                    source_sample_rate = decoded.spec().rate;
                }

                match decoded {
                    AudioBufferRef::F32(buf) => {
                        let num_channels = buf.spec().channels.count();
                        let num_frames = buf.frames();
                        for frame_idx in 0..num_frames {
                            let mut sum = 0.0;
                            for channel_idx in 0..num_channels {
                                sum += buf.chan(channel_idx)[frame_idx];
                            }
                            samples.push(sum / num_channels as f32);
                        }
                    }
                    AudioBufferRef::U8(buf) => {
                        let num_channels = buf.spec().channels.count();
                        let num_frames = buf.frames();
                        for frame_idx in 0..num_frames {
                            let mut sum = 0.0;
                            for channel_idx in 0..num_channels {
                                sum += (buf.chan(channel_idx)[frame_idx] as f32 - 128.0) / 128.0;
                            }
                            samples.push(sum / num_channels as f32);
                        }
                    }
                    AudioBufferRef::U16(buf) => {
                        let num_channels = buf.spec().channels.count();
                        let num_frames = buf.frames();
                        for frame_idx in 0..num_frames {
                            let mut sum = 0.0;
                            for channel_idx in 0..num_channels {
                                sum += (buf.chan(channel_idx)[frame_idx] as f32 - 32768.0) / 32768.0;
                            }
                            samples.push(sum / num_channels as f32);
                        }
                    }
                    AudioBufferRef::U24(buf) => {
                        let num_channels = buf.spec().channels.count();
                        let num_frames = buf.frames();
                        for frame_idx in 0..num_frames {
                            let mut sum = 0.0;
                            for channel_idx in 0..num_channels {
                                let sample = buf.chan(channel_idx)[frame_idx].0 as f32;
                                sum += (sample - 8388608.0) / 8388608.0;
                            }
                            samples.push(sum / num_channels as f32);
                        }
                    }
                    AudioBufferRef::U32(buf) => {
                        let num_channels = buf.spec().channels.count();
                        let num_frames = buf.frames();
                        for frame_idx in 0..num_frames {
                            let mut sum = 0.0;
                            for channel_idx in 0..num_channels {
                                sum += (buf.chan(channel_idx)[frame_idx] as f32 - 2147483648.0) / 2147483648.0;
                            }
                            samples.push(sum / num_channels as f32);
                        }
                    }
                    AudioBufferRef::S8(buf) => {
                        let num_channels = buf.spec().channels.count();
                        let num_frames = buf.frames();
                        for frame_idx in 0..num_frames {
                            let mut sum = 0.0;
                            for channel_idx in 0..num_channels {
                                sum += buf.chan(channel_idx)[frame_idx] as f32 / 128.0;
                            }
                            samples.push(sum / num_channels as f32);
                        }
                    }
                    AudioBufferRef::S16(buf) => {
                        let num_channels = buf.spec().channels.count();
                        let num_frames = buf.frames();
                        for frame_idx in 0..num_frames {
                            let mut sum = 0.0;
                            for channel_idx in 0..num_channels {
                                sum += buf.chan(channel_idx)[frame_idx] as f32 / 32768.0;
                            }
                            samples.push(sum / num_channels as f32);
                        }
                    }
                    AudioBufferRef::S24(buf) => {
                        let num_channels = buf.spec().channels.count();
                        let num_frames = buf.frames();
                        for frame_idx in 0..num_frames {
                            let mut sum = 0.0;
                            for channel_idx in 0..num_channels {
                                sum += buf.chan(channel_idx)[frame_idx].0 as f32 / 8388608.0;
                            }
                            samples.push(sum / num_channels as f32);
                        }
                    }
                    AudioBufferRef::S32(buf) => {
                        let num_channels = buf.spec().channels.count();
                        let num_frames = buf.frames();
                        for frame_idx in 0..num_frames {
                            let mut sum = 0.0;
                            for channel_idx in 0..num_channels {
                                sum += buf.chan(channel_idx)[frame_idx] as f32 / 2147483648.0;
                            }
                            samples.push(sum / num_channels as f32);
                        }
                    }
                    AudioBufferRef::F64(buf) => {
                        let num_channels = buf.spec().channels.count();
                        let num_frames = buf.frames();
                        for frame_idx in 0..num_frames {
                            let mut sum = 0.0;
                            for channel_idx in 0..num_channels {
                                sum += buf.chan(channel_idx)[frame_idx] as f32;
                            }
                            samples.push(sum / num_channels as f32);
                        }
                    }
                }
            }
            Err(Error::DecodeError(_)) => (),
            Err(err) => return Err(Box::new(err)),
        }
    }

    if source_sample_rate == 0 {
        return Err("could not determine sample rate".into());
    }

    if source_sample_rate != target_sample_rate {
        let ratio = source_sample_rate as f64 / target_sample_rate as f64;
        let new_len = (samples.len() as f64 / ratio).floor() as usize;
        let mut resampled = Vec::with_capacity(new_len);
        for i in 0..new_len {
            let pos = i as f64 * ratio;
            let idx = pos.floor() as usize;
            let frac = pos - idx as f64;
            if idx + 1 < samples.len() {
                resampled.push(samples[idx] * (1.0 - frac as f32) + samples[idx + 1] * frac as f32);
            } else if idx < samples.len() {
                resampled.push(samples[idx]);
            }
        }
        samples = resampled;
    }

    Ok(samples)
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TimelinePoint {
    pub time: f64,
    pub pitch: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct RadarData {
    pub accuracy: f64,
    pub stability: f64,
    pub purity: f64,
    pub resonance: f64,
    pub vibrato: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Dimension {
    pub label_key: String,
    pub label: String,
    pub value: f64,
    pub text_key: String,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_params: Option<std::collections::HashMap<String, String>>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Cross {
    pub pair_key: String,
    pub pair: String,
    pub text_key: String,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_params: Option<std::collections::HashMap<String, String>>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ReportAnalysis {
    pub dimensions: Vec<Dimension>,
    pub cross: Vec<Cross>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ComprehensiveReport {
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_size_kb: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_sec: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timeline: Option<Vec<TimelinePoint>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub radar_data: Option<RadarData>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub analysis: Option<ReportAnalysis>,
}

pub fn generate_comprehensive_report(
    audio_buffer: &[u8],
    loudness_gate: f64,
    clarity_threshold: f64,
    noise_silence_threshold: f64,
    sample_rate: f64,
    chunk_size: usize,
) -> ComprehensiveReport {
    let mut local_analyzer = VocalAnalyzer::new(sample_rate, 500.0);
    local_analyzer.loudness_gate = loudness_gate;
    local_analyzer.clarity_threshold = clarity_threshold;
    local_analyzer.noise_silence_threshold = noise_silence_threshold;

    let mut pitches = Vec::new();
    let mut louds = Vec::new();
    let mut brights = Vec::new();
    let mut pures = Vec::new();
    let mut stabs = Vec::new();
    let mut vibratos = Vec::new();
    let mut vibrato_rates = Vec::new();
    let mut timeline = Vec::new();

    let bytes_per_sample = 2;
    let chunk_bytes_len = chunk_size * bytes_per_sample;

    let mut i = 0;
    while i + chunk_bytes_len <= audio_buffer.len() {
        let chunk = &audio_buffer[i..i + chunk_bytes_len];
        let res = local_analyzer.process_chunk(chunk, sample_rate);

        let current_time_ms = (i / bytes_per_sample) as f64 / sample_rate * 1000.0;
        let mut pitch_val = res.pitch;
        if pitch_val <= 0.0 {
            pitch_val = -1.0;
        }
        timeline.push(TimelinePoint {
            time: current_time_ms,
            pitch: pitch_val,
        });

        if res.pitch > 0.0 {
            pitches.push(res.pitch);
            louds.push(res.metrics.loudness);
            brights.push(res.metrics.brightness);
            pures.push(res.metrics.purity);
            stabs.push(res.metrics.stability);
            vibratos.push(res.metrics.vibrato);
            vibrato_rates.push(res.metrics.vibrato_rate);
        }

        i += chunk_bytes_len;
    }

    if pitches.len() < 15 {
        return ComprehensiveReport {
            status: "error".to_string(),
            message: Some("有效发声数据不足，请大声演唱并保持足够时长。".to_string()),
            data_size_kb: None,
            duration_sec: None,
            timeline: None,
            radar_data: None,
            analysis: None,
        };
    }

    let midis: Vec<f64> = pitches.iter().map(|&p| 69.0 + 12.0 * (p / 440.0).log2()).collect();

    // 1. Note Segmentation
    let mut note_midis = Vec::new();
    let mut note_louds = Vec::new();
    let mut cur_midis = vec![midis[0]];
    let mut cur_louds = vec![louds[0]];

    for idx in 1..midis.len() {
        if (midis[idx] - midis[idx - 1]).abs() > 3.0 {
            note_midis.push(cur_midis);
            note_louds.push(cur_louds);
            cur_midis = vec![midis[idx]];
            cur_louds = vec![louds[idx]];
        } else {
            cur_midis.push(midis[idx]);
            cur_louds.push(louds[idx]);
        }
    }
    note_midis.push(cur_midis);
    note_louds.push(cur_louds);

    // 2. Stability (Jitter & Shimmer)
    let mut j_list = Vec::new();
    for m in &note_midis {
        if m.len() > 1 {
            let mut diff_sum = 0.0;
            for idx in 0..m.len() - 1 {
                diff_sum += (m[idx + 1] - m[idx]).abs();
            }
            j_list.push(diff_sum / (m.len() - 1) as f64);
        }
    }

    let mut s_list = Vec::new();
    for l in &note_louds {
        if l.len() > 1 {
            let mut diff_sum = 0.0;
            for idx in 0..l.len() - 1 {
                diff_sum += (l[idx + 1] - l[idx]).abs();
            }
            s_list.push(diff_sum / (l.len() - 1) as f64);
        }
    }

    let jitter = if !j_list.is_empty() { j_list.iter().sum::<f64>() / j_list.len() as f64 } else { 0.0 };
    let shimmer = if !s_list.is_empty() { s_list.iter().sum::<f64>() / s_list.len() as f64 } else { 0.0 };
    let l_stability = (100.0 - (jitter * 40.0 + shimmer * 1.5)).clamp(0.0, 100.0);

    // 3. Accuracy
    let mut total_deviation = 0.0;
    let mut total_frames = 0;
    for note in &note_midis {
        let note_len = note.len();
        if note_len < 3 {
            continue;
        }
        let mut sorted_note = note.clone();
        sorted_note.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let median = if note_len % 2 == 1 {
            sorted_note[note_len / 2]
        } else {
            (sorted_note[note_len / 2 - 1] + sorted_note[note_len / 2]) / 2.0
        };
        let target = median.round();
        let deviation = (median - target).abs() * 100.0;
        total_deviation += deviation * note_len as f64;
        total_frames += note_len;
    }

    let accuracy_score = if total_frames > 0 {
        let avg_deviation = total_deviation / total_frames as f64;
        let avg_deviation_clamped = (avg_deviation - 2.5).max(0.0);
        (100.0 - (avg_deviation_clamped * 1.35)).clamp(0.0, 100.0)
    } else {
        0.0
    };

    let total_time = pitches.len() as f64 * (chunk_size as f64 / sample_rate);
    let vibrato_extent = if !vibratos.is_empty() {
        vibratos.iter().copied().fold(f64::NEG_INFINITY, f64::max)
    } else {
        0.0
    };
    let valid_rates: Vec<f64> = vibrato_rates.iter().copied().filter(|&v| v > 0.0).collect();
    let mut vibrato_rate = if !valid_rates.is_empty() {
        valid_rates.iter().sum::<f64>() / valid_rates.len() as f64
    } else {
        0.0
    };

    if vibrato_extent < 10.0 {
        vibrato_rate = 0.0;
    }

    let avg_bright = brights.iter().sum::<f64>() / brights.len() as f64;
    let avg_pure = pures.iter().sum::<f64>() / pures.len() as f64;

    // Per-dimension analysis
    let mut dims = Vec::new();

    // Accuracy
    if accuracy_score >= 90.0 {
        dims.push(Dimension {
            label_key: "diag.radar_accuracy".to_string(),
            label: "音准".to_string(),
            value: (accuracy_score * 10.0).round() / 10.0,
            text_key: "diag.acc_perfect".to_string(),
            text: "✨ 完美的音准控制！您的音高几乎毫无瑕疵，中心点命中率极高，请继续保持这种绝佳的声带肌肉记忆！"
                .to_string(),
            text_params: None,
        });
    } else if accuracy_score >= 75.0 {
        dims.push(Dimension {
            label_key: "diag.radar_accuracy".to_string(),
            label: "音准".to_string(),
            value: (accuracy_score * 10.0).round() / 10.0,
            text_key: "diag.acc_good".to_string(),
            text: "整体音准表现良好，框架非常清晰。仅在少数音区转换或长音末尾有极轻微的游离，瑕不掩瑜。".to_string(),
            text_params: None,
        });
    } else {
        dims.push(Dimension {
            label_key: "diag.radar_accuracy".to_string(),
            label: "音准".to_string(),
            value: (accuracy_score * 10.0).round() / 10.0,
            text_key: "diag.acc_poor".to_string(),
            text: "音高存在游离。建议借助钢琴慢速校准长音，确保音符的核心落在绝对音高上。".to_string(),
            text_params: None,
        });
    }

    // Stability
    if l_stability >= 85.0 {
        dims.push(Dimension {
            label_key: "diag.radar_stability".to_string(),
            label: "稳定".to_string(),
            value: (l_stability * 10.0).round() / 10.0,
            text_key: "diag.stab_perfect".to_string(),
            text: "✨ 极其出色的气息支撑！您的发声过程如同丝绸般平滑，微观抖动极少，展现了专业级的横膈膜控制力。"
                .to_string(),
            text_params: None,
        });
    } else if l_stability >= 70.0 {
        dims.push(Dimension {
            label_key: "diag.radar_stability".to_string(),
            label: "稳定".to_string(),
            value: (l_stability * 10.0).round() / 10.0,
            text_key: "diag.stab_good".to_string(),
            text: "气息连贯度不错，整体听感平稳。如果在乐句末尾的气息衰减期再增强一点点支撑，听感会更完美。".to_string(),
            text_params: None,
        });
    } else {
        dims.push(Dimension {
            label_key: "diag.radar_stability".to_string(),
            label: "稳定".to_string(),
            value: (l_stability * 10.0).round() / 10.0,
            text_key: "diag.stab_poor".to_string(),
            text: "发声存在微观抖动或突变。建议强化横膈膜腹式呼吸，维持平滑连贯的气息支撑。".to_string(),
            text_params: None,
        });
    }

    // Purity
    if avg_pure < 50.0 {
        dims.push(Dimension {
            label_key: "diag.radar_purity".to_string(),
            label: "纯净".to_string(),
            value: (avg_pure * 10.0).round() / 10.0,
            text_key: "diag.pure_airy".to_string(),
            text: "检测到较多气声特征（Airy Voice）。若这是您刻意追求的慵懒或情感化表达，气声运用非常到位；若非刻意，建议适度增强声带闭合。".to_string(),
            text_params: None,
        });
    } else if avg_pure > 85.0 {
        dims.push(Dimension {
            label_key: "diag.radar_purity".to_string(),
            label: "纯净".to_string(),
            value: (avg_pure * 10.0).round() / 10.0,
            text_key: "diag.pure_clean".to_string(),
            text: "✨ 极致的纯净音色！声带闭合极其健康紧密，声音扎实透亮，没有多余的杂音漏气，充满质感。".to_string(),
            text_params: None,
        });
    } else {
        dims.push(Dimension {
            label_key: "diag.radar_purity".to_string(),
            label: "纯净".to_string(),
            value: (avg_pure * 10.0).round() / 10.0,
            text_key: "diag.pure_balanced".to_string(),
            text: "声带闭合状态健康自然，音色兼顾了清晰度与空气感，是非常讨喜的流行声线。".to_string(),
            text_params: None,
        });
    }

    // Resonance
    if avg_bright < 40.0 {
        dims.push(Dimension {
            label_key: "diag.radar_resonance".to_string(),
            label: "共鸣".to_string(),
            value: (avg_bright * 10.0).round() / 10.0,
            text_key: "diag.res_chest".to_string(),
            text: "高频泛音较少，发声倾向于温暖厚实的胸声共鸣（Chest Voice），声音偏暗，非常适合叙事感强的低频抒情。".to_string(),
            text_params: None,
        });
    } else if avg_bright > 80.0 {
        dims.push(Dimension {
            label_key: "diag.radar_resonance".to_string(),
            label: "共鸣".to_string(),
            value: (avg_bright * 10.0).round() / 10.0,
            text_key: "diag.res_head".to_string(),
            text: "✨ 强大的高频穿透力！头腔或咽腔共鸣非常丰富，声音具有极强的金属感与爆发力，高音掌控力极佳。".to_string(),
            text_params: None,
        });
    } else {
        dims.push(Dimension {
            label_key: "diag.radar_resonance".to_string(),
            label: "共鸣".to_string(),
            value: (avg_bright * 10.0).round() / 10.0,
            text_key: "diag.res_balanced".to_string(),
            text: "泛音分布非常均衡，兼具了胸腔的温暖和头腔的明亮，能轻松驾驭大部分主流曲风。".to_string(),
            text_params: None,
        });
    }

    // Vibrato
    if vibrato_rate > 0.0 {
        let mut params = std::collections::HashMap::new();
        params.insert("vibrato_rate".to_string(), format!("{:.1}", vibrato_rate));
        if vibrato_rate >= 4.5 && vibrato_rate <= 7.0 && vibrato_extent >= 15.0 {
            dims.push(Dimension {
                label_key: "diag.radar_vibrato".to_string(),
                label: "颤音".to_string(),
                value: (vibrato_extent.min(100.0) * 10.0).round() / 10.0,
                text_key: "diag.vib_perfect".to_string(),
                text: format!(
                    "✨ 教科书般的颤音！频率落在黄金区间（{:.1}Hz），波动自然且富有深情感染力，喉部非常松弛。",
                    vibrato_rate
                ),
                text_params: Some(params),
            });
        } else {
            dims.push(Dimension {
                label_key: "diag.radar_vibrato".to_string(),
                label: "颤音".to_string(),
                value: (vibrato_extent.min(100.0) * 10.0).round() / 10.0,
                text_key: "diag.vib_good".to_string(),
                text: format!("检测到了规律性颤音（{:.1}Hz），有效提升了乐句尾音的情感表现力。", vibrato_rate),
                text_params: Some(params),
            });
        }
    }

    // Cross-dimension analysis
    let mut cross = Vec::new();
    let a = accuracy_score;
    let s_val = l_stability;
    let p = avg_pure;
    let r = avg_bright;

    if a >= 85.0 && s_val >= 85.0 {
        cross.push(Cross {
            pair_key: "diag.cross_master_pair".to_string(),
            pair: "🏆 殿堂级核心控制".to_string(),
            text_key: "diag.cross_master_text".to_string(),
            text: "音准与稳定度双双达到极高水准！您的基础发声机能已经极其扎实，技术过硬，现在完全可以把注意力全部放在情感宣泄与律动设计上。".to_string(),
            text_params: None,
        });
    } else if a < 75.0 && s_val < 70.0 {
        cross.push(Cross {
            pair_key: "diag.cross_both_pair".to_string(),
            pair: "音准与稳定双修".to_string(),
            text_key: "diag.cross_both_text".to_string(),
            text: "音高游离且气息连贯度欠佳，声乐核心控制力亟待系统强化，建议从最基础的“嘟嘴唇（Lip Trill）”单音爬音阶练起。".to_string(),
            text_params: None,
        });
    } else if a < 75.0 {
        cross.push(Cross {
            pair_key: "diag.cross_acc_pair".to_string(),
            pair: "偏差排查".to_string(),
            text_key: "diag.cross_acc_text".to_string(),
            text: "气息连贯度很好，说明发声习惯是健康的，但音符核心存在偏差。应将练习重心转移至听音（Ear Training）与音准肌肉记忆上。".to_string(),
            text_params: None,
        });
    } else if s_val < 70.0 {
        cross.push(Cross {
            pair_key: "diag.cross_stab_pair".to_string(),
            pair: "抖动平抑".to_string(),
            text_key: "diag.cross_stab_text".to_string(),
            text: "音准框架准确，但发声过程存在抖动。建议在单音练习中加入慢速的“渐强渐弱（Messa di voce）”以锻炼气息对抗的平滑度。".to_string(),
            text_params: None,
        });
    }

    if p < 50.0 && r < 40.0 {
        cross.push(Cross {
            pair_key: "diag.style_whisper_pair".to_string(),
            pair: "🎵 风格鉴定：呢喃低语".to_string(),
            text_key: "diag.style_whisper_text".to_string(),
            text: "气声与胸声：当前演唱展现了浓郁的低频气声风格（如爵士、Bossa Nova 或卧室流行），音色温暖、迷幻且带有一种诉说感。".to_string(),
            text_params: None,
        });
    } else if p < 50.0 && r > 80.0 {
        cross.push(Cross {
            pair_key: "diag.style_airyhead_pair".to_string(),
            pair: "🎵 风格鉴定：气声高音".to_string(),
            text_key: "diag.style_airyhead_text".to_string(),
            text: "气声与头声：声音高频亮丽却混有明显空气感，这是一种非常高级的 R&B 强假音或边缘化发声技术，具有独特的性感张力。".to_string(),
            text_params: None,
        });
    } else if p > 80.0 && r < 40.0 {
        cross.push(Cross {
            pair_key: "diag.style_solidchest_pair".to_string(),
            pair: "🎵 风格鉴定：扎实中低音".to_string(),
            text_key: "diag.style_solidchest_text".to_string(),
            text: "扎实胸声：声带闭合极佳且主要依赖胸腔共鸣，音色扎实沉稳，具有浑厚的力量感，非常适合恢弘大气的作品。".to_string(),
            text_params: None,
        });
    } else if p > 80.0 && r > 80.0 {
        cross.push(Cross {
            pair_key: "diag.style_powerhead_pair".to_string(),
            pair: "🎵 风格鉴定：穿透力高音".to_string(),
            text_key: "diag.style_powerhead_text".to_string(),
            text: "明亮头声：闭合紧密且头腔共鸣极强，音色纯净明亮，极极穿透力和爆发力（典型的高音 Belt 或强劲美声风格）。".to_string(),
            text_params: None,
        });
    }

    ComprehensiveReport {
        status: "success".to_string(),
        message: None,
        data_size_kb: Some((audio_buffer.len() as f64 / 1024.0 * 10.0).round() / 10.0),
        duration_sec: Some((total_time * 10.0).round() / 10.0),
        timeline: Some(timeline),
        radar_data: Some(RadarData {
            accuracy: (accuracy_score * 10.0).round() / 10.0,
            stability: (l_stability * 10.0).round() / 10.0,
            purity: (avg_pure * 10.0).round() / 10.0,
            resonance: (avg_bright * 10.0).round() / 10.0,
            vibrato: (vibrato_extent.min(100.0) * 10.0).round() / 10.0,
        }),
        analysis: Some(ReportAnalysis {
            dimensions: dims,
            cross,
        }),
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct QuantizedBlock {
    #[serde(rename = "startTime")]
    pub start_time: f64,
    pub duration: f64,
    pub midi: i32,
    #[serde(rename = "type")]
    pub block_type: String,
    pub instruction: String,
}

pub fn generate_quantized_pitch_track(audio_path: &str, sample_rate: f64, chunk_size: usize) -> Vec<QuantizedBlock> {
    let samples = match load_audio_to_mono_samples(audio_path, sample_rate as u32) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[generate_quantized_pitch_track] error loading audio: {}", e);
            return Vec::new();
        }
    };

    let mut audio_bytes = Vec::with_capacity(samples.len() * 2);
    for &sample in &samples {
        let val = (sample * 32767.0).clamp(-32768.0, 32767.0) as i16;
        audio_bytes.extend_from_slice(&val.to_ne_bytes());
    }

    let mut local_analyzer = VocalAnalyzer::new(sample_rate, 500.0);
    local_analyzer.clarity_threshold = 0.35;
    local_analyzer.loudness_gate = 5.0;

    let bytes_per_sample = 2;
    let chunk_bytes_len = chunk_size * bytes_per_sample;

    let mut times = Vec::new();
    let mut midis = Vec::new();

    let mut i = 0;
    while i + chunk_bytes_len <= audio_bytes.len() {
        let chunk = &audio_bytes[i..i + chunk_bytes_len];
        let res = local_analyzer.process_chunk(chunk, sample_rate);

        let current_time_ms = (i / bytes_per_sample) as f64 / sample_rate * 1000.0;
        times.push(current_time_ms);

        if res.pitch > 0.0 {
            midis.push(69.0 + 12.0 * (res.pitch / 440.0).log2());
        } else {
            midis.push(0.0);
        }

        i += chunk_bytes_len;
    }

    if midis.is_empty() {
        return Vec::new();
    }

    // 1. Median filtering
    let filtered = medfilt_1d(&midis, 7);

    // 2. Hysteresis Quantization
    let mut quantized = vec![0.0; filtered.len()];
    let mut current_q = 0.0;
    for idx in 0..filtered.len() {
        let raw = filtered[idx];
        if raw == 0.0 {
            current_q = 0.0;
            quantized[idx] = 0.0;
        } else {
            if current_q == 0.0 {
                current_q = raw.round();
            } else {
                if (raw - current_q).abs() > 0.8 {
                    current_q = raw.round();
                }
            }
            quantized[idx] = current_q;
        }
    }

    // 3. Aggregate to blocks
    let mut blocks = Vec::new();
    let mut current_midi = 0.0;
    let mut start_time = 0.0;

    for idx in 0..times.len() {
        let m = quantized[idx];
        let t = times[idx] / 1000.0; // seconds
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
                blocks.push(QuantizedBlock {
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
        blocks.push(QuantizedBlock {
            start_time: (start_time * 1000.0).round() / 1000.0,
            duration: (duration * 1000.0).round() / 1000.0,
            midi: current_midi as i32,
            block_type: block_type.to_string(),
            instruction: "".to_string(),
        });
    }

    // 4. Post-processing: merge gaps < 0.25s
    let mut merged_blocks: Vec<QuantizedBlock> = Vec::new();
    for b in blocks {
        if merged_blocks.is_empty() {
            merged_blocks.push(b);
            continue;
        }

        let prev_idx = merged_blocks.len() - 1;
        let prev_end = merged_blocks[prev_idx].start_time + merged_blocks[prev_idx].duration;
        let gap = b.start_time - prev_end;

        if merged_blocks[prev_idx].midi == b.midi && gap < 0.25 {
            let new_dur = b.start_time + b.duration - merged_blocks[prev_idx].start_time;
            merged_blocks[prev_idx].duration = (new_dur * 1000.0).round() / 1000.0;
        } else {
            merged_blocks.push(b);
        }
    }

    // Filter duration >= 0.15s
    merged_blocks.into_iter().filter(|b| b.duration >= 0.15).collect()
}

pub fn generate_continuous_pitch_track(audio_path: &str, sample_rate: f64, chunk_size: usize) -> Vec<TimelinePoint> {
    let samples = match load_audio_to_mono_samples(audio_path, sample_rate as u32) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[generate_continuous_pitch_track] error loading audio: {}", e);
            return Vec::new();
        }
    };

    let mut audio_bytes = Vec::with_capacity(samples.len() * 2);
    for &sample in &samples {
        let val = (sample * 32767.0).clamp(-32768.0, 32767.0) as i16;
        audio_bytes.extend_from_slice(&val.to_ne_bytes());
    }

    let mut local_analyzer = VocalAnalyzer::new(sample_rate, 500.0);
    local_analyzer.clarity_threshold = 0.35;
    local_analyzer.loudness_gate = 5.0;

    let bytes_per_sample = 2;
    let chunk_bytes_len = chunk_size * bytes_per_sample;

    let mut final_timeline = Vec::new();

    let mut i = 0;
    while i + chunk_bytes_len <= audio_bytes.len() {
        let chunk = &audio_bytes[i..i + chunk_bytes_len];
        let res = local_analyzer.process_chunk(chunk, sample_rate);

        let current_time_ms = (i / bytes_per_sample) as f64 / sample_rate * 1000.0;
        let mut pitch_val = res.pitch;
        if pitch_val <= 0.0 {
            pitch_val = -1.0;
        }

        final_timeline.push(TimelinePoint {
            time: (current_time_ms * 10.0).round() / 10.0,
            pitch: (pitch_val * 100.0).round() / 100.0,
        });

        i += chunk_bytes_len;
    }

    final_timeline
}
