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
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File, BackgroundTasks, Form, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

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

from acoustic_engine.analyzer import VocalAnalyzer
from services.reporter import generate_comprehensive_report

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
    separation_tasks[task_id] = {"status": "processing", "progress": 0}

    def _run_separation():
        try:
            def update_progress(p: int, text: str = None):
                separation_tasks[task_id]["progress"] = p
                if text:
                    separation_tasks[task_id]["status_text"] = text
                
            results = separation_engine.separate_file(
                input_path, output_dir, model_key=model_key, force_cpu=force_cpu, progress_callback=update_progress
            )
            stems = {}
            for instr, path in results.items():
                if instr != "_mix":
                    stems[instr] = path
            separation_tasks[task_id] = {
                "status": "completed",
                "stems": stems,
                "output_dir": output_dir,
                "model_info": separation_engine.get_model_info(),
                "device_info": separation_engine.get_device_info(),
            }
        except Exception as e:
            import traceback
            traceback.print_exc()
            separation_tasks[task_id] = {"status": "error", "error": str(e)}

    background_tasks.add_task(_run_separation)
    return {"task_id": task_id, "status": "processing"}

@app.get("/api/separation/task/{task_id}")
async def get_separation_task(task_id: str):
    """查询分离任务状态"""
    task = separation_tasks.get(task_id)
    if not task:
        return JSONResponse({"error": "任务不存在"}, status_code=404)
    return task

@app.get("/api/separation/download/{task_id}/{stem}")
async def download_separation_stem(task_id: str, stem: str):
    """下载分离后的轨道文件"""
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


@app.get("/api/separation/preload/{model_key}")
async def preload_separation_model(model_key: str = "logic_roformer_6s"):
    """预加载音轨分离模型 (减少首次分离的等待时间)"""
    if not SEPARATION_AVAILABLE or not separation_engine:
        return JSONResponse({"error": "音轨分离引擎不可用"}, status_code=503)
    try:
        separation_engine.load_model(model_key)
        return {"status": "loaded", "model": model_key}
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
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
                        
                        report = generate_comprehensive_report(audio_buffer, analyzer)
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
