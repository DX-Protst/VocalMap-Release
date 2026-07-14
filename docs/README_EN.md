English Version | [简体中文](../README.md)

<img width="1516" height="1523" alt="icon" src="https://github.com/user-attachments/assets/f3b678ec-0c1d-4edc-9644-9b5537762d9a" />


# VocalMap Official Release 🚀


Welcome to the official commercial release of VocalMap! This is a modern, desktop-class vocal diagnosis and stem separation workstation built specifically for vocal training, singing evaluation, and professional audio production.

After a series of complete architectural rewrites and extreme performance optimizations, we bring you the most advanced **pure, minimalistic, and zero-latency** local AI audio processing experience. The latest version evolves in every aspect, not only solidifying its desktop performance but also **officially landing on the Android mobile platform**, letting every sound you make leave a tangible trace, anytime, anywhere!

## 🌟 Core Highlights

### 1. Pure Rust IPC Driven Architecture (New Major Upgrade)
We have completely deprecated the heavy and easily reverse-engineered Python FastAPI framework, migrating the entire underlying architecture to a 100% Tauri Native Rust IPC environment:
*   **10MB Extreme Footprint**: Say goodbye to bulky 500MB+ installers. By removing all bundled local Python dependencies, the new installer size has drastically plummeted to **< 10MB**! All AI runtime environments will be dynamically "pulled on demand" from the cloud during the first run.
*   **Zero-Latency Memory Interaction**: We completely abandoned the overhead of WebSocket network transmission. The acoustic engine now communicates directly with WebAudio via memory-level Rust IPC, reducing pitch tracking and diagnosis latency to microseconds.
*   **Unbreakable Blackbox Security**: No more worries about malicious listening on local ports! Core authentication and DSP parsers (including the high-precision YIN algorithm) have all been rewritten into Rust native machine code, providing an unstoppable anti-reverse engineering shield.
*   **Cross-platform Android Support**: In addition to Windows, it is now fully supported on Android mobile devices. With deeply optimized Webview responsive layouts and touch interactions, you can carry professional acoustic training in your pocket.

### 2. Advanced Target Vocal Training Camp
Stop singing blindly. Based on your selected standard vocal range (or a highly flexible **Custom Range**), the system will dynamically generate highly targeted **6 progressive acoustic training levels**:
*   **3-Second Look-ahead Camera**: Solves the visual blind spot caused by large scale jumps (e.g., from chest voice straight to head voice) where the target flies off-screen. The camera smoothly and intelligently follows the upcoming target.
*   **100ms Visual Latency Compensation Algorithm**: A completely rebuilt "audio-visual synchronization" logic. The piano plays exactly on time, while the judgment block cleverly retreats by 100 milliseconds to perfectly offset the microphone and system calculation latency, giving you the ultimate precision hit feel.
*   **Studio-Grade Dual-Track Dynamics Compressor**: The built-in Web Audio Dynamics Compressor completely unlocks and amplifies the maximum volume of the piano cue. No matter how loud you sing, it remains round and thick, bidding farewell to hard clipping.
*   **New [Custom Target Training] Entry**: We completely bridged the ecosystem loop from stem separation to training! You can now import exclusive `.tmap` custom level files extracted by the AI separation module, allowing you to specifically conquer any high-difficulty song snippet you want to practice.

### 3. Real-time Multidimensional Acoustic Diagnosis Engine
Utilizing the zero-latency **Rust native high-performance signal analysis algorithm** (a YIN pitch tracking variant + H1-H2 resonance evaluation), VocalMap captures and parses vocal features in real-time through your microphone.
*   **6D Holographic Diagnosis Radar (Pro Feature)**: Captures millisecond-level high-order vocal metrics such as pitch accuracy, stability, resonance, and purity. It can even precisely detect professional Vibrato and score it independently.
*   **Dynamic Replay & Review**: All singing trajectories can be packaged into a `.vmap` project file with one click. During playback, the camera centers and locks onto the current pitch, combined with high-precision white baselines and vertical rulers, letting you examine every breath fluctuation as if under a magnifying glass.
*   **High-Res Long Image Export**: Seamlessly export a dark-textured, high-resolution long image diagnostic report with one click. No grey backgrounds or content cropping, making sharing your results a breeze.

### 4. Studio-Grade AI Stem Separation (Pro Feature)
Powered by the current SOTA level **BS-RoFormer** and **Logic-RoFormer** deep learning separation models.
*   **Karaoke Vocal/Instrumental Separation**: Remove original vocals with one click, preserving extremely pure accompaniment and backing vocals.
*   **Omnipotent 6-Stem Instrument Separation**: Precisely dissects mixed audio into Vocals, Piano, Guitar, Bass, Drums, and Others.
*   **Dual-Core Training Package Export**: After separation, the system can not only export a standard `.vmap` review package for playback but also automatically extract a discrete block-like pitch sequence based on the dry vocal track, exporting it as a `.tmap` target training level.
*   **Absolute Data Security**: Pure local GPU/CPU inference. No data is uploaded to any server, ensuring absolutely zero risk of privacy leaks.

