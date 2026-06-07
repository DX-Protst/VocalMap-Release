// ==========================================
// VocalMap Updater, Settings & Main Tabs UI
// ==========================================

window.switchTab = function(tabName) {
    const freeWs = document.getElementById('freeWorkspace');
    const proWs = document.getElementById('proWorkspace');
    const btnFree = document.getElementById('tabBtnFree');
    const btnPro = document.getElementById('tabBtnPro');

    function triggerAnimation(el, className) {
        if (!el) return;
        el.classList.remove('animate-slide-left', 'animate-slide-right', 'animate-slide-up');
        void el.offsetWidth; 
        el.classList.add(className);
    }

    if (tabName === 'free') {
        if (freeWs) freeWs.style.display = 'flex'; 
        if (proWs) proWs.style.display = 'none';
        if (btnFree) btnFree.classList.add('active');
        if (btnPro) btnPro.classList.remove('active', 'active-pro');
        if (freeWs) triggerAnimation(freeWs, 'animate-slide-left');
    } else {
        if (freeWs) freeWs.style.display = 'none'; 
        if (proWs) proWs.style.display = 'block'; 
        if (btnPro) btnPro.classList.add('active-pro');
        if (btnFree) btnFree.classList.remove('active');
        if (proWs) triggerAnimation(proWs, 'animate-slide-right');
    }
};

// Tauri Updater
(function initUpdateUI() {
    const versionLabel = document.getElementById('updateVersionLabel');
    const btnCheck = document.getElementById('btnCheckUpdate');
    const progressWrapper = document.getElementById('updateProgressWrapper');
    const progressBar = document.getElementById('updateProgressBar');
    const statusText = document.getElementById('updateStatusText');
    const btnInstall = document.getElementById('btnInstallUpdate');

    if (!btnCheck) return;

    let updateObject = null;
    let updateState = 'none'; // 'none' | 'download-ready' | 'downloading' | 'install-ready' | 'installing'

    getVersion().then(function(ver) {
        if (versionLabel) {
            versionLabel.innerText = 'v' + ver;
            versionLabel.style.color = '#888';
        }
    }).catch(function() {
        if (versionLabel) versionLabel.innerText = 'v--';
    });

    btnCheck.addEventListener('click', async function() {
        btnCheck.disabled = true;
        if (statusText) {
            statusText.innerText = '正在检查更新...';
            statusText.style.color = '#00FFF5';
        }
        
        try {
            const update = await check();
            if (update) {
                updateObject = update;
                btnCheck.style.display = 'none';
                if (progressWrapper) progressWrapper.style.display = 'none';
                if (btnInstall) {
                    btnInstall.style.display = 'block';
                    btnInstall.innerText = '下载更新';
                    btnInstall.disabled = false;
                }
                if (statusText) {
                    statusText.innerText = '发现新版本 v' + update.version + '，请点击下载更新';
                    statusText.style.color = '#00ADB5';
                }
                if (progressBar) progressBar.style.width = '0%';
                updateState = 'download-ready';
            } else {
                btnCheck.style.display = 'block';
                btnCheck.disabled = false;
                if (statusText) {
                    statusText.innerText = '已是最新版本';
                    statusText.style.color = '#00E676';
                }
            }
        } catch (err) {
            if (statusText) {
                statusText.innerText = '更新失败: ' + err;
                statusText.style.color = '#FF5252';
            }
            btnCheck.disabled = false;
            btnCheck.style.display = 'block';
        }
    });

    if (btnInstall) {
        btnInstall.addEventListener('click', async function() {
            if (updateState === 'download-ready') {
                updateState = 'downloading';
                btnInstall.disabled = true;
                btnInstall.innerText = '正在下载...';
                if (progressWrapper) progressWrapper.style.display = 'block';
                if (progressBar) progressBar.style.width = '0%';
                
                try {
                    let downloaded = 0;
                    let contentLength = 0;
                    
                    await updateObject.download((event) => {
                        switch (event.event) {
                            case 'Started':
                                contentLength = event.data.contentLength;
                                break;
                            case 'Progress':
                                downloaded += event.data.chunkLength;
                                if (contentLength > 0 && progressBar && statusText) {
                                    const pct = Math.round((downloaded / contentLength) * 100);
                                    progressBar.style.width = pct + '%';
                                    statusText.innerText = '下载中 ' + pct + '%';
                                }
                                break;
                        }
                    });

                    if (progressWrapper) progressWrapper.style.display = 'none';
                    if (statusText) {
                        statusText.innerText = 'v' + updateObject.version + ' 下载完成，请点击安装并重启';
                        statusText.style.color = '#00E676';
                    }
                    btnInstall.innerText = '安装并重启';
                    btnInstall.disabled = false;
                    updateState = 'install-ready';
                } catch (err) {
                    if (statusText) {
                        statusText.innerText = '下载失败: ' + err;
                        statusText.style.color = '#FF5252';
                    }
                    btnInstall.innerText = '重新下载';
                    btnInstall.disabled = false;
                    updateState = 'download-ready';
                    if (progressWrapper) progressWrapper.style.display = 'none';
                }
            } else if (updateState === 'install-ready') {
                updateState = 'installing';
                btnInstall.disabled = true;
                btnInstall.innerText = '正在安装...';
                if (statusText) {
                    statusText.innerText = '正在安装更新，准备重启...';
                    statusText.style.color = '#00FFF5';
                }
                
                try {
                    await updateObject.install();
                    
                    if (typeof invoke === 'function') {
                        await invoke('relaunch_app');
                    } else {
                        console.warn("relaunch_app command not found");
                    }
                } catch (err) {
                    if (statusText) {
                        statusText.innerText = '安装失败: ' + err;
                        statusText.style.color = '#FF5252';
                    }
                    btnInstall.innerText = '重新安装';
                    btnInstall.disabled = false;
                    updateState = 'install-ready';
                }
            }
        });
    }
})();

