import json
import logging
import multiprocessing
import numpy as np
import uvicorn
import os
import sys
import tempfile
import shutil
import urllib.request
import urllib.error
import threading
import ctypes
import secrets
import time
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File, BackgroundTasks, Form, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

# 强制将 backend 目录加入 sys.path，防止便携版 Python 找不到模块
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

def watch_parent_process():
    parent_pid = os.environ.get("VOCALMAP_PARENT_PID")
    if not parent_pid:
        return
    try:
        parent_pid = int(parent_pid)
    except ValueError:
        return

    def _watcher():
        if sys.platform == "win32":
            kernel32 = ctypes.windll.kernel32
            SYNCHRONIZE = 0x00100000
            handle = kernel32.OpenProcess(SYNCHRONIZE, False, parent_pid)
            if not handle:
                os._exit(0)
            kernel32.WaitForSingleObject(handle, 0xFFFFFFFF)
            kernel32.CloseHandle(handle)
            os._exit(0)
            
    t = threading.Thread(target=_watcher, daemon=True)
    t.start()

# Start the watcher immediately upon Python execution
watch_parent_process()

# PyInstaller --onedir 打包后 sys._MEIPASS 指向 _internal/ 临时解压目录，
# 其中的 acoustic_engine/ 模块需要加入 sys.path 才能被 import 找到。
if hasattr(sys, '_MEIPASS'):
    _internal = sys._MEIPASS
    if _internal not in sys.path:
        sys.path.insert(0, _internal)

from acoustic_engine.analyzer import VocalAnalyzer, verify_pro_license, LicenseError
from services.reporter import generate_comprehensive_report

# ==========================================
# 0.5 内部 API 通信令牌与 Pro 校验辅助函数
# ==========================================
INTERNAL_TOKEN = os.environ.get("VOCALMAP_INTERNAL_TOKEN") or secrets.token_hex(16)
SEPARATION_PROGRESS_PROTOCOL = "threaded-progress-v2"

def enforce_pro_license():
    try:
        verify_pro_license()
    except LicenseError as le:
        raise HTTPException(status_code=403, detail=str(le))

# 音轨分离引擎 (Pro功能) - 使用 BS-RoFormer 模型
try:
    from separation import get_separation_engine, MODEL_REGISTRY
    SEPARATION_AVAILABLE = True
except ImportError as e:
    SEPARATION_AVAILABLE = False
    print(f"[WARN] 音轨分离引擎不可用: {e}")

# ==========================================
# 1. 基础配置与引擎初始化
# ==========================================
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("VocalMap_Engine")

app = FastAPI(title="VocalMap Backend Engine")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def check_api_token(request: Request, call_next):
    path = request.url.path
    if path in ["/api/license/status", "/api/license/activate", "/api/log", "/api/status"]:
        return await call_next(request)
        
    if request.method == "OPTIONS":
        return await call_next(request)

    token = request.headers.get("X-VocalMap-Token") or request.query_params.get("token")
    if not token or token != INTERNAL_TOKEN:
        return JSONResponse({"error": "Unauthorized: Invalid API Token"}, status_code=401)
        
    return await call_next(request)

analyzer = VocalAnalyzer(canvas_height=500)

# 云服务器地址 (用于许可证验证)
CLOUD_SERVER_URL = os.environ.get("VMAP_CLOUD_URL", "http://66.112.209.251:8000")

# ==========================================
# 1.5 音轨分离引擎初始化 (Pro功能)
# ==========================================
separation_engine = None
if SEPARATION_AVAILABLE:
    try:
        separation_engine = get_separation_engine()
        print("[OK] 音轨分离引擎模块已就绪")
        print(f"     可用模型: {list(MODEL_REGISTRY.keys())}")
    except Exception as e:
        print(f"[WARN] 音轨分离引擎初始化失败: {e}")

# 分离任务状态存储
separation_tasks = {}
separation_tasks_lock = threading.Lock()

