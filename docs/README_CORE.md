# VocalMap 🎙️

[English Version](README_CORE_EN.md) | 简体中文

> 专业级声乐多维诊断与伴奏/乐器分离系统 (Professional Vocal Diagnosis & Stem Separation System)


VocalMap 是一款面向专业声乐教学、声音诊断与音频后期制作的现代桌面应用。它将**实时声学诊断可视化**与基于 **BS-RoFormer 模型**的专业级高精度音轨/乐器分离完美融合，为歌手、声乐教师及音乐制作人提供一站式的声学分析方案。

本项目已完成从混合架构向**全域纯 Rust IPC驱动**的伟大跃迁，采用了 **Tauri v2 + 原生 Rust DSP 引擎** 的极客暗黑风架构。

---

## 📑 目录

- [✨ 核心特性与技术实现 (Features & Tech)](#-核心特性与技术实现-features--tech)
- [🏗️ 系统架构图 (Architecture)](#️-系统架构图-architecture)
- [📁 代码库核心导航 (Codebase Guide)](#-代码库核心导航-codebase-guide)
- [⚙️ 安装与运行 (Installation & Usage)](#️-安装与运行-installation--usage)
- [🛠️ 开发与构建 (Development)](#️-开发与构建-development)

---

## ✨ 核心特性与技术实现 (Features & Tech)

### 🎧 全方位声学诊断与回放 (`frontend/js/playback.js`, `frontend/js/realtime_monitor.js`)
* **实时演唱录制与回放**：基于 Web Audio API 捕获 PCM 音频流，与底层 Rust DSP 吐出的音高数据强绑定，打包保存为专属 `.vmap` 项目文件。回放时 `realtime_monitor.js` 会通过 Canvas 绘制贝塞尔曲线并自动锁定中心音高。
* **原生 Rust DSP 引擎**：绕过浏览器播放限制，使用极速的 Rust 算法对音频文件进行全量深度诊断。

### 🚀 靶向发声训练营 (Vocal Training Camp, `frontend/js/training.js`)
* **6 大渐进式关卡与自定义靶向特训**：引擎不仅能动态生成 6 大基础关卡，支持将用户导入的离散块状音高序列映射为自定义靶向方块，并精准同步底层 WebM/WAV 伴奏。
* **动态预判运镜 (Look-ahead Camera)**：在 `training.js` 中重构的相机追踪算法，智能平滑跟随即将出现的靶向方块，解决大跨度高音（如 Level 6）目标飞出屏幕的痛点。

### 🎸 专业级 AI 音轨分离 (Stem Separation, `logic_bsroformer/inference.py`)
* **完全独立的子进程挂载**：不再将重型 Python 引擎与本地主干强绑定，改为云端动态下载纯净运行库（`python_runtime`），再由 Rust 利用 `std::process::Command` 脱壳唤起单独的 `inference.py` 执行，实现解耦。
* **双模态数据提取引擎**：新增用于连续音高重绘复盘的 `.vmap` 与 `.tmap` （离散的音阶块）双格式导出，实现从音轨分离到靶向特训的数据闭环。

### 🔒 原生机器码安全屏障 (Native Security Shield)
原本的 Python FastAPI 极易遭受反编译及逆向。现已全部移植为原生 Rust 机器码：
* **时钟回滚防御**：将 `.sys_state` 时间戳指纹以原生加密形式落地存储，防止非法时钟篡改。
* **硬核授权加密**：RSA 私钥混淆与公钥校验全部内置于 Rust 的编译期产物中。

---

## 🏗️ 系统架构图 (Architecture)

VocalMap 已采用**全原生极速双端 IPC 通信架构**：

```mermaid
graph TD
    A[Tauri 主进程 src-tauri/src/main.rs] -->|原生理内存 IPC 调用| C[Webview 渲染前端 frontend/index.html]
    A -->|智能云端装载器 downloader.rs| E[动态提取并下载环境与模型]
    C -->|Rust 原生 DSP (YIN音高检测等) commands.rs| A
    E -->|通过 std::process 唤醒脱壳进程| D[独立的 logic_bsroformer/inference.py 脚本]
```

---

## 📁 代码库核心导航 (Codebase Guide)

为了方便后续维护与协作，以下是本项目最核心的代码结构与对应职能清单：

| 目录/文件 | 核心架构与职能说明 |
| --- | --- |
| `src-tauri/src/main.rs` | 整个程序的 Rust 外壳入口，负责生成硬件设备码、注册各种 IPC 路由。 |
| `src-tauri/src/commands.rs` | 最硬核的声学算法大脑，底层原生 Rust 加速，包含 YIN 音高检测、CMNDF 计算以及授权加解密拦截。 |
| `src-tauri/src/downloader.rs` | Rust 动态下载管理器与解压流水线。彻底解决 AI 模型（数 GB）打包进安装包的超限难题，并智能跳过已有本地包。 |
| `logic_bsroformer/inference.py` | BS-RoFormer 神经网络的推理核心执行脚本，仅作为独立子进程被 Tauri 唤醒。 |
| `frontend/js/separation.js` | 负责音轨分离功能的前端面板逻辑，包括接收底层 Rust 事件轮询并渲染进度动画。 |
| `frontend/js/audio_engine.js` | Web Audio API 核心封装层，实现麦克风物理硬件录音、PCM 波形捕获、加入 DynamicsCompressorNode 处理。 |

---

## ⚙️ 安装与运行 (Installation & Usage)

### 环境要求
* **Node.js** (推荐 LTS 版本)
* **Rust** 编译环境

### 快速启动
1. **安装前端依赖**：
   ```bash
   npm install
   ```
2. **启动 Tauri 测试版环境**：
   ```bash
   npm run dev
   ```

---

## 🛠️ 开发与构建 (Development)

运行自动化编译脚本打包生产版本（10MB级别）：

```bash
.\scripts\build_tauri.ps1
```
* **一键编译**：自动配置 Tauri Updater 秘钥签名环境，并调用 `npx tauri build` 进行打包，直接输出轻量化安装包。