// Advanced Settings panel
const settingsModal = document.getElementById('settingsModal');
const sLoudness = document.getElementById('sliderLoudnessGate');
const sClarity = document.getElementById('sliderClarityThreshold');
const sNoise = document.getElementById('sliderNoiseTracking');
const sPianoVol = document.getElementById('sliderPianoVolume');
const sPlayVol = document.getElementById('sliderPlaybackVolume');
const sPerfMode = document.getElementById('togglePerformanceMode');

const vLoudness = document.getElementById('valLoudnessGate');
const vClarity = document.getElementById('valClarityThreshold');
const vNoise = document.getElementById('valNoiseTracking');
const vPianoVol = document.getElementById('valPianoVolume');
const vPlayVol = document.getElementById('valPlaybackVolume');

const DEFAULT_SETTINGS = {
    loudnessGate: 12,
    clarityThreshold: 0.65,
    noiseTracking: 20
};

window.openSettings = function() {
    if (sPerfMode) sPerfMode.checked = performanceMode;
    if (settingsModal) settingsModal.classList.add('active');
};

window.closeSettings = function() {
    if (settingsModal) settingsModal.classList.remove('active');
};

function sendSettings() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const settings = {
        loudness_gate: parseFloat(sLoudness.value),
        clarity_threshold: parseFloat(sClarity.value),
        noise_silence_threshold: parseFloat(sNoise.value)
    };
    ws.send(JSON.stringify({ action: "update_settings", settings: settings }));
}

(function loadSettings() {
    const savedLoudness = localStorage.getItem('vmap_set_loudness');
    if (savedLoudness && sLoudness) { sLoudness.value = savedLoudness; if (vLoudness) vLoudness.innerText = savedLoudness; }
    
    const savedClarity = localStorage.getItem('vmap_set_clarity');
    if (savedClarity && sClarity) { sClarity.value = savedClarity; if (vClarity) vClarity.innerText = savedClarity; }
    
    const savedNoise = localStorage.getItem('vmap_set_noise');
    if (savedNoise && sNoise) { sNoise.value = savedNoise; if (vNoise) vNoise.innerText = savedNoise; }
    
    const savedPianoVol = localStorage.getItem('vmap_set_piano_vol');
    if (savedPianoVol && sPianoVol) { sPianoVol.value = savedPianoVol; if (vPianoVol) vPianoVol.innerText = savedPianoVol; window.globalPianoVolume = parseFloat(savedPianoVol); }
    
    const savedPlayVol = localStorage.getItem('vmap_set_play_vol');
    if (savedPlayVol && sPlayVol) { 
        sPlayVol.value = savedPlayVol; 
        if (vPlayVol) vPlayVol.innerText = savedPlayVol; 
        window.globalPlaybackVolume = parseFloat(savedPlayVol);
        if (typeof playbackAudio !== 'undefined') playbackAudio.volume = window.globalPlaybackVolume;
    }
})();

function updateSliderUI(slider, valEl, storageKey) {
    if (valEl) valEl.innerText = slider.value;
    if (storageKey) localStorage.setItem(storageKey, slider.value);
    sendSettings();
}