# ==========================================
# 3. 路由与通信网关 (移除Emoji防GBK崩溃版)
# ==========================================
@app.get("/api/status")
async def get_status():
    status_info = {"status": "ready", "engine": "VocalMap Acoustic Engine v3.0"}
    if SEPARATION_AVAILABLE and separation_engine:
        status_info["separation_engine"] = separation_engine.get_model_info()
    return status_info

@app.post("/api/log")
async def log_frontend_message(request: Request):
    """接收并打印前端发送的日志/异常信息到 Python 控制台"""
    try:
        data = await request.json()
        message = data.get("message", "")
        logger.error(f"[FRONTEND EXCEPTION] {message}")
        return {"status": "ok"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

from fastapi.concurrency import run_in_threadpool

@app.post("/api/analyze_buffer")
async def analyze_buffer_api(request: Request):
    """接收原始的 Int16 PCM 音频字节，进行离线高速分析"""
    enforce_pro_license()
    audio_bytes = await request.body()
    # 放入线程池防止阻塞异步主循环
    report = await run_in_threadpool(generate_comprehensive_report, audio_bytes, analyzer)
    return JSONResponse({"type": "pro_report", "report": report})

# ---------- 许可证验证 (代理到云服务器) ----------
@app.get("/api/license/status")
async def get_license_status(machine_id: str = ""):
    """查询设备许可证状态 (优先云端同步，失败则离线验证)"""
    if not machine_id:
        return {"valid": False, "message": "缺少 machine_id 参数"}

    from acoustic_engine.analyzer import verify_pro_license, LicenseError

    try:
        url = f"{CLOUD_SERVER_URL}/api/verify_license?machine_id={urllib.request.quote(machine_id)}"
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode())
            if data.get("valid") and "license_payload" in data:
                with open(os.path.join(os.path.dirname(__file__), "license.key"), "w", encoding="utf-8") as f:
                    json.dump({
                        "license_payload": data["license_payload"],
                        "license_signature": data["license_signature"]
                    }, f)
            return data
    except Exception as e:
        # 网络失败，降级为本地校验
        try:
            payload = verify_pro_license()
            return {
                "valid": True,
                "plan_type": payload.get("plan_type"),
                "expires_at": payload.get("expires_at"),
                "message": "许可证有效 (离线验证)"
            }
        except LicenseError as le:
            return {"valid": False, "message": str(le)}
        except Exception:
            return {"valid": False, "message": "网络未连接且无本地许可证。"}


@app.post("/api/license/activate")
async def activate_license(request: Request):
    """激活 CDK (代理到云服务器)"""
    data = await request.json()

    try:
        body = json.dumps(data).encode("utf-8")
        req = urllib.request.Request(
            f"{CLOUD_SERVER_URL}/api/activate_cdk",
            data=body,
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())
            if data.get("success") and "license_payload" in data:
                with open(os.path.join(os.path.dirname(__file__), "license.key"), "w", encoding="utf-8") as f:
                    json.dump({
                        "license_payload": data["license_payload"],
                        "license_signature": data["license_signature"]
                    }, f)
            return data
    except urllib.error.URLError as e:
        return {"success": False, "message": f"无法连接许可证服务器: {str(e)}"}
    except Exception as e:
        return {"success": False, "message": f"激活请求异常: {str(e)}"}


# ---------- Pro: 音轨分离 ----------
@app.get("/api/separation/device-info")
async def get_separation_device_info():
    """获取 GPU/CPU 设备信息与警告"""
    if not SEPARATION_AVAILABLE or not separation_engine:
        return JSONResponse({"error": "音轨分离引擎不可用"}, status_code=503)
    return separation_engine.get_device_info()

