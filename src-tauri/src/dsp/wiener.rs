use rustfft::{num_complex::Complex, FftPlanner};
use std::sync::Arc;

pub struct WienerFilter {
    noise_profile_pwr: Option<Vec<f32>>,
    g_prev: Vec<f32>,
    p_prev: Vec<f32>,
    fft_size: usize,
    forward_fft: Arc<dyn rustfft::Fft<f32>>,
    inverse_fft: Arc<dyn rustfft::Fft<f32>>,
    pub last_clean_mag: Vec<f32>,
}

impl WienerFilter {
    pub fn new(fft_size: usize) -> Self {
        let mut planner = FftPlanner::new();
        let forward_fft = planner.plan_fft_forward(fft_size);
        let inverse_fft = planner.plan_fft_inverse(fft_size);
        Self {
            noise_profile_pwr: None,
            g_prev: Vec::new(),
            p_prev: Vec::new(),
            fft_size,
            forward_fft,
            inverse_fft,
            last_clean_mag: Vec::new(),
        }
    }

    pub fn process(&mut self, audio_data: &[f32], noise_silence_threshold: f32) -> Vec<f32> {
        let n = audio_data.len();
        if n != self.fft_size {
            // Re-plan if size changes
            let mut planner = FftPlanner::new();
            self.forward_fft = planner.plan_fft_forward(n);
            self.inverse_fft = planner.plan_fft_inverse(n);
            self.fft_size = n;
            self.noise_profile_pwr = None;
        }

        let num_bins = n / 2 + 1;

        // Convert to Complex
        let mut buffer: Vec<Complex<f32>> = audio_data.iter().map(|&x| Complex::new(x, 0.0)).collect();

        // Forward FFT
        self.forward_fft.process(&mut buffer);

        // Magnitude
        let mut magnitude = vec![0.0; num_bins];
        for k in 0..num_bins {
            magnitude[k] = buffer[k].norm();
        }

        // Calculate loudness (raw)
        let raw_rms = (audio_data.iter().map(|&x| x * x).sum::<f32>() / n as f32).sqrt();
        let raw_dbfs = if raw_rms > 1e-10 {
            20.0 * raw_rms.log10()
        } else {
            -100.0
        };
        let raw_loudness = ((raw_dbfs + 60.0) / 60.0 * 100.0).clamp(0.0, 100.0);

        // Noise Profile Power
        let noise_pwr = match self.noise_profile_pwr.take() {
            None => {
                let pwr = if raw_loudness < 40.0 {
                    magnitude.iter().map(|&m| m * m).collect()
                } else {
                    vec![1e-10; num_bins]
                };
                self.g_prev = vec![1.0; num_bins];
                self.p_prev = vec![0.0; num_bins];
                pwr
            }
            Some(mut pwr) => {
                if raw_loudness < noise_silence_threshold {
                    for k in 0..num_bins {
                        pwr[k] = 0.5 * pwr[k] + 0.5 * magnitude[k] * magnitude[k];
                    }
                } else {
                    for k in 0..num_bins {
                        let m2 = magnitude[k] * magnitude[k];
                        pwr[k] = if m2 < pwr[k] {
                            0.8 * pwr[k] + 0.2 * m2
                        } else {
                            pwr[k] * 1.002
                        };
                    }
                }
                pwr
            }
        };

        // Decision-directed SNR & Gain calculation
        let alpha = 0.98;
        let mut g = vec![0.0; num_bins];
        let mut last_clean_mag = vec![0.0; num_bins];
        for k in 0..num_bins {
            let pwr_k = noise_pwr[k] + 1e-10;
            let gamma = (magnitude[k] * magnitude[k]) / pwr_k;
            let prev_snr = (self.g_prev[k] * self.g_prev[k] * self.p_prev[k]) / pwr_k;
            let xi = alpha * prev_snr + (1.0 - alpha) * (gamma - 1.0).max(0.0);
            g[k] = xi / (1.0 + xi);
            self.g_prev[k] = g[k];
            self.p_prev[k] = magnitude[k] * magnitude[k];
            last_clean_mag[k] = magnitude[k] * g[k];
        }

        // Save Noise Profile
        self.noise_profile_pwr = Some(noise_pwr);
        self.last_clean_mag = last_clean_mag;

        // Apply gain G to complex buffer using conjugate symmetry
        buffer[0] = buffer[0] * g[0];
        if n % 2 == 0 {
            buffer[n / 2] = buffer[n / 2] * g[n / 2];
        }
        for k in 1..(n + 1) / 2 {
            let gain = g[k];
            buffer[k] = buffer[k] * gain;
            buffer[n - k] = buffer[n - k] * gain;
        }

        // Inverse FFT
        self.inverse_fft.process(&mut buffer);

        // Real part normalized by N
        let norm = 1.0 / n as f32;
        buffer.iter().map(|c| c.re * norm).collect()
    }

    pub fn reset(&mut self) {
        self.noise_profile_pwr = None;
        self.g_prev.clear();
        self.p_prev.clear();
        self.last_clean_mag.clear();
    }
}
