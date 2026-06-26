# VocalMap Android Porting Feasibility Assessment Report 🎙️📱

This report evaluates the technical feasibility and refactoring risks of porting VocalMap (Desktop) to the **Android mobile platform**.

Given the current architecture of the project and the **explicit exclusion of the audio separation feature (BS-RoFormer/Logic-RoFormer neural network models will not be ported)**, the assessment is as follows:

**Assessment Conclusion: Highly Feasible, with moderate refactoring and feature tailoring required for mobile platform specificities.**

---

## 🏗️ Core Architecture & Mobile Suitability

VocalMap's current architecture—**Tauri v2 + Pure Rust Native DSP Backend + Web Audio/Canvas Frontend**—provides an excellent foundation for mobile porting.

### 1. Cross-Platform Stack Adaptation (Tauri v2 Mobile)
*   **Feasibility**: **Very High**. Tauri v2 officially supports Android as a first-class build target. Developers can use `cargo tauri android init` to initialize the Android project and bundle the existing HTML/CSS/JS frontend static resources directly into the Android System WebView.
*   **Development Overhead**: Low. There is no need to discard the existing frontend UI, and the native IPC communication model between the Rust backend and the frontend remains fully functional in the Android environment.

### 2. Frontend UI Responsiveness & Canvas Rendering
*   **Feasibility**: **Very High**.
    *   **Adaptive Layout**: VocalMap already supports a complete Flexbox-based responsive layout. Whether in wide screen or narrow vertical window, the UI scales elastically, aligning with mobile screen guidelines.
    *   **Canvas Redrawing**: Global `window.doResize()` is used to calibrate the canvas physical pixel dimensions and redraw background grids, preventing stretching and blurriness under high DPI mobile displays.
*   **Mobile Adjustments**:
    *   Due to smaller mobile screen sizes, minor adjustments to the pitch training camp (`training.js`) are required, such as tuning the `SCROLL_SPEED` and `VIEW_RANGE` to avoid visual clutter.
    *   Touch targets (e.g., buttons, tabs) should be enlarged to comply with the Android Material Design recommendations (minimum $48 \times 48 \text{ dp}$).

### 3. Rust Native DSP Engine
*   **Feasibility**: **Very High**.
    *   The core acoustic algorithms (YIN pitch tracking, CMNDF, and FFT resonance evaluation) are fully implemented in Rust (relying on `rustfft`, `symphonia`, and `hound`).
    *   Rust natively supports cross-compilation to Android targets (such as `aarch64-linux-android`) and runs as native machine code. On mobile devices, its computational efficiency and power consumption are significantly better than traditional Java/Kotlin implementations or Python interpreters.

---

## ⚠️ Core Differences & Refactoring Workload Assessment

| Module Name | Desktop Implementation | Android Adaptation Plan | Porting Feasibility | Risks / Refactoring Points |
| :--- | :--- | :--- | :--- | :--- |
| **AI Stem Separation** | Relies on local `python_runtime` to run `inference.py` (PyTorch, size of several GBs) | **Deactivate & Tailor**. Hide the separation tab in the mobile UI; intercept and error-out corresponding backend IPC commands. | - (Not ported) | ❌ Mobile chips and memory cannot bear local BS-RoFormer inference. Explicitly excluded. |
| **Device Licensing** | Relies on `machine-uid` to get hardware unique identifier | Replace with querying `ANDROID_ID` via JNI in Rust or introduce a user account system. | Medium | `machine-uid` does not support Android and will cause compile errors. Conditional compilation flags must be added. |
| **Audio Capture & Permissions** | Web Audio API captures microphone PCM stream | Keep using Web Audio API, but declare permissions in `AndroidManifest.xml` and request microphone access inside the WebView. | Easy | WebView must override permission request callbacks to allow microphone streaming. |
| **File System Access** | `tauri-plugin-fs` reads/writes `.vmap` / `.tmap` files anywhere | Adapt to Android Scoped Storage. Write files to the app's private files/cache directory by default, and use SAF (Storage Access Framework) for exports. | Medium | Avoid hardcoding absolute system paths. |
| **App Auto-Updates** | `tauri-plugin-updater` downloads and runs installers | **Deactivate desktop updater**. Rely on Google Play Store or direct APK downloads for distribution. | Easy | Strip desktop updater code to avoid runtime initialization crashes on Android. |

---

## 🛠️ Porting & Adaptation Roadmap

### Phase 1: Feature Tailoring & Platform Isolation (1-2 Days)
1.  **Dependency Isolation**: In `Cargo.toml`, make desktop-only plugins (like `tauri-plugin-updater`) target-conditional (enabled only when `cfg(not(target_os = "android"))`).
2.  **Hide Separation Features**:
    *   Identify the platform on frontend load. If it's Android, hide the **"AI Stem Separation"** tab and custom tmap imports via CSS/JS.
    *   Add compilation filters to the backend `src-tauri/src/commands.rs` at `vmap_separate_audio` to return unsupported errors immediately for non-desktop targets.

### Phase 2: Android Device ID Adaptation (2-3 Days)
Since `machine-uid` doesn't work on Android, adapt the `get_machine_id` command:
```rust
#[tauri::command]
fn get_machine_id(app: tauri::AppHandle) -> String {
    #[cfg(target_os = "android")]
    {
        // Call Secure.ANDROID_ID using Rust JNI bindings or Tauri Android context
        // Or generate a unique app-specific UUID
        retrieve_android_uuid(app)
    }
    #[cfg(not(target_os = "android"))]
    {
        machine_uid::get().unwrap_or_else(|_| "unknown_machine_id".to_string())
    }
}
```

### Phase 3: Audio Permissions & WebView Configurations (2-3 Days)
1.  Declare microphone permission in `AndroidManifest.xml`:
    ```xml
    <uses-permission android:name="android.permission.RECORD_AUDIO" />
    ```
2.  Configure the WebView permissions client to allow Web Audio API microphone capture.

### Phase 4: Mobile UI Polish & Live Testing (3-5 Days)
1.  Enable "Performance Mode" (`performanceMode`) on budget phones to limit heavy Canvas particle effects, reducing CPU/GPU overhead.
2.  Use `cargo tauri android dev` to deploy to a physical device or emulator, verifying low-latency pitch tracking, vertical scaling, and `.vmap` save/load workflows.