@app.get("/api/separation/models")
async def list_separation_models(category: str = ""):
    """列出可用的音轨分离模型，可按 category 过滤 (instruments/vocals)"""
    if not SEPARATION_AVAILABLE or not separation_engine:
        return JSONResponse({"error": "音轨分离引擎不可用"}, status_code=503)
    models = {}
    for key, info in MODEL_REGISTRY.items():
        if category and info.get("category") != category:
            continue
        models[key] = {
            "name": info["name"],
            "category": info.get("category", ""),
            "instruments": info["instruments"],
            "instrument_labels": info.get("instrument_labels", {}),
            "description": info.get("description", ""),
            "est_vram_gb": info.get("est_vram_gb", 0),
        }
    return {"models": models}

@app.post("/api/separation/separate")
async def separate_audio(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    model_key: str = Form("logic_roformer_6s"),
    force_cpu: bool = Form(False),
):
    """上传音频文件并进行音轨分离"""
    enforce_pro_license()
    import uuid

    if not SEPARATION_AVAILABLE or not separation_engine:
        return JSONResponse({"error": "音轨分离引擎不可用"}, status_code=503)

    if model_key not in MODEL_REGISTRY:
        return JSONResponse({"error": f"未知模型: {model_key}"}, status_code=400)

    # 保存上传文件
    task_id = str(uuid.uuid4())[:8]
    task_dir = os.path.join(tempfile.gettempdir(), f"vocalmap_sep_{task_id}")
    os.makedirs(task_dir, exist_ok=True)

    ext = os.path.splitext(file.filename)[1].lower() if file.filename else ".wav"
    if not ext: ext = ".wav"
    
    input_path = os.path.join(task_dir, f"input{ext}")
    try:
        content = await file.read()
        with open(input_path, "wb") as f:
            f.write(content)
    except Exception as e:
        return JSONResponse({"error": f"文件保存失败: {e}"}, status_code=500)

    # 后台执行分离
    output_dir = os.path.join(task_dir, "output")
    with separation_tasks_lock:
        separation_tasks[task_id] = {
            "status": "processing",
            "progress": 0,
            "status_text": "任务已创建，正在准备分离引擎...",
            "logs": [
                f"Task {task_id} created. Uploaded file saved to {input_path}",
            ],
            "updated_at": time.time(),
        }

    def _run_separation():
        try:
            def update_progress(p: int, text: str = None, **kwargs):
                log_line = kwargs.get("log")
                with separation_tasks_lock:
                    task_state = separation_tasks.get(task_id)
                    if not task_state:
                        return
                    if p is not None:
                        try:
                            task_state["progress"] = max(0, min(100, int(p)))
                        except (TypeError, ValueError):
                            pass
                    if text:
                        task_state["status_text"] = text
                    elif log_line:
                        task_state["status_text"] = log_line
                    if log_line:
                        logs = task_state.setdefault("logs", [])
                        logs.append(str(log_line))
                        del logs[:-80]
                    task_state["updated_at"] = time.time()

            update_progress(None, "后端分离线程已启动，准备调用分离引擎...", log="Backend separation thread started.")
            update_progress(None, "正在进入分离引擎 separate_file()...", log=f"Calling separation engine with model={model_key}, force_cpu={force_cpu}")
            results = separation_engine.separate_file(
                input_path, output_dir, model_key=model_key, force_cpu=force_cpu, progress_callback=update_progress
            )
            update_progress(98, "分离引擎已返回结果，正在整理输出文件...", log="Separation engine returned results. Collecting stems.")
            stems = {}
            for instr, path in results.items():
                if instr != "_mix":
                    stems[instr] = path
            with separation_tasks_lock:
                separation_tasks[task_id] = {
                    "status": "completed",
                    "progress": 100,
                    "status_text": "分离完成",
                    "logs": separation_tasks.get(task_id, {}).get("logs", []),
                    "updated_at": time.time(),
                    "stems": stems,
                    "output_dir": output_dir,
                    "model_info": separation_engine.get_model_info(),
                    "device_info": separation_engine.get_device_info(),
                }
        except Exception as e:
            import traceback
            traceback.print_exc()
            with separation_tasks_lock:
                previous = separation_tasks.get(task_id, {})
                separation_tasks[task_id] = {
                    "status": "error",
                    "progress": previous.get("progress", 0),
                    "status_text": "分离出错",
                    "logs": previous.get("logs", []),
                    "updated_at": time.time(),
                    "error": str(e),
                }

    worker = threading.Thread(
        target=_run_separation,
        name=f"vocalmap-separation-{task_id}",
        daemon=True,
    )
    worker.start()
    with separation_tasks_lock:
        separation_tasks[task_id]["worker_started"] = True
        separation_tasks[task_id]["worker_name"] = worker.name
        separation_tasks[task_id]["updated_at"] = time.time()
        separation_tasks[task_id].setdefault("logs", []).append(f"Worker thread {worker.name} started.")

    return {
        "task_id": task_id,
        "status": "processing",
        "worker_started": True,
        "progress_protocol": SEPARATION_PROGRESS_PROTOCOL,
    }

