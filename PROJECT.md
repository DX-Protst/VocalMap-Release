# Project: Vocal Map Audio Separation Progress Display Fix

## Architecture
- **Frontend**: Single page application written in HTML/CSS/JS (`frontend/index.html`, `frontend/style.css`, `frontend/js/`).
- **Backend**: FastAPI server (`backend/app.py`) running locally.
- **AI Inference Engine**: `logic_bsroformer/` performing separation using PyTorch.
- **Port/API Security**: Tauri starts FastAPI on a random port, passes the port and `VOCALMAP_INTERNAL_TOKEN` as environment variables. Frontend uses these to communicate with the backend.

## Code Layout
- Frontend UI: `frontend/index.html`, `frontend/style.css`
- Frontend Scripts: `frontend/js/separation.js`, `frontend/js/globals.js`
- Backend Router/Server: `backend/app.py`
- Separation Manager: `backend/separation.py`
- Inference Code: `logic_bsroformer/inference.py`

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | Exploration & Root Cause Analysis | Tracing full pipeline (inference tqdm output -> backend capture -> network channel -> frontend state & DOM updates). | None | DONE (IDs: e5331904, 309e1daa, 0ed93bc3) |
| 2 | Full-Stack Implementation & Progress Wire-up | Fix frontend label swap, combine progress & status, optimize backend read, timeout, thread-safe lock. | M1 | IN_PROGRESS |
| 3 | System Verification & Audit | Verify fixes using Reviewer, Challenger, and Forensic Auditor. | M2 | PLANNED |

## Interface Contracts
- **Communication Security**:
  - Request Header: `X-VocalMap-Token` must match `VOCALMAP_INTERNAL_TOKEN` on all HTTP API calls to backend.
  - Port Selection: Dynamically randomly allocated, frontend queries the port or retrieves it.
