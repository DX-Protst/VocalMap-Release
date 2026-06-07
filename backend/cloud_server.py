from fastapi import FastAPI, Request
from fastapi.responses import RedirectResponse, PlainTextResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import hashlib
import time
import random
import json
import os
import rsa
import base64

app = FastAPI()

# CORS 支持 (前端和本地后端都可能直接调用)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ==========================================
# 易支付 (ZPay) 商户配置
# ==========================================
ZPAY_API_URL = "https://zpayz.cn/submit.php"
ZPAY_PID = "2026042319013970"
ZPAY_KEY = "1uAYRsvEmpNjY0un8uHMo6UHLcGtAQHD"

# 管理密钥 (用于 gen_cdk / list_cdks)
ADMIN_KEY = os.environ.get("VMAP_ADMIN_KEY", "vmap-admin-2026")

# 您的云服务器公网域名或IP
CLOUD_DOMAIN = "http://66.112.209.251:8000"

# ==========================================
# 持久化存储 (JSON 文件)
# ==========================================
CDK_DB_FILE = os.path.join(os.path.dirname(__file__), "cdk_data.json")

# 临时内存数据库
orders_db = {}
licenses_db = {}
cdk_pool = {}  # { cdk: {"used": bool, "plan_type": str, "created_at": float} }

# ==========================================
# RSA 私钥配置 (用于签发许可证)
# ==========================================
PRIVATE_KEY_STR = """-----BEGIN RSA PRIVATE KEY-----
MIICYQIBAAKBgQCTyYQIqt2phTbnZLB6eLoo4dZ/lAtGJoipN8wbDcYshxkvC+4g
cHZ1vYxXgDukne21+deYJBhgTG+zuK9nZWglgWxVeHkzaH9IKn96d35KxOkgqtbX
Oyq75z/ZwwzQrJy2C/HFxTJHoedyoWueDAPvGETlCsqkpolPYwfySzvhPQIDAQAB
AoGBAJDIkoafRqvGK4TEGzTQw6g7oBW6ptTh+W62kEpM00JaVGzH5lF3fEZbHXu3
0Da01eY6z2Fos0zcdW5/1sycwHciErnqwgabhNYExA16ume0Qy+p0IUHmHqKForY
RbSl5c69TGVCO9xOD8hu8oJ3qVqBagyvGkJs56qpBcHEzB9tAkUA56/eNXPLnuUd
H5fnBwZzZloVeOn6bKs6wEGzTNe3Qzh+81iX4fiaPMBlhy1guprJNev8FfCxCGKw
a/1eeEaHdOiQnnsCPQCjS7rDTWtIYF8afi8+KTDrRtc33GVtFJcYhU/Mbjah4gLc
jhSyZJoqg1tx749Mk+/dYtZJVRTBzi80zacCRGDSgk5cQe/5V55oYMfyzi8r3mVV
gq3/MOI/kqq+S3vwFD2l/HMW7X4N+V/wesgA/61lHUgd+h3DAG9gxyYEc39L4YQZ
Ajwrbfqv8qkzyJ3CmAjMiXv/NwoKS02WY0GEPgBpKG7TQx7rtcX/ZA40fFcXyFTe
UwIaaS0At+YbXVDkxEUCRQDffSlQ4jiHmxOJsMJGaevpebGuOsB3RG4pQyQDuAIt
RGz3xF7RWkBzMlkyviVULbW1aD+97us1iaDoB1amVaKM0/72HA==
-----END RSA PRIVATE KEY-----"""

try:
    private_key = rsa.PrivateKey.load_pkcs1(PRIVATE_KEY_STR.encode('utf-8'))
except Exception as e:
    print(f"[WARN] RSA 私钥加载失败: {e}")
    private_key = None

def generate_license_token(machine_id: str, plan_type: str, expires_at: float):
    if not private_key: return "", ""
    payload = {
        "machine_id": machine_id,
        "plan_type": plan_type,
        "expires_at": expires_at
    }
    payload_str = json.dumps(payload, separators=(',', ':'))
    signature = rsa.sign(payload_str.encode('utf-8'), private_key, 'SHA-256')
    b64_sig = base64.b64encode(signature).decode('utf-8')
    return payload_str, b64_sig