@app.get("/api/separation/task/{task_id}")
async def get_separation_task(task_id: str):
    """查询分离任务状态"""
    with separation_tasks_lock:
        task = separation_tasks.get(task_id)
        if task:
            task = dict(task)
            task["logs"] = list(task.get("logs", []))
    if not task:
        return JSONResponse({"error": "任务不存在"}, status_code=404)
    return task

@app.get("/api/separation/download/{task_id}/{stem}")
async def download_separation_stem(task_id: str, stem: str):
    """下载分离后的轨道文件"""
    with separation_tasks_lock:
        task = separation_tasks.get(task_id)
    if not task or task["status"] != "completed":
        return JSONResponse({"error": "任务未完成"}, status_code=404)

    path = task["stems"].get(stem)
    if not path or not os.path.exists(path):
        return JSONResponse({"error": f"轨道 {stem} 不存在"}, status_code=404)

    return FileResponse(path, media_type="audio/wav",
                        filename=f"{task_id}_{stem}.wav")

@app.post("/api/separation/save_to_disk")
async def save_separation_to_disk(request: Request):
    """直接将分离后的轨道文件复制到用户指定的路径（零数据传输开销）"""
    data = await request.json()
    task_id = data.get("task_id")
    stem = data.get("stem")
    save_path = data.get("save_path")

    with separation_tasks_lock:
        task = separation_tasks.get(task_id)
    if not task or task["status"] != "completed":
        return JSONResponse({"error": "任务未完成"}, status_code=404)

    path = task["stems"].get(stem)
    if not path or not os.path.exists(path):
        return JSONResponse({"error": f"轨道 {stem} 不存在"}, status_code=404)

    try:
        import shutil
        shutil.copy(path, save_path)
        return {"status": "success"}
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@app.post("/api/separation/export_tmap")
async def export_tmap(request: Request):
    """提取人声音高量化为训练营方块，并打包为 .tmap 和 webm"""
    data = await request.json()
    task_id = data.get("task_id")
    save_path = data.get("save_path")

    with separation_tasks_lock:
        task = separation_tasks.get(task_id)
    if not task or task["status"] != "completed":
        return JSONResponse({"error": "任务未完成"}, status_code=404)

    vocals_path = task["stems"].get("Vocals") or task["stems"].get("vocals")
    inst_path = task["stems"].get("Instrumental") or task["stems"].get("instrumental")
    
    if not vocals_path or not os.path.exists(vocals_path) or not inst_path or not os.path.exists(inst_path):
        return JSONResponse({"error": "未找到有效的轨道 (vocals/instrumental)"}, status_code=404)

    try:
        from acoustic_engine.analyzer import generate_quantized_pitch_track
        blocks = generate_quantized_pitch_track(vocals_path)
        if not blocks: return JSONResponse({"error": "音高提取失败或数据太短"}, status_code=500)
            
        with open(save_path, "w", encoding="utf-8") as f: json.dump(blocks, f)
        webm_path = save_path.replace('.tmap', '') + '.webm'
        import shutil; shutil.copy(inst_path, webm_path)
        return {"status": "success", "tmap_path": save_path, "webm_path": webm_path}
    except Exception as e:
        import traceback; traceback.print_exc()
        return JSONResponse({"error": str(e)}, status_code=500)

