# VocalMap 重大架构升级日志 (Major Architecture Update Log)

> [!IMPORTANT] 
> ⚠️ **重要安全更新建议 (Critical Security Update)**
> 
> **强烈建议所有用户立即更新至最新版本！**
> 本次更新全面升级了授权文件的本地验证机制，启用了全新的**「硬件级安全隔离」**。
> 
> 在过往版本中，若您的设备不慎遭遇恶意软件窥探，不法分子可能会轻易窃取并滥用您的授权凭证。本次安全升级后，您的专属凭证将与您当前电脑的底层硬件机器码进行极高强度的唯一绑定。
> 这意味着，即便授权文件被意外窃取，它在任何其他未知设备上也绝对无法被读取和运行。此举从根源上杜绝了您的私人授权凭证被网络不法分子窃取滥用的风险，全方位保护您的个人数字资产安全。
> **为了给您的设备提供最高级别的防护，请务必尽快升级！**
本次更新是 VocalMap 有史以来最为彻底的一次底层重构。我们彻底剥离了冗余的 Python 后端框架，将核心接力棒全部交还给极速的原生 Rust。

## 🚀 核心架构重构 (Architecture Overhaul)
* **纯 Rust IPC 驱动架构**：全面移除了旧版的 Python FastAPI 后端，转而使用 Tauri 原生的 Rust IPC 进行前后端通信，彻底消灭了 WebSocket 的网络层开销。
* **安装包极限瘦身 (<10MB)**：彻底剔除本地硬捆绑的重型 Python 虚拟环境与 PyTorch 依赖。软件安装包体积从原先臃肿的 500MB+ 史诗级缩减至不到 **10MB**。
* **云端按需加载机制 (On-Demand Cloud Setup)**：
  * AI 环境与分离模型现在会在首次调用时通过国内高速镜像源（ghproxy）动态下载。
  * 引入了全自动的“本地缓存检测”机制，支持离线测试：只需将打包好的 `python_runtime.zip` 或 `.ckpt` 模型直接丢进 `%APPDATA%\com.vocalmap.engine` 及对应子目录，系统将瞬间识别并跳过下载。

## 🎸 AI 分离引擎解耦 (AI Separation Decoupling)
* **独立子进程挂载**：BS-RoFormer 和 Logic-RoFormer 模型的推理逻辑（`inference.py`）现已作为一个完全独立的极简脚本，由 Rust 的 `std::process::Command` 在后台脱壳唤起并进行管道监控。
* **实时管道日志输出**：通过注入 `PYTHONUNBUFFERED=1` 环境变量，彻底解决了 PIP 下载及推理过程中的缓冲区阻塞假象。现在，任何底层的微小进度都能像电影代码瀑布一样实时输出至前端黑框控制台。

## 🔒 原生安全屏障 (Native Security Shield)
* 所有的安全验证体系（包括高强度 RSA 鉴权、XOR 密匙混淆）已全部由 Python 脚本迁移至 **Rust 编译期产物 (Native Machine Code)** 中。
* `license.key` 的解密以及隐藏文件 `.sys_state` 的时钟回滚防作弊判定现在由底层 Rust 引擎掌控，对非法逆向破解和静态特征码提取形成了降维打击。

## ✨ 交互体验与 UI 优化 (UX & UI Enhancements)
* **文件体积精准显示修复**：针对 Tauri 弹窗选择文件导致的 `? MB` 大小丢失问题，通过新增底层的 Rust `vmap_get_file_size` 接口完美解决，每次选取文件都能瞬时读取到精确的 MB 数。
* **沉浸式后台下载**：环境部署弹窗右上角新增了优雅的 `×` (关闭) 按钮。用户在启动数 GB 的核心环境下载后，可直接点击隐藏弹窗回到主界面浏览其他功能，而下载任务将在后台静默全速运行。
* **解压兼容性终极保障**：将环境依赖包的打包格式从 `.7z` 全面回滚并统一至全世界通用度最高的 `.zip` 标准格式（基于 Rust `zip` crate原生解析），彻底解决了不同电脑因缺少 Deflate64 / 复杂滤镜而导致的 `UnsupportedCompressionMethod` 解压闪退灾难。

---
*Update executed automatically via pure native structural migration.*