if (sLoudness) sLoudness.addEventListener('input', () => updateSliderUI(sLoudness, vLoudness, 'vmap_set_loudness'));
if (sClarity) sClarity.addEventListener('input', () => updateSliderUI(sClarity, vClarity, 'vmap_set_clarity'));
if (sNoise) sNoise.addEventListener('input', () => updateSliderUI(sNoise, vNoise, 'vmap_set_noise'));
if (sPianoVol) sPianoVol.addEventListener('input', () => {
    updateSliderUI(sPianoVol, vPianoVol, 'vmap_set_piano_vol');
    window.globalPianoVolume = parseFloat(sPianoVol.value);
});
if (sPlayVol) sPlayVol.addEventListener('input', () => {
    updateSliderUI(sPlayVol, vPlayVol, 'vmap_set_play_vol');
    window.globalPlaybackVolume = parseFloat(sPlayVol.value);
    if (typeof playbackAudio !== 'undefined') playbackAudio.volume = window.globalPlaybackVolume;
});
if (sPerfMode) {
    sPerfMode.addEventListener('change', () => {
        performanceMode = sPerfMode.checked;
        localStorage.setItem('vocalmap_perf', performanceMode ? 'true' : 'false');
        if (!performanceMode && typeof drawPitchBackground === 'function') {
            drawPitchBackground(); // Force a full background redraw when switching back to legacy mode
        }
    });
}

window.resetSettings = function() {
    if (sLoudness) sLoudness.value = DEFAULT_SETTINGS.loudnessGate;
    if (sClarity) sClarity.value = DEFAULT_SETTINGS.clarityThreshold;
    if (sNoise) sNoise.value = DEFAULT_SETTINGS.noiseTracking;
    if (sPianoVol) sPianoVol.value = 1.0;
    if (sPlayVol) sPlayVol.value = 1.0;
    
    if (sPerfMode) {
        sPerfMode.checked = true;
        performanceMode = true;
        localStorage.setItem('vocalmap_perf', 'true');
    }
    
    localStorage.removeItem('vmap_set_loudness');
    localStorage.removeItem('vmap_set_clarity');
    localStorage.removeItem('vmap_set_noise');
    localStorage.removeItem('vmap_set_piano_vol');
    localStorage.removeItem('vmap_set_play_vol');
    
    if (vLoudness) vLoudness.innerText = sLoudness.value;
    if (vClarity) vClarity.innerText = sClarity.value;
    if (vNoise) vNoise.innerText = sNoise.value;
    if (vPianoVol) vPianoVol.innerText = sPianoVol.value;
    if (vPlayVol) vPlayVol.innerText = sPlayVol.value;
    
    window.globalPianoVolume = 1.0;
    window.globalPlaybackVolume = 1.0;
    if (typeof playbackAudio !== 'undefined') playbackAudio.volume = 1.0;
    
    sendSettings();
};

// Liquid Glass Mouse Tracking
document.addEventListener('mousemove', (e) => {
    document.querySelectorAll('.glass-panel').forEach((panel) => {
        const rect = panel.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        panel.style.setProperty('--mouse-x', x + 'px');
        panel.style.setProperty('--mouse-y', y + 'px');
    });
});

// 使用说明与帮助 Modal 控制
const helpModal = document.getElementById('helpModal');

window.openHelp = function() {
    if (helpModal) {
        helpModal.classList.add('active');
        // 自动切换到第一个“快速入门”标签
        window.switchHelpTab('intro');
    }
};

window.closeHelp = function() {
    if (helpModal) helpModal.classList.remove('active');
};

window.switchHelpTab = function(tabId) {
    // 隐藏所有帮助内容块
    document.querySelectorAll('.help-tab-content').forEach(el => el.style.display = 'none');
    // 移除所有帮助标签按钮的激活状态
    document.querySelectorAll('.help-tab-btn').forEach(btn => btn.classList.remove('active'));
    
    // 显示对应的帮助内容
    const targetContent = document.getElementById('helpTabContent_' + tabId);
    if (targetContent) targetContent.style.display = 'block';
    
    // 激活对应的标签按钮
    const targetBtn = document.getElementById('helpTabBtn_' + tabId);
    if (targetBtn) targetBtn.classList.add('active');
};

window.submitBug = function() {
    if (typeof open === 'function') {
        open("https://github.com/DX-Protst/VocalMap-Release/issues/new");
    } else {
        window.open("https://github.com/DX-Protst/VocalMap-Release/issues/new", "_blank");
    }
};