def save_cdk_data():
    """持久化许可证和 CDK 池到 JSON 文件"""
    data = {
        "licenses": licenses_db,
        "cdk_pool": cdk_pool,
    }
    with open(CDK_DB_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def load_cdk_data():
    """从 JSON 文件恢复许可证和 CDK 池"""
    global licenses_db, cdk_pool
    if os.path.exists(CDK_DB_FILE):
        try:
            with open(CDK_DB_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                licenses_db = data.get("licenses", {})
                cdk_pool = data.get("cdk_pool", {})
                print(f"[OK] 加载了 {len(licenses_db)} 条许可证, {len(cdk_pool)} 个CDK")
        except Exception as e:
            print(f"[WARN] CDK数据加载失败: {e}")


# 启动时加载
load_cdk_data()

# ==========================================
# 核心：易支付 MD5 签名算法
# ==========================================
def generate_zpay_sign(params: dict, key: str) -> str:
    filtered_params = {k: v for k, v in params.items() if k not in ["sign", "sign_type"] and v != ""}
    sorted_params = sorted(filtered_params.items(), key=lambda x: x[0])
    sign_str = "&".join([f"{k}={v}" for k, v in sorted_params])
    sign_str += key
    return hashlib.md5(sign_str.encode('utf-8')).hexdigest().lower()


def _generate_cdk_code():
    """生成 VMAP-XXXX-XXXX-XXXX 格式的 CDK"""
    return f"VMAP-{random.randint(1000,9999)}-{random.randint(1000,9999)}-{random.randint(1000,9999)}"


# ==========================================
# 接口 1：本地客户端发起购买请求，获取支付跳转链接
# ==========================================
@app.post("/api/create_order")
async def create_order(request: Request):
    data = await request.json()
    plan_type = data.get("plan_type")
    machine_id = data.get("machine_id")

    if plan_type == "monthly":
        name = "VocalMap 声境 - 月度通行证"
        money = "19.90"
    else:
        name = "VocalMap 声境 - 永久买断版"
        money = "59.90"

    out_trade_no = f"{int(time.time())}{random.randint(1000, 9999)}"

    orders_db[out_trade_no] = {
        "plan_type": plan_type,
        "machine_id": machine_id,
        "status": "pending"
    }

    pay_params = {
        "pid": ZPAY_PID,
        "type": "alipay",
        "out_trade_no": out_trade_no,
        "notify_url": f"{CLOUD_DOMAIN}/api/zpay_notify",
        "return_url": f"{CLOUD_DOMAIN}/api/pay_success",
        "name": name,
        "money": money,
        "param": machine_id
    }

    pay_params["sign"] = generate_zpay_sign(pay_params, ZPAY_KEY)
    pay_params["sign_type"] = "MD5"

    query_string = "&".join([f"{k}={v}" for k, v in pay_params.items()])
    payment_url = f"{ZPAY_API_URL}?{query_string}"

    return {"status": "success", "payment_url": payment_url}


# ==========================================
# 接口 2：异步接收 ZPay 的支付成功通知 (Webhook)
# ==========================================
@app.get("/api/zpay_notify")
async def zpay_notify(request: Request):
    params = dict(request.query_params)

    # 验证签名
    incoming_sign = params.get("sign")
    calculated_sign = generate_zpay_sign(params, ZPAY_KEY)

    if incoming_sign != calculated_sign:
        return PlainTextResponse("sign error", status_code=403)

    if params.get("trade_status") == "TRADE_SUCCESS":
        out_trade_no = params.get("out_trade_no")
        machine_id = params.get("param")

        if out_trade_no in orders_db and orders_db[out_trade_no]["status"] == "pending":
            orders_db[out_trade_no]["status"] = "paid"
            plan_type = orders_db[out_trade_no]["plan_type"]

            # 生成 CDK 并通过 CDK 池激活
            cdk = _generate_cdk_code()
            cdk_pool[cdk] = {"used": True, "plan_type": plan_type, "created_at": time.time()}
            licenses_db[machine_id] = {
                "cdk": cdk,
                "plan_type": plan_type,
                "expires_at": time.time() + (30 * 24 * 3600) if plan_type == "monthly" else None
            }
            save_cdk_data()
            print(f"[PAID] 收到付款！设备 {machine_id} 已激活 CDK: {cdk}")

    return PlainTextResponse("success")


# ==========================================
# 接口 3：用户支付完成后的浏览器跳转页
# ==========================================
@app.get("/api/pay_success")
async def pay_success_page():
    return PlainTextResponse("支付成功！请回到 VocalMap 软件中点击【刷新状态】即可自动激活。")


# ==========================================
# 接口 4：验证设备许可证 (供本地后端调用)
# ==========================================
@app.get("/api/verify_license")
async def verify_license(machine_id: str = ""):
    """
    检查指定 machine_id 是否拥有有效许可证。
    返回: {valid, plan_type, cdk, expires_at, message}
    """
    if not machine_id:
        return {"valid": False, "message": "缺少 machine_id 参数"}

    lic = licenses_db.get(machine_id)
    if not lic:
        return {"valid": False, "message": "该设备尚未激活"}

    expires_at = lic.get("expires_at")
    if expires_at is not None and time.time() > expires_at:
        return {
            "valid": False,
            "message": "许可证已过期",
            "plan_type": lic.get("plan_type"),
            "expired": True,
        }

    payload_str, signature = generate_license_token(machine_id, lic.get("plan_type"), expires_at)

    return {
        "valid": True,
        "plan_type": lic.get("plan_type"),
        "cdk": lic.get("cdk"),
        "expires_at": expires_at,
        "message": "许可证有效",
        "license_payload": payload_str,
        "license_signature": signature
    }


# ==========================================
# 接口 5：激活 CDK (用户手动输入 CDK)
# ==========================================
@app.post("/api/activate_cdk")
async def activate_cdk(request: Request):
    """
    用户输入 CDK + machine_id 进行激活。
    Body: {cdk: "VMAP-XXXX-XXXX-XXXX", machine_id: "xxx"}
    """
    data = await request.json()
    cdk = data.get("cdk", "").strip()
    machine_id = data.get("machine_id", "").strip()

    if not cdk or not machine_id:
        return {"success": False, "message": "CDK 和设备ID不能为空"}

    # 检查 CDK 是否存在于 CDK 池
    if cdk not in cdk_pool:
        return {"success": False, "message": "无效的激活码"}

    cdk_info = cdk_pool[cdk]

    if cdk_info.get("used"):
        # 检查是否刚好被当前设备使用 (允许重复激活同一设备)
        existing = licenses_db.get(machine_id, {})
        if existing.get("cdk") == cdk:
            return {"success": True, "message": "该CDK已在此设备激活", "plan_type": cdk_info.get("plan_type")}
        return {"success": False, "message": "该激活码已被使用"}

    # 激活：标记 CDK 已使用，写入 licenses_db
    cdk_pool[cdk]["used"] = True
    plan_type = cdk_info.get("plan_type", "lifetime")
    licenses_db[machine_id] = {
        "cdk": cdk,
        "plan_type": plan_type,
        "expires_at": time.time() + (30 * 24 * 3600) if plan_type == "monthly" else None
    }
    save_cdk_data()
    print(f"[ACTIVATE] 设备 {machine_id} 使用 CDK {cdk} 激活成功 (plan={plan_type})")

    payload_str, signature = generate_license_token(machine_id, plan_type, licenses_db[machine_id]["expires_at"])

    return {
        "success": True,
        "plan_type": plan_type,
        "expires_at": licenses_db[machine_id]["expires_at"],
        "message": f"激活成功！ ({plan_type})",
        "license_payload": payload_str,
        "license_signature": signature
    }


# ==========================================
# 接口 6：管理员生成 CDK
# GET /api/gen_cdk?admin_key=xxx&count=5&plan_type=lifetime
# ==========================================
@app.get("/api/gen_cdk")
async def gen_cdk(admin_key: str = "", count: int = 1, plan_type: str = "lifetime"):
    """管理员手动生成 CDK"""
    if admin_key != ADMIN_KEY:
        return JSONResponse({"error": "管理密钥错误"}, status_code=403)

    if count < 1 or count > 500:
        return JSONResponse({"error": "count 需要在 1-500 之间"}, status_code=400)

    if plan_type not in ("monthly", "lifetime"):
        return JSONResponse({"error": "plan_type 只能是 monthly 或 lifetime"}, status_code=400)

    generated = []
    for _ in range(count):
        cdk = _generate_cdk_code()
        # 避免冲突
        while cdk in cdk_pool:
            cdk = _generate_cdk_code()
        cdk_pool[cdk] = {"used": False, "plan_type": plan_type, "created_at": time.time()}
        generated.append(cdk)

    save_cdk_data()
    print(f"[ADMIN] 生成 {count} 个 CDK (plan={plan_type})")

    return {
        "success": True,
        "count": len(generated),
        "plan_type": plan_type,
        "cdks": generated,
    }


# ==========================================
# 接口 7：管理员查看所有 CDK
# GET /api/list_cdks?admin_key=xxx
# ==========================================
@app.get("/api/list_cdks")
async def list_cdks(admin_key: str = ""):
    """管理员查看 CDK 池状态"""
    if admin_key != ADMIN_KEY:
        return JSONResponse({"error": "管理密钥错误"}, status_code=403)

    cdks = []
    for cdk, info in cdk_pool.items():
        cdks.append({
            "cdk": cdk,
            "used": info["used"],
            "plan_type": info.get("plan_type", "lifetime"),
            "created_at": info.get("created_at", 0),
        })

    # 按创建时间倒序
    cdks.sort(key=lambda x: x["created_at"], reverse=True)

    used_count = sum(1 for c in cdks if c["used"])
    unused_count = len(cdks) - used_count

    return {
        "total": len(cdks),
        "used": used_count,
        "unused": unused_count,
        "licenses_count": len(licenses_db),
        "cdks": cdks,
    }