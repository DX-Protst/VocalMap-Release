// ==========================================
// VocalMap Payment & CDK Licensing System
// ==========================================

function saveLicenseCache(planType, expiresAt) {
    if (!localMachineId) return;
    const cache = {
        machine_id: localMachineId,
        plan_type: planType,
        expires_at: expiresAt || null,
        cached_at: Date.now()
    };
    try {
        localStorage.setItem(LICENSE_CACHE_KEY, JSON.stringify(cache));
    } catch (e) {
        console.warn('无法写入许可证缓存:', e);
    }
}

function getLicenseCache() {
    try {
        const raw = localStorage.getItem(LICENSE_CACHE_KEY);
        if (!raw) return null;
        const cache = JSON.parse(raw);
        if (cache.machine_id !== localMachineId) return null;
        if (cache.expires_at && Date.now() / 1000 > cache.expires_at) {
            localStorage.removeItem(LICENSE_CACHE_KEY);
            return null;
        }
        return cache;
    } catch (e) {
        return null;
    }
}

function clearLicenseCache() {
    localStorage.removeItem(LICENSE_CACHE_KEY);
}

async function initPaymentSystem() {
    try {
        localMachineId = await invoke('get_machine_id');
        const displayEl = document.getElementById('displayMachineId');
        if (displayEl) {
            displayEl.innerText = localMachineId || "浏览器测试环境 (请在桌面客户端运行)";
        }
        if (!localMachineId) {
            localMachineId = "WEB_TEST_" + Math.random().toString(36).substr(2, 9).toUpperCase();
        }
    } catch (e) {
        const displayEl = document.getElementById('displayMachineId');
        if (displayEl) displayEl.innerText = "浏览器测试环境 (请在桌面客户端运行)";
        localMachineId = "WEB_TEST_" + Math.random().toString(36).substr(2, 9).toUpperCase();
    }
    await checkLicenseStatus(true);
}

async function checkLicenseStatus(silent) {
    if (!localMachineId) return;

    const cache = getLicenseCache();
    if (cache) {
        hidePremiumOverlay(cache.plan_type);
        return;
    }

    try {
        let resp = await fetch(`${LOCAL_API_BASE}/api/license/status?machine_id=${encodeURIComponent(localMachineId)}`);
        let data = await resp.json();
        if (data.valid) {
            saveLicenseCache(data.plan_type, data.expires_at);
            hidePremiumOverlay(data.plan_type);
        } else {
            if (!silent) {
                let msgEl = document.getElementById('payMessage');
                if (msgEl) {
                    msgEl.style.color = '#FF5252';
                    msgEl.innerText = data.message || '许可证无效';
                }
            }
        }
    } catch (err) {
        if (!silent) {
            let msgEl = document.getElementById('payMessage');
            if (msgEl) {
                msgEl.style.color = '#FF5252';
                msgEl.innerText = '无法连接许可证服务器，请检查网络。';
            }
        }
    }
}

function hidePremiumOverlay(planType) {
    let overlay = document.getElementById('premiumOverlay');
    if (overlay) {
        overlay.style.display = 'none';
    }
    let msgEl = document.getElementById('payMessage');
    if (msgEl) {
        msgEl.style.color = '#00E676';
        msgEl.innerText = `已激活 (${planType === 'lifetime' ? '永久版' : '月度版'})`;
    }
}

async function activateCDK() {
    let cdkInput = document.getElementById('cdkInput');
    let msgEl = document.getElementById('payMessage');
    if (!cdkInput || !msgEl) return;
    let cdk = cdkInput.value.trim();

    if (!cdk) {
        msgEl.style.color = '#FF5252';
        msgEl.innerText = '请输入激活码';
        return;
    }
    if (!cdk.toUpperCase().startsWith('VMAP-')) {
        msgEl.style.color = '#FF5252';
        msgEl.innerText = '激活码格式不正确，应为 VMAP-XXXX-XXXX-XXXX';
        return;
    }

    msgEl.style.color = '#00FFF5';
    msgEl.innerText = '正在验证激活码...';

    try {
        let resp = await fetch(`${LOCAL_API_BASE}/api/license/activate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cdk: cdk.toUpperCase(), machine_id: localMachineId })
        });
        let data = await resp.json();
        if (data.success) {
            saveLicenseCache(data.plan_type, data.expires_at);
            msgEl.style.color = '#00E676';
            msgEl.innerText = data.message || '激活成功！';
            cdkInput.value = '';
            setTimeout(() => hidePremiumOverlay(data.plan_type), 800);
        } else {
            msgEl.style.color = '#FF5252';
            msgEl.innerText = data.message || '激活失败';
        }
    } catch (err) {
        msgEl.style.color = '#FF5252';
        msgEl.innerText = '无法连接许可证服务器，请检查网络。';
    }
}

async function refreshLicenseStatus() {
    let msgEl = document.getElementById('payMessage');
    if (!msgEl) return;
    msgEl.style.color = '#00FFF5';
    msgEl.innerText = '正在刷新许可证状态...';

    try {
        let resp = await fetch(`${LOCAL_API_BASE}/api/license/status?machine_id=${encodeURIComponent(localMachineId)}`);
        let data = await resp.json();
        if (data.valid) {
            saveLicenseCache(data.plan_type, data.expires_at);
            msgEl.style.color = '#00E676';
            msgEl.innerText = '许可证有效，已解锁 Pro 功能。';
            setTimeout(() => hidePremiumOverlay(data.plan_type), 600);
        } else {
            clearLicenseCache();
            msgEl.style.color = '#FF5252';
            msgEl.innerText = data.message || '尚未激活，请购买或输入激活码。';
        }
    } catch (err) {
        msgEl.style.color = '#FF5252';
        msgEl.innerText = '无法连接许可证服务器，请检查网络。';
    }
}

async function requestPayment(planType) {
    const msgEl = document.getElementById('payMessage');
    if (!msgEl) return;
    msgEl.style.color = '#00FFF5';
    msgEl.innerText = "正在生成支付通道...";
    try {
        let response = await fetch(`${CLOUD_API_BASE}/create_order`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ plan_type: planType, machine_id: localMachineId })
        });
        let data = await response.json();
        if (data.status === 'success') {
            msgEl.innerText = "已打开浏览器支付页面。支付完成后请点击【刷新许可证状态】。";
            try {
                await open(data.payment_url);
            } catch (err) {
                msgEl.innerText = `网页环境拦截跳转，链接: ${data.payment_url}`;
            }
        } else {
            msgEl.style.color = '#FF5252'; msgEl.innerText = "失败：" + data.message;
        }
    } catch (err) {
        msgEl.style.color = '#FF5252'; msgEl.innerText = "云端连接失败，请检查网络。";
    }
}

if (document.getElementById('btnBuyMonthly')) document.getElementById('btnBuyMonthly').addEventListener('click', () => requestPayment('monthly'));
if (document.getElementById('btnBuyLifetime')) document.getElementById('btnBuyLifetime').addEventListener('click', () => requestPayment('lifetime'));
if (document.getElementById('btnActivateCDK')) document.getElementById('btnActivateCDK').addEventListener('click', activateCDK);
if (document.getElementById('btnRefreshStatus')) document.getElementById('btnRefreshStatus').addEventListener('click', refreshLicenseStatus);

const cdkInputEl = document.getElementById('cdkInput');
if (cdkInputEl) {
    cdkInputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') activateCDK();
    });
}

initPaymentSystem();