@app.post("/api/separation/export_vmap")
async def export_vmap(request: Request):
    """提取人声连续平滑音高，并打包为 .vmap 和 webm"""
    data = await request.json()
    task_id = data.get("task_id")
    save_path = data.get("save_path")

    with separation_tasks_lock:
        task = separation_tasks.get(task_id)
    if not task or task["status"] != "completed": return JSONResponse({"error": "任务未完成"}, status_code=404)

    vocals_path = task["stems"].get("Vocals") or task["stems"].get("vocals")
    inst_path = task["stems"].get("Instrumental") or task["stems"].get("instrumental")
    
    if not vocals_path or not os.path.exists(vocals_path) or not inst_path or not os.path.exists(inst_path):
        return JSONResponse({"error": "未找到有效的轨道 (vocals/instrumental)"}, status_code=404)

    try:
        from acoustic_engine.analyzer import generate_continuous_pitch_track
        timeline = generate_continuous_pitch_track(vocals_path)
        if not timeline: return JSONResponse({"error": "音高提取失败或数据太短"}, status_code=500)
            
        with open(save_path, "w", encoding="utf-8") as f: json.dump(timeline, f)
        webm_path = save_path.replace('.vmap', '') + '.webm'
        import shutil; shutil.copy(inst_path, webm_path)
        return {"status": "success", "vmap_path": save_path, "webm_path": webm_path}
    except Exception as e:
        import traceback; traceback.print_exc()
        return JSONResponse({"error": str(e)}, status_code=500)


@app.post("/api/convert/process")
async def convert_process(
    target_format: str = Form(...),
    save_path: str = Form(None),
    source_path: str = Form(None),
    webm_source_path: str = Form(None),
    file: UploadFile = File(None),
    webm_file: UploadFile = File(None)
):
    """
    Format conversion logic:
    - .wav -> .vmap or .tmap
    - .vmap -> .tmap
    - .tmap -> .vmap
    """
    import tempfile
    import os
    import json
    import shutil
    
    temp_dir = None
    file_path = None
    
    try:
        if source_path and os.path.exists(source_path):
            file_path = source_path
            ext = source_path.lower().split('.')[-1]
        elif file:
            ext = file.filename.lower().split('.')[-1]
            temp_dir = tempfile.mkdtemp()
            file_path = os.path.join(temp_dir, file.filename)
            with open(file_path, "wb") as f:
                shutil.copyfileobj(file.file, f)
        else:
            return JSONResponse({"error": "No file or source_path provided"}, status_code=400)
            
        result = {}
        
        if ext in ['wav', 'mp3', 'flac']:
            from acoustic_engine.analyzer import generate_continuous_pitch_track, generate_quantized_pitch_track
            if target_format == 'tmap':
                data = generate_quantized_pitch_track(file_path)
                result = {"status": "success", "data": {"status": "success", "blocks": data}, "ext": "tmap"}
            elif target_format == 'vmap':
                data = generate_continuous_pitch_track(file_path)
                result = {"status": "success", "data": {"status": "success", "timeline": data}, "ext": "vmap"}
            else:
                return JSONResponse({"error": f"Unsupported target format: {target_format}"}, status_code=400)
                
        elif ext == 'vmap' and target_format == 'tmap':
            with open(file_path, 'r', encoding='utf-8') as f:
                vmap_data = json.load(f)
            
            # vmap is a list of timeline objects or dict with timeline
            timeline = vmap_data.get("timeline", vmap_data) if isinstance(vmap_data, dict) else vmap_data
            
            # extract midis
            import numpy as np
            from scipy.signal import medfilt
            
            midis = []
            times = []
            for point in timeline:
                times.append(point["time"])
                pitch_hz = point["pitch"]
                if pitch_hz > 0:
                    midis.append(69 + 12 * np.log2(pitch_hz / 440.0))
                else:
                    midis.append(0.0)
                    
            midis = np.array(midis)
            filtered = medfilt(midis, kernel_size=7)
            
            quantized = np.zeros_like(filtered)
            current_q = 0
            for i in range(len(filtered)):
                raw = filtered[i]
                if raw == 0:
                    current_q = 0
                    quantized[i] = 0
                else:
                    if current_q == 0:
                        current_q = round(raw)
                    else:
                        if abs(raw - current_q) > 0.8:
                            current_q = round(raw)
                    quantized[i] = current_q
                    
            blocks = []
            current_midi = 0
            start_time = 0

            for i in range(len(times)):
                m = quantized[i]
                t = times[i] / 1000.0  # seconds
                if m != current_midi:
                    if current_midi > 0:
                        blocks.append({
                            "startTime": float(round(start_time, 3)),
                            "duration": float(round(t - start_time, 3)),
                            "midi": int(current_midi),
                            "type": "chest" if current_midi < 65 else ("head" if current_midi > 72 else "mixed"),
                            "instruction": ""
                        })
                    current_midi = m
                    start_time = t
                    
            if current_midi > 0:
                blocks.append({
                    "startTime": float(round(start_time, 3)),
                    "duration": float(round((times[-1]/1000.0) - start_time, 3)),
                    "midi": int(current_midi),
                    "type": "chest" if current_midi < 65 else ("head" if current_midi > 72 else "mixed"),
                    "instruction": ""
                })
                
            merged_blocks = []
            for b in blocks:
                if not merged_blocks:
                    merged_blocks.append(b)
                    continue
                    
                prev = merged_blocks[-1]
                gap = b["startTime"] - (prev["startTime"] + prev["duration"])
                if prev["midi"] == b["midi"] and gap < 0.25:
                    prev["duration"] = float(round(b["startTime"] + b["duration"] - prev["startTime"], 3))
                else:
                    merged_blocks.append(b)
                    
            final_blocks = [b for b in merged_blocks if b["duration"] >= 0.15]
            result = {"status": "success", "data": {"status": "success", "blocks": final_blocks}, "ext": "tmap"}
            
        elif ext == 'tmap' and target_format == 'vmap':
            with open(file_path, 'r', encoding='utf-8') as f:
                tmap_data = json.load(f)
            blocks = tmap_data.get("blocks", tmap_data) if isinstance(tmap_data, dict) else tmap_data
            
            # Flatten to timeline
            timeline = []
            end_time = max([b["startTime"] + b["duration"] for b in blocks]) if blocks else 0
            
            current_time = 0.0
            step = 0.0464
            while current_time <= end_time:
                pitch = 0.0
                for b in blocks:
                    if b["startTime"] <= current_time <= (b["startTime"] + b["duration"]):
                        midi = b["midi"]
                        pitch = 440.0 * (2.0 ** ((midi - 69) / 12.0))
                        break
                timeline.append({"time": round(current_time * 1000.0, 1), "pitch": round(pitch, 2)})
                current_time += step
                
            result = {"status": "success", "data": {"status": "success", "timeline": timeline}, "ext": "vmap"}
        else:
            result = {"error": f"Unsupported conversion: {ext} -> {target_format}"}
            
        if save_path and "error" not in result:
            import re
            with open(save_path, "w", encoding="utf-8") as f: json.dump(result["data"], f)
            # Create webm copy if possible
            webm_path = re.sub(r'(?i)\.' + target_format + '$', '.webm', save_path)
            if save_path == webm_path: webm_path = save_path + '.webm'
            
            if webm_source_path and os.path.exists(webm_source_path):
                shutil.copy(webm_source_path, webm_path)
            elif webm_file and webm_file.filename:
                with open(webm_path, "wb") as f: shutil.copyfileobj(webm_file.file, f)
            elif ext in ['wav', 'mp3', 'flac']:
                shutil.copy(file_path, webm_path)
            elif source_path:
                possible_src_webm = re.sub(r'(?i)\.' + ext + '$', '.webm', source_path)
                if possible_src_webm == source_path: possible_src_webm = source_path + '.webm'
                if os.path.exists(possible_src_webm) and possible_src_webm != webm_path:
                    shutil.copy(possible_src_webm, webm_path)
            result["saved_path"] = save_path
            
        # Cleanup
        if temp_dir and os.path.exists(temp_dir):
            try:
                os.remove(file_path)
                os.rmdir(temp_dir)
            except:
                pass
        
        if "error" in result:
            return JSONResponse(result, status_code=400)
        return result
        
    except Exception as e:
        import traceback; traceback.print_exc()
        return JSONResponse({"error": str(e)}, status_code=500)


