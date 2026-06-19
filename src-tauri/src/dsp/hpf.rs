#[derive(Clone, Debug)]
pub struct Biquad {
    b0: f64,
    b1: f64,
    b2: f64,
    a1: f64,
    a2: f64,
    x1: f64,
    x2: f64,
    y1: f64,
    y2: f64,
}

impl Biquad {
    pub fn new(b0: f64, b1: f64, b2: f64, a1: f64, a2: f64) -> Self {
        Self {
            b0,
            b1,
            b2,
            a1,
            a2,
            x1: 0.0,
            x2: 0.0,
            y1: 0.0,
            y2: 0.0,
        }
    }

    pub fn process(&mut self, x: f64) -> f64 {
        let y = self.b0 * x + self.b1 * self.x1 + self.b2 * self.x2 - self.a1 * self.y1 - self.a2 * self.y2;
        self.x2 = self.x1;
        self.x1 = x;
        self.y2 = self.y1;
        self.y1 = y;
        y
    }

    pub fn reset(&mut self) {
        self.x1 = 0.0;
        self.x2 = 0.0;
        self.y1 = 0.0;
        self.y2 = 0.0;
    }
}

pub struct Butterworth4thOrderHPF {
    bq1: Biquad,
    bq2: Biquad,
    cutoff: f64,
    sample_rate: f64,
}

impl Butterworth4thOrderHPF {
    pub fn new(cutoff: f64, sample_rate: f64) -> Self {
        let (bq1, bq2) = Self::compute_coefficients(cutoff, sample_rate);
        Self {
            bq1,
            bq2,
            cutoff,
            sample_rate,
        }
    }

    fn compute_coefficients(cutoff: f64, sample_rate: f64) -> (Biquad, Biquad) {
        let w0 = 2.0 * std::f64::consts::PI * cutoff / sample_rate;
        let cos_w0 = w0.cos();
        let sin_w0 = w0.sin();

        // Q values for 4th-order Butterworth
        let q1 = 0.541196100146197;
        let q2 = 1.3065629648763765;

        let make_hpf_biquad = |q: f64| {
            let alpha = sin_w0 / (2.0 * q);
            let b0 = (1.0 + cos_w0) / 2.0;
            let b1 = -(1.0 + cos_w0);
            let b2 = (1.0 + cos_w0) / 2.0;
            let a0 = 1.0 + alpha;
            let a1 = -2.0 * cos_w0;
            let a2 = 1.0 - alpha;

            Biquad::new(b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0)
        };

        (make_hpf_biquad(q1), make_hpf_biquad(q2))
    }

    pub fn update_sample_rate(&mut self, sample_rate: f64) {
        if (self.sample_rate - sample_rate).abs() > 1e-5 {
            let (bq1, bq2) = Self::compute_coefficients(self.cutoff, sample_rate);
            self.bq1 = bq1;
            self.bq2 = bq2;
            self.sample_rate = sample_rate;
        }
    }

    pub fn process(&mut self, input: &[f32]) -> Vec<f32> {
        input
            .iter()
            .map(|&x| {
                let y1 = self.bq1.process(x as f64);
                let y2 = self.bq2.process(y1);
                y2 as f32
            })
            .collect()
    }

    pub fn reset(&mut self) {
        self.bq1.reset();
        self.bq2.reset();
    }
}
