# VocalMap Official Release 🚀

English | [简体中文版](../README.md)

Welcome to the official commercial release of VocalMap! This is a desktop-grade vocal diagnosis and stem separation workstation designed for vocal pedagogy, singer training, and professional audio production.

After deep architectural reconstruction and extreme performance optimization, we bring you the most advanced local AI audio processing experience. The latest version is fully evolved, making every sound you produce a tangible trace!

## 🌟 Key Highlights & Features

### 1. Advanced Targeted Vocal Training Camp (Brand New)
Ditch aimless singing! The system dynamically generates **6 progressive acoustic training stages** based on your standard vocal range (or a highly customizable **custom range**):
*   **3-Second Look-ahead Camera**: Smoothly tracks and predicts upcoming vocal targets, resolving the visual blind spot caused by large vocal jumps (e.g., chest voice to head voice).
*   **100ms Latency Compensation Algorithm**: Complete overhaul of the audio-visual sync logic. Piano prompts play on time while target boxes are offset by 100ms to offset microphone capture and processing latency.
*   **Studio-Grade Dual-Track Dynamics Compressor**: Built-in Web Audio dynamics compressor maximizes piano prompting volume while keeping it warm and round, avoiding hard clipping.

### 2. Real-Time Multi-Dimensional Acoustic Diagnosis Engine
Leveraging zero-latency signal analysis algorithms (YIN pitch tracking variant + H1-H2 harmonic resonance assessment), VocalMap captures and analyzes vocal characteristics in real time via your microphone.
*   **6-Dimensional Holographic Diagnosis Radar (Pro Feature)**: Tracks high-level vocal metrics like pitch accuracy, stability, resonance, and purity in milliseconds, and scores professional vibratos.
*   **Dynamic Playback & Review (Newly Upgraded)**: Pack your performance tracks into `.vmap` project files. During playback, the view automatically locks onto the pitch, pairing with high-precision reference points for magnifying glass analysis.
*   **One-Click Ultra-Fast Offline Analysis (Newly Upgraded)**: Import existing vocal dry tracks to analyze them instantly, outputting detailed comprehensive diagnostic reports without real-time playback.
*   **HD Long Image Export**: Export sleek, dark-themed diagnostic reports as high-definition long images with zero background fading or clipping.

### 3. Studio-Grade AI Stem Separation (Pro Feature)
Equipped with SOTA **BS-RoFormer** and **Logic-RoFormer** deep learning separation models.
*   **Karaoke Vocals/Instrumental Separation**: Remove vocals to get clean accompaniment and backing vocals.
*   **All-Rounder 6-Stem Instrument Separation**: Extract Vocals, Piano, Guitar, Bass, Drums, and Other.
*   **Absolute Data Privacy**: 100% local GPU/CPU inference. No data is ever uploaded to servers.

### 4. Next-Gen Geek-Style User Experience
*   Fully adopts high-end Liquid Glass UI with seamless dark/light modes.
*   Smooth transition animations and **fixed golden ratio window size (1200x800)** to avoid layout deformation or scaling issues.
*   **Independent Unoccluded Activation/Status Panel**: Completely refactored the Pro license activation and status viewing logic, replacing the traditional global overlay with a smooth, full-sized independent workspace. Users can also instantly check their exact initial activation time and remaining validity directly from the system settings.

### 5. Multilingual Support & Seamless OTA Updates (Newly Upgraded)
*   **Chinese/English Bilingual Support & Persistent Caching**: Detects system language and caches user language selections. Help manuals and diagnostic panels are 100% localized.
*   **Seamless Toast-Style OTA Upgrades**: Replaces old navbar alerts with elegant toast notifications displaying download progress and reboot guides.

### 6. Local Security Gateway & Privacy Protection (New Security Upgrade)
To protect user privacy (especially voice recordings and audio assets) and shield local GPU/CPU hardware resources from unauthorized third-party access:
*   **Dynamic Port Isolation**: Allocates an idle random port on startup for local backend binding. This prevents local malware from sniffing or hijacking the microphone WebSocket audio stream.
*   **Internal API Token Handshake**: Enforces dynamically generated 32-character token validation between Tauri and the Python backend. Any unauthorized local script or app calling the AI engine will be rejected (401 Unauthorized), preventing your GPU/CPU from being stolen for unauthorized inference or mining.
*   **Clock Rollback & Signature Checks**: Integrates encrypted system time validation in `.sys_state` to prevent clock tampering, securing runtime states and logs.

---

## 📥 How to Install & Use

1.  Download and run the `VocalMap.Setup.x.x.x.exe` installer.
2.  Basic features are completely free. Premium multi-dimensional analysis and stem separation features are unlocked after purchasing a Pro license (Monthly: ¥19.9, Lifetime: ¥59.9).
3.  **Optimized Mirror Downloads**: Auto-deploys AI environments from high-speed mirror servers, handling gigabytes of model dependencies seamlessly.
4.  **Hardware Acceleration**: CUDA acceleration is automatically enabled on NVIDIA GPUs.

> [!NOTE]
> NVIDIA GPU owners with CUDA configured will experience tens of times faster stem separation and acoustic analysis.

## Development Guide

See [README_CORE_EN.md](README_CORE_EN.md)