@app.get("/api/separation/preload/{model_key}")
async def preload_separation_model(model_key: str = "logic_roformer_6s"):
    """预加载音轨分离模型 (减少首次分离的等待时间)"""
    enforce_pro_license()
    if not SEPARATION_AVAILABLE or not separation_engine:
        return JSONResponse({"error": "音轨分离引擎不可用"}, status_code=503)
    try:
        separation_engine.load_model(model_key)
        return {"status": "loaded", "model": model_key}
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, token: str = ""):
    if not token or token != INTERNAL_TOKEN:
        await websocket.accept()
        await websocket.send_json({"error": "Unauthorized: Invalid API Token"})
        await websocket.close(code=1008)
        return

    await websocket.accept()
    is_recording = False
    audio_buffer = bytearray() 
    
    frame_count = 0 
    print("[OK] 后端 WebSocket 握手成功，等待前端数据...")
    
    try:
        while True:
            message = await websocket.receive()
            
            text_data = message.get("text")
            bytes_data = message.get("bytes")
            
            if text_data:
                try:
                    cmd = json.loads(text_data)
                    action = cmd.get("action")
                    
                    if action == "start_record":
                        is_recording = True
                        audio_buffer.clear()
                        print("[REC] [Pro] 收到信令：开始全息录制...")
                        
                    elif action == "stop_record":
                        is_recording = False
                        print(f"[DONE] [Pro] 录制结束。共极地 {len(audio_buffer)} 字节数据...")
                        
                        try:
                            verify_pro_license()
                            report = generate_comprehensive_report(audio_buffer, analyzer)
                        except LicenseError as le:
                            print(f"[WARN] [Pro] 录制报告被拦截: {le}")
                            report = {"status": "error", "message": str(le)}
                        except Exception as e:
                            import traceback
                            print(f"[ERROR] 报告生成异常: {e}")
                            traceback.print_exc()
                            report = {"status": "error", "message": str(e)}
                            
                        await websocket.send_json({
                            "type": "pro_report",
                            "report": report
                        })
                    elif action == "update_settings":
                        settings = cmd.get("settings", {})
                        analyzer.update_settings(settings)
                        print(f"[SETTINGS] 引擎参数已更新: {settings}")
                except Exception as e:
                    print(f"[ERROR] 信令解析异常: {e}")

            elif bytes_data:
                frame_count += 1
                if frame_count % 50 == 0:
                    print(f"[HEARTBEAT] 已接收 {frame_count} 帧音频数据，通道畅通...")

                audio_data = bytes_data
                metrics = analyzer.process_chunk(audio_data, 44100)
                if metrics:
                    await websocket.send_json(metrics)
                
                if is_recording:
                    audio_buffer.extend(audio_data)

    except WebSocketDisconnect:
        print("[WARN] WebSocket 正常断开")
    except Exception as e:
        import traceback
        with open("C:/Users/10431/Desktop/vocal map/ws_error.log", "w", encoding="utf-8") as f:
            f.write(traceback.format_exc())
        print(f"[ERROR] WebSocket 异常断开: {e}")

if __name__ == "__main__":
    multiprocessing.freeze_support()
    host = os.environ.get("VOCALMAP_HOST", "127.0.0.1")
    port = int(os.environ.get("VOCALMAP_PORT", "5050"))
    uvicorn.run(app, host=host, port=port, log_level="warning")
