// ==========================================
// VocalMap Payment & CDK Licensing System
// ==========================================

function saveLicenseCache(planType, expiresAt) {
    if (!localMachineId) return;
    
    let actTime = Date.now();
    try {
        let oldRaw = localStorage.getItem(LICENSE_CACHE_KEY);
        if (oldRaw) {
            let oldCache = JSON.parse(oldRaw);
            if (oldCache && oldCache.cached_at) {
                actTime = oldCache.cached_at;
            }
        }
    } catch(e) {}

    const cache = {
        machine_id: localMachineId,
        plan_type: planType,
        expires_at: expiresAt || null,
        cached_at: actTime
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

let currentPlanType = null; // Store active license status to support dynamic language switching

async function initPaymentSystem() {
    try {
        localMachineId = await invoke('get_machine_id');
        const displayEl = document.getElementById('displayMachineId');
        if (displayEl) {
            displayEl.innerText = localMachineId || t('pay.browser_env', "浏览器测试环境 (请在桌面客户端运行)");
        }
        if (!localMachineId) {
            localMachineId = "WEB_TEST_" + Math.random().toString(36).substr(2, 9).toUpperCase();
        }
    } catch (e) {
        const displayEl = document.getElementById('displayMachineId');
        if (displayEl) displayEl.innerText = t('pay.browser_env', "浏览器测试环境 (请在桌面客户端运行)");
        localMachineId = "WEB_TEST_" + Math.random().toString(36).substr(2, 9).toUpperCase();
    }
    await checkLicenseStatus(true);
}

function showPremiumOverlay() {
    const proWs = document.getElementById('proWorkspace');
    if (proWs && proWs.style.display === 'block') {
        if (typeof switchTab === 'function') switchTab('pro');
    }
}

async function checkLicenseStatus(silent) {
    if (!localMachineId) return;

    const cache = getLicenseCache();
    if (cache) {
        hidePremiumOverlay(cache.plan_type);
    }

    try {
        let data = await invoke('vmap_get_license_status', { machineId: localMachineId });
        if (data.valid) {
            saveLicenseCache(data.plan_type, data.expires_at);
            hidePremiumOverlay(data.plan_type);
        } else {
            clearLicenseCache();
            showPremiumOverlay();
            if (!silent) {
                let msgEl = document.getElementById('payMessage');
                if (msgEl) {
                    msgEl.style.color = '#FF5252';
                    msgEl.innerText = data.message || t('pay.license_invalid', '尚未激活，请购买或输入激活码。');
                }
            }
        }
    } catch (err) {
        if (!cache) {
            showPremiumOverlay();
            if (!silent) {
                let msgEl = document.getElementById('payMessage');
                if (msgEl) {
                    msgEl.style.color = '#FF5252';
                    msgEl.innerText = t('pay.server_error', '无法连接许可证服务器，请检查网络。');
                }
            }
        }
    }
}

function hidePremiumOverlay(planType) {
    const licenseWs = document.getElementById('licenseWorkspace');
    if (licenseWs && licenseWs.style.display === 'flex') {
        if (typeof switchTab === 'function') switchTab('pro');
    }
    currentPlanType = planType;
    let msgEl = document.getElementById('payMessage');
    if (msgEl && planType) {
        msgEl.style.color = '#00E676';
        msgEl.innerText = planType === 'lifetime' ? t('pay.activated_lifetime', '已激活 (永久版)') : t('pay.activated_monthly', '已激活 (月度版)');
    }
}

window.viewLicenseStatus = function() {
    if (typeof closeSettings === 'function') closeSettings();
    if (typeof switchTab === 'function') switchTab('license');
    
    const cache = getLicenseCache();
    let overlays = document.querySelectorAll('#licenseWorkspace');
    
    overlays.forEach(overlay => {
        // No need to set display here, switchTab handles it
        
        let buyContainer = overlay.querySelector('#purchaseContainer');
        let cdkContainer = overlay.querySelector('#cdkInputContainer');
        let btnClose = overlay.querySelector('#btnClosePremiumOverlay');
        let infoContainer = overlay.querySelector('#activeLicenseInfo');
        
        if (cache) {
            if (buyContainer) {
                buyContainer.style.display = 'flex';
                buyContainer.style.opacity = '0.4';
                buyContainer.style.pointerEvents = 'none';
                buyContainer.style.filter = 'none';
            }
            if (cdkContainer) {
                cdkContainer.style.display = 'flex';
                cdkContainer.style.opacity = '0.4';
                cdkContainer.style.pointerEvents = 'none';
                cdkContainer.style.filter = 'none';
            }
            if (btnClose) {
                btnClose.style.display = 'flex';
                if (typeof lucide !== 'undefined') lucide.createIcons({ root: btnClose });
            }
            
            if (!infoContainer) {
                infoContainer = document.createElement('div');
                infoContainer.id = 'activeLicenseInfo';
                infoContainer.className = 'glass-panel';
                infoContainer.style.padding = '16px 24px';
                infoContainer.style.marginBottom = '24px';
                infoContainer.style.display = 'flex';
                infoContainer.style.flexDirection = 'column';
                infoContainer.style.gap = '8px';
                overlay.insertBefore(infoContainer, overlay.querySelector('#btnRefreshStatus'));
            }
            
            let actDate = new Date(cache.cached_at).toLocaleString();
            let remText = cache.plan_type === 'lifetime' ? t('pay.license_status_rem_lifetime', '永久有效') : '';
            if (cache.plan_type !== 'lifetime' && cache.expires_at) {
                let remDays = Math.ceil((cache.expires_at - (Date.now()/1000)) / 86400);
                remText = t('pay.license_status_rem_days_prefix', '剩余 ') + remDays + t('pay.license_status_rem_days_suffix', ' 天');
            }
            
            infoContainer.innerHTML = `
                <div style="color: var(--text-main); font-size: 14px; font-weight: 600;">${t('pay.license_status_activated', '已激活: ')}<span style="color: var(--primary-cyan);">${cache.plan_type === 'lifetime' ? t('pay.license_status_lifetime', '永久买断版') : t('pay.license_status_monthly', '月度通行证')}</span></div>
                <div style="color: var(--text-muted); font-size: 13px;">${t('pay.license_status_act_time', '激活时间: ')}${actDate}</div>
                <div style="color: var(--text-muted); font-size: 13px;">${t('pay.license_status_valid', '有效期: ')}<span style="color: #00E676; font-weight: bold;">${remText}</span></div>
            `;
            infoContainer.style.display = 'flex';
        } else {
            if (buyContainer) {
                buyContainer.style.display = 'flex';
                buyContainer.style.opacity = '1';
                buyContainer.style.pointerEvents = 'auto';
                buyContainer.style.filter = 'none';
            }
            if (cdkContainer) {
                cdkContainer.style.display = 'flex';
                cdkContainer.style.opacity = '1';
                cdkContainer.style.pointerEvents = 'auto';
                cdkContainer.style.filter = 'none';
            }
            if (btnClose) btnClose.style.display = 'none';
            if (infoContainer) infoContainer.style.display = 'none';
            
            let msgEl = overlay.querySelector('#payMessage');
            if (msgEl) msgEl.innerText = '';
        }
    });
};

async function activateCDK() {
    let cdkInput = document.getElementById('cdkInput');
    let msgEl = document.getElementById('payMessage');
    if (!cdkInput || !msgEl) return;
    let cdk = cdkInput.value.trim();

    if (!cdk) {
        msgEl.style.color = '#FF5252';
        msgEl.innerText = t('pay.enter_cdk', '请输入激活码');
        return;
    }
    if (!cdk.toUpperCase().startsWith('VMAP-')) {
        msgEl.style.color = '#FF5252';
        msgEl.innerText = t('pay.invalid_format', '激活码格式不正确，应为 VMAP-XXXX-XXXX-XXXX');
        return;
    }

    msgEl.style.color = '#00FFF5';
    msgEl.innerText = t('pay.verifying', '正在验证激活码...');

    try {
        let data = await invoke('vmap_activate_license', { cdk: cdk.toUpperCase(), machineId: localMachineId });
        if (data.success) {
            saveLicenseCache(data.plan_type, data.expires_at);
            msgEl.style.color = '#00E676';
            msgEl.innerText = data.message || t('pay.success', '激活成功！');
            cdkInput.value = '';
            setTimeout(() => hidePremiumOverlay(data.plan_type), 800);
        } else {
            msgEl.style.color = '#FF5252';
            msgEl.innerText = data.message || t('pay.failed', '激活失败');
        }
    } catch (err) {
        msgEl.style.color = '#FF5252';
        msgEl.innerText = t('pay.server_error', '无法连接许可证服务器，请检查网络。');
    }
}

async function refreshLicenseStatus() {
    let msgEl = document.getElementById('payMessage');
    if (!msgEl) return;
    msgEl.style.color = '#00FFF5';
    msgEl.innerText = t('pay.refreshing', '正在刷新许可证状态...');

    try {
        let data = await invoke('vmap_get_license_status', { machineId: localMachineId });
        if (data.valid) {
            saveLicenseCache(data.plan_type, data.expires_at);
            msgEl.style.color = '#00E676';
            msgEl.innerText = t('pay.license_valid', '许可证有效，已解锁 Pro 功能。');
            setTimeout(() => hidePremiumOverlay(data.plan_type), 600);
        } else {
            clearLicenseCache();
            showPremiumOverlay();
            msgEl.style.color = '#FF5252';
            msgEl.innerText = data.message || t('pay.license_invalid', '尚未激活，请购买或输入激活码。');
        }
    } catch (err) {
        msgEl.style.color = '#FF5252';
        msgEl.innerText = t('pay.server_error', '无法连接许可证服务器，请检查网络。');
    }
}

async function requestPayment(planType) {
    const msgEl = document.getElementById('payMessage');
    if (!msgEl) return;
    msgEl.style.color = '#00FFF5';
    msgEl.innerText = t('pay.generating_gateway', "正在生成支付通道...");
    try {
        let response = await fetch(`${CLOUD_API_BASE}/create_order`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ plan_type: planType, machine_id: localMachineId })
        });
        let data = await response.json();
        if (data.status === 'success') {
            msgEl.innerText = t('pay.order_created', "已打开浏览器支付页面。支付完成后请点击【刷新许可证状态】。");
            try {
                await open(data.payment_url);
            } catch (err) {
                msgEl.innerText = t('pay.blocked_popup', '网页环境拦截跳转，链接: ') + data.payment_url;
            }
        } else {
            msgEl.style.color = '#FF5252'; msgEl.innerText = t('pay.failed_prefix', "失败：") + data.message;
        }
    } catch (err) {
        msgEl.style.color = '#FF5252'; msgEl.innerText = t('pay.cloud_failed', "云端连接失败，请检查网络。");
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

window.addEventListener('languagechanged', (e) => {
    const displayEl = document.getElementById('displayMachineId');
    if (displayEl) {
        if (!localMachineId || localMachineId.startsWith("WEB_TEST_")) {
            displayEl.innerText = t('pay.browser_env', "浏览器测试环境 (请在桌面客户端运行)");
        } else {
            displayEl.innerText = localMachineId;
        }
    }
    if (currentPlanType) {
        let msgEl = document.getElementById('payMessage');
        if (msgEl) {
            msgEl.style.color = '#00E676';
            msgEl.innerText = currentPlanType === 'lifetime' ? t('pay.activated_lifetime', '已激活 (永久版)') : t('pay.activated_monthly', '已激活 (月度版)');
        }
    }
});

initPaymentSystem();
