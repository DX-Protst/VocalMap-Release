#[derive(Debug, Clone)]
struct PeakCandidate {
    pitch: f64,
    clarity: f64,
    #[allow(dead_code)]
    tau: f64,
}

pub fn numba_mpm_core(audio_data: &[f32], w: usize) -> Vec<f64> {
    let mut nsdf = vec![0.0; w];
    if w == 0 {
        return nsdf;
    }

    // Precompute rolling sum of squares S(tau)
    let mut s = vec![0.0; w];
    let mut current_sum = 0.0;
    for i in 0..w {
        current_sum += (audio_data[i] * audio_data[i]) as f64;
    }
    s[0] = current_sum;

    for tau in 1..w {
        current_sum = current_sum
            - (audio_data[tau - 1] * audio_data[tau - 1]) as f64
            + (audio_data[w - 1 + tau] * audio_data[w - 1 + tau]) as f64;
        s[tau] = current_sum;
    }

    for tau in 0..w {
        let mut acf = 0.0;
        for i in 0..w {
            acf += (audio_data[i] * audio_data[i + tau]) as f64;
        }
        let m = s[0] + s[tau];
        if m == 0.0 {
            nsdf[tau] = 0.0;
        } else {
            nsdf[tau] = 2.0 * acf / m;
        }
    }
    nsdf
}

pub fn mpm_pitch(audio_data: &[f32], sample_rate: f64, clarity_threshold: f64) -> (f64, f64) {
    let n = audio_data.len();
    let w = n / 2;
    if w == 0 {
        return (-1.0, 0.0);
    }

    let min_hz = 65.0;
    let max_hz = 3000.0;
    let min_p = (sample_rate / max_hz).floor() as usize;
    let max_p = (sample_rate / min_hz).ceil() as usize;
    if w <= max_p {
        return (-1.0, 0.0);
    }

    let nsdf = numba_mpm_core(audio_data, w);

    let mut maxima = Vec::new();
    let limit = std::cmp::min(w - 1, max_p);
    for tau in min_p..limit {
        if nsdf[tau] > 0.0 && nsdf[tau] > nsdf[tau - 1] && nsdf[tau] > nsdf[tau + 1] {
            let y1 = nsdf[tau - 1];
            let y2 = nsdf[tau];
            let y3 = nsdf[tau + 1];
            let denom = y1 + y3 - 2.0 * y2;
            let tau_interp = if denom != 0.0 {
                tau as f64 + (y1 - y3) / (2.0 * denom)
            } else {
                tau as f64
            };
            let peak_val = if denom != 0.0 {
                y2 - (y1 - y3).powi(2) / (8.0 * denom)
            } else {
                y2
            };

            let pitch_val = sample_rate / tau_interp.max(1e-5);
            maxima.push(PeakCandidate {
                pitch: pitch_val,
                clarity: peak_val,
                tau: tau_interp,
            });
        }
    }

    if maxima.is_empty() {
        return (-1.0, 0.0);
    }

    // Find highest peak by clarity
    let mut highest_peak = maxima[0].clone();
    for cand in &maxima {
        if cand.clarity > highest_peak.clarity {
            highest_peak = cand.clone();
        }
    }

    if highest_peak.clarity < clarity_threshold {
        return (-1.0, 0.0);
    }

    let k = 0.95;
    let threshold = highest_peak.clarity * k;

    // Find the first peak that crosses the threshold
    for cand in &maxima {
        if cand.clarity >= threshold {
            return (cand.pitch, highest_peak.clarity);
        }
    }

    (-1.0, 0.0)
}