### 5. Next-Gen Geek Textured Interaction
*   Fully adopts Liquid Glass high-texture UI, including both Dark/Light dual modes.
*   All interactive animations are accompanied by smooth gradient feedback; **Supports responsive layouts and adaptive scaling**, meaning both high-res displays and narrow/vertical windows scale fluidly using Flexbox elastic fitting with automated canvas redraws to prevent layout issues.
*   **Independent Unobstructed Activation/Status Panel**: Completely rebuilt the Pro activation and status viewing logic, abandoning traditional global overlays in favor of smooth, full-size workspace transitions.

### 6. Global Multilingual & Seamless Update Experience
*   **Bilingual Mode (EN/ZH) & Persistent Caching**: Features automatic system language detection (initializing to English/Chinese based on OS locale on first launch) and persistent user selection caching. The entire UI, parameter panels, and the **comprehensive Help & Diagnosis Manual** are 100% localized.
*   **Seamless Pop-up OTA Updates**: The hard-coded update text in the top nav bar has been removed. Update progress, download percentages, failure warnings, and reboot prompts now utilize elegant Toast notifications.

---

## 📥 Installation & Usage

1.  Download and run the `VocalMap.Setup.x.x.x.exe` installer provided below.
2.  Upon launching the app, the basic features on the homepage are completely free. Advanced multi-dimensional analysis and stem separation features will be unlocked upon payment.
3.  **On-Demand Cloud Setup**: When using the Pro AI features for the first time, the program will automatically deploy an independent lightweight runtime environment from cloud mirrors.
4.  Once deployed, enjoy the extreme audio-visual experience brought by fast local GPU/CPU acceleration!

> [!NOTE]
> If your computer has an NVIDIA graphics card, the program will automatically identify and enable CUDA parallel acceleration after downloading the environment, providing a multifold speedup for complex stem separation and audio inference!

## 📱 Mobile (Android) Officially Supported

After relentless efforts from our engineering team, VocalMap now officially supports the **Android mobile platform**! It perfectly inherits the desktop-class high-texture UI interactions while completely rewriting the underlying security mechanisms and file flows for mobile.
*   **Native Cross-Platform Architecture**: Retains the core processing pipeline of Tauri v2 + Rust Native DSP Engine. All pitch tracking performance (YIN algorithm, etc.) remains buttery smooth on mobile devices.
*   **Mobile-Specific Optimizations**: Deeply integrated with Android native APIs. We have refactored the underlying fingerprint authentication module (using `ANDROID_ID`) and fully adapted to the mobile Scoped Storage permission model.
*   **Streamlined Mobile Features**: **The AI stem separation module (BS-RoFormer model) has been explicitly excluded and disabled on mobile due to heavy hardware resource requirements**, but the corresponding format conversion and core training features are fully retained.
*   **Mobile-Specific Optimizations**:
    *   **Adaptive UI Layout (R1)**: Viewport meta tag is upgraded to restrict scale/zoom, and CSS media queries are adjusted for viewports under 900px and touch-only devices with coarse pointers.
    *   **Smooth High-Frame-Rate Rendering (R2)**: Optimizes canvas rendering by extending the offscreen background canvas cache to all non-training modes, synchronizing frames using `requestAnimationFrame`, and disabling heavy `shadowBlur` properties specifically on Android for buttery-smooth performance.
    *   **Window Anchoring & Bouncing Prevention (R3)**: Sets `html, body` width/height to `100%` with `position: fixed` and intercepts default `touchmove` events (except in designated scrolling areas) to avoid mobile-specific viewport dragging/bouncing.
    *   **Dependency Download Bypass (R4)**: Since the offline Python AI engine is removed, both frontend `separation.js` and backend Rust commands automatically bypass local dependency checks.
    *   **Secure Payment Routing (R5)**: Purchase operations delegate ordering to the secure Tauri Rust command `vmap_request_payment` which interfaces with payment gateways and safely prompts browser redirects.

For detailed architecture porting and refactoring documents, see: [Android Porting Refactoring Record](ANDROID_FEASIBILITY_EN.md)

## 📄 Copyright & Security Compliance
This project (including but not limited to the Tauri frontend shell, Rust native backend engine, core acoustic analysis algorithms, and independent AI separation modules) holds complete independent intellectual property rights.
*   **Non-Commercial Restriction**: This project is licensed under the **PolyForm Noncommercial License 1.0.0**. Without official written commercial permission, no organization or individual may use this project, code, or compiled products for any commercial purposes.
*   **Strict Ban on Cracking & Illegal Redistribution**: The security verifications built into this software (e.g., RSA native encryption checks, system clock anti-cheat detection, etc.) are statutory "technological protection measures". Any act of intentionally circumventing, cracking, or destroying these measures is illegal.
*   **Legal Rights Statement**: We reserve all legal rights, including DMCA takedowns, civil lawsuits, and criminal liability pursuits for any acts of destroying technical protection measures, redistributing cracked versions, or unauthorized commercial infringement.

## 🛠️ Software Development Guide
See [README_CORE_EN.md](README_CORE_EN.md)
