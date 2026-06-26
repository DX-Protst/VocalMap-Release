# Project: VocalMap Client Optimization & Bug Fixes

## Architecture
- **Frontend**: Single page application written in HTML/CSS/JS (`frontend/index.html`, `frontend/style.css`, `frontend/js/`).
- **Backend**: Native Rust IPC (Tauri Core) handling commands, settings, authorization, and process management.
- **AI Inference Engine**: `logic_bsroformer/` performing audio separation using PyTorch, run via native OS processes.

## Code Layout
- Frontend UI: `frontend/index.html`, `frontend/style.css` (compiled from `frontend/src/`)
- Frontend Scripts: `frontend/js/` (containing `globals.js`, `realtime_monitor.js`, `training.js`, `updater_settings.js`, `separation.js`)
- Native Backend: `src-tauri/src/` (Rust core)
- Inference Code: `logic_bsroformer/inference.py`

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | Audio Separation Progress Display Fix | Trace progress outputs, capture backend logs, update frontend UI. | None | DONE |
| 2 | Pure Rust Native Migration | Remove Python FastAPI, integrate RSA verification, XOR encryption into Tauri Rust IPC. | M1 | DONE |
| 3 | Canvas Initialization & Resize Redraw Fixes | Expose `window.doResize()` to handle dynamic canvas scaling, initial load background grid rendering, window resize event redrawing, tab-switching adjustments, and training camp canvas initialization. | M2 | DONE |
| 4 | Activation Page Scrollbar & Layout Fixes | Add custom scrollbar to `#licenseWorkspace` and adjust flex direction to top alignment to allow scrolling to the unbind button on narrow screens. | M3 | DONE |
| 5 | Navigation Bar Localization & Layout Fixes | Add missing English translations for Control Center card titles, and wrap translated text in responsive hide wrappers to fix mid-width overflow bugs. | M4 | DONE |
| 6 | Scroll Container and Glow Alignment Fixes | Add .flex-col to training session left panel to correct mobile height scaling, decouple `#licenseWorkspace` scrolling from glass-panel class, wrap content in inner card, and fix mobile min-height to enable proper scrollbars and align hover glow. | M5 | DONE |
