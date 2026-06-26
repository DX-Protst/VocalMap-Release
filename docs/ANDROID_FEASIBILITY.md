# VocalMap Android 移动端移植可行性评估报告 🎙️📱

本报告针对将 VocalMap（桌面端）移植到 **Android 移动平台** 进行深度技术可行性与重构风险评估。

根据项目当前的架构特征，以及**已明确排除音频分离功能（BS-RoFormer/Logic-RoFormer 神经网络模型不移植）**的前提，评估结论如下：

**评估结论：高度可行 (Highly Feasible)，但需针对平台特性进行中度重构与功能裁剪。**

---

## 🏗️ 核心架构与移动端适配性

VocalMap 现行的 **Tauri v2 + 纯 Rust 原生 DSP 后端 + Web Audio/Canvas 前端** 架构，为移动端移植打下了极佳的底子。

### 1. 跨平台技术栈适配 (Tauri v2 Mobile)
*   **可行性**：**极高**。Tauri v2 已经正式支持 Android 作为一级编译目标。开发团队可以使用 `cargo tauri android init` 一键初始化 Android 工程，将现有的 HTML/CSS/JS 前端静态资源直接打包进 Android System WebView 中。
*   **开发开销**：低。无需抛弃现有的前端界面，且 Rust 后端与前端的原生 IPC 通信模式在 Android 环境下依然有效。

### 2. 前端 UI 响应式与 Canvas 渲染
*   **可行性**：**极高**。
    *   **自适应布局**：VocalMap 已经支持完备的 Flexbox 响应式布局。不管是宽屏还是竖屏窄窗，界面均可弹性填充，符合手机屏幕（特别是竖屏）的操作逻辑。
    *   **Canvas 重绘**：通过全局 `window.doResize()` 实现了画布的防清空重绘与物理像素校准，解决了高 DPI 屏幕下的拉伸模糊。
*   **移动端调整**：
    *   手机屏幕尺寸较小，需微调练声关卡（`training.js`）的 `SCROLL_SPEED`（滚动速度）和 `VIEW_RANGE`（可视音域范围），以防视觉过于拥挤。
    *   交互元素（如按钮、选项卡）需增大点击热区（符合 Android Material Design 建议的 $48 \times 48 \text{ dp}$ 规则）。

### 3. Rust 原生 DSP 算法引擎
*   **可行性**：**极高**。
    *   核心声学算法（YIN 音高追踪、CMNDF 算法、FFT 共鸣计算等）全部通过 Rust 实现（依赖 `rustfft`、`symphonia`、`hound`）。
    *   Rust 完美支持交叉编译至 Android 原生目标（如 `aarch64-linux-android`），并直接以原生机器码（Native Code）形式执行。在手机端，其运算效率和能耗表现均显著优于传统 Java/Kotlin 编写的算法或 Python 解释器。

---

## ⚠️ 核心技术差异点与重构工作量评估

| 模块名称 | 桌面端当前实现 | Android 端适配方案 | 改造可行性 | 风险/改造点 |
| :--- | :--- | :--- | :--- | :--- |
| **AI 音轨分离** | 依赖本地 `python_runtime` 调用 `inference.py`（PyTorch 框架，大小数 GB） | **直接停用/裁剪**。在移动端 UI 隐藏分离入口，相关 IPC 指令报错拦截。 | - (不移植) | ❌ 移动端芯片及内存无法承载本地 BS-RoFormer 推理，已明确剔除。 |
| **设备激活鉴权** | 依赖 `machine-uid` 获取桌面系统硬件唯一标识 | 替换为通过 Rust JNI 接口调用 Android 系统的 `ANDROID_ID` 或引入账号体系。 | 中 | `machine-uid` 不支持 Android，直接编译会报错，需进行平台条件编译隔离。 |
| **音频捕获与权限** | Web Audio API 获取麦克风 PCM 字节流 | 依旧采用 Web Audio API，但需在 `AndroidManifest.xml` 中配置权限，并在 WebView 容器中处理运行时麦克风授权。 | 易 | WebView 需重载权限请求回调以响应浏览器的麦克风请求。 |
| **文件读写与存储** | `tauri-plugin-fs` 读写本地任意路径 `.vmap` / `.tmap` | 适配 Android 的分区存储（Scoped Storage），默认读写应用私有目录，导入导出使用 SAF 系统选择器。 | 中 | 避免直接硬编码绝对路径。 |
| **应用自动更新** | `tauri-plugin-updater` 增量包下载与桌面环境安装 | **禁用桌面更新插件**，改用 Google Play、应用商店分发或提供 APK 直链下载。 | 易 | 移除桌面端 updater 逻辑，避免在 Android 下引起初始化崩溃。 |

---

## 🛠️ 重构与适配实施路线图 (Roadmap)

### 第一阶段：项目裁剪与平台隔离 (1-2 天)
1.  **特征隔离**：在 `Cargo.toml` 中，将桌面端专用插件（如 `tauri-plugin-updater`）设置为平台特定依赖（仅在 `cfg(not(target_os = "android"))` 时启用）。
2.  **停用/隐藏分离入口**：
    *   在前端初始化时，检测当前平台。如果是 Android 平台，通过 CSS/JS 直接隐藏 **“AI 音轨分离”** 选项卡和自定义特训包的导入，防止用户误触。
    *   在后端 `src-tauri/src/commands.rs` 的 `vmap_separate_audio` 处加上编译宏过滤，非桌面平台直接返回不支持错误。

### 第二阶段：Android 设备指纹适配 (2-3 天)
由于 `machine-uid` 无法在 Android 正常工作，需要在 Rust 端对 `get_machine_id` 指令进行适配：
```rust
#[tauri::command]
fn get_machine_id(app: tauri::AppHandle) -> String {
    #[cfg(target_os = "android")]
    {
        // 使用 jni-sys 或 tauri 的安卓 context 调用 Secure.ANDROID_ID
        // 或者直接调用 Android API 生成唯一的设备 UUID
        retrieve_android_uuid(app)
    }
    #[cfg(not(target_os = "android"))]
    {
        machine_uid::get().unwrap_or_else(|_| "unknown_machine_id".to_string())
    }
}
```

### 第三阶段：音视频捕获与系统权限适配 (2-3 天)
1.  在 `AndroidManifest.xml` 中声明麦克风权限：
    ```xml
    <uses-permission android:name="android.permission.RECORD_AUDIO" />
    ```
2.  配置 WebView 权限代理，允许 Web Audio API 捕获输入（若 Tauri 默认插件未自动放行，需在 Java 主 Activity 中配置 `WebChromeClient.onPermissionRequest`）。

### 第四阶段：移动端 UI 细节抛光与真机测试 (3-5 天)
1.  在低端手机上开启“性能模式”（`performanceMode`），限制 Canvas 动态粒子特效，降低功耗与渲染延迟。
2.  使用 `cargo tauri android dev` 连接真机/模拟器进行调试，重点排查低延迟录音手感、横竖屏自适应以及 `.vmap` 诊断包的保存与复盘。
