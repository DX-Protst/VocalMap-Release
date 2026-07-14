// ==========================================
// VocalMap Updater, Settings & Main Tabs UI
// ==========================================

window.switchTab = function(tabName) {
    if (typeof window.closeMobileMenu === 'function') window.closeMobileMenu();

    const freeWs = document.getElementById('freeWorkspace');
    const proWs = document.getElementById('proWorkspace');
    const btnFree = document.getElementById('tabBtnFree');
    const btnPro = document.getElementById('tabBtnPro');

    const licenseWs = document.getElementById('licenseWorkspace');

    function triggerAnimation(el, className) {
        if (!el) return;
        el.classList.remove('animate-slide-left', 'animate-slide-right', 'animate-slide-up');
        void el.offsetWidth; 
        el.classList.add(className);
    }

    if (tabName === 'free') {
        if (freeWs) freeWs.style.display = 'flex'; 
        if (proWs) proWs.style.display = 'none';
        if (licenseWs) licenseWs.style.display = 'none';
        if (btnFree) btnFree.classList.add('active');
        if (btnPro) btnPro.classList.remove('active', 'active-pro');
        if (freeWs) triggerAnimation(freeWs, 'animate-slide-left');
    } else if (tabName === 'pro') {
        if (freeWs) freeWs.style.display = 'none'; 
        const cache = typeof getLicenseCache === 'function' ? getLicenseCache() : null;
        if (cache) {
            if (proWs) proWs.style.display = 'flex';
            if (licenseWs) licenseWs.style.display = 'none';
            if (proWs) triggerAnimation(proWs, 'animate-slide-right');
        } else {
            if (proWs) proWs.style.display = 'none';
            if (licenseWs) licenseWs.style.display = 'flex';
            if (licenseWs) triggerAnimation(licenseWs, 'animate-slide-right');
        }
        if (btnPro) btnPro.classList.add('active-pro');
        if (btnFree) btnFree.classList.remove('active');
    } else if (tabName === 'license') {
        if (freeWs) freeWs.style.display = 'none';
        if (proWs) proWs.style.display = 'none';
        if (licenseWs) licenseWs.style.display = 'flex';
        if (btnPro) btnPro.classList.add('active-pro');
        if (btnFree) btnFree.classList.remove('active');
        if (licenseWs) triggerAnimation(licenseWs, 'animate-slide-right');
    }

    if (typeof window.doResize === 'function') {
        window.doResize();
    }
};

// ==========================================
// Mobile Menu Collapse/Toggle UI Functions
// ==========================================
window.toggleMobileMenu = function() {
    const menu = document.getElementById('topNavMenu');
    const toggleIcon = document.getElementById('menuToggleIcon');
    if (menu) {
        menu.classList.toggle('active');
        if (menu.classList.contains('active')) {
            if (toggleIcon) toggleIcon.setAttribute('data-lucide', 'x');
        } else {
            if (toggleIcon) toggleIcon.setAttribute('data-lucide', 'menu');
        }
        if (typeof lucide !== 'undefined') lucide.createIcons();
    }
};

window.closeMobileMenu = function() {
    const menu = document.getElementById('topNavMenu');
    const toggleIcon = document.getElementById('menuToggleIcon');
    if (menu && menu.classList.contains('active')) {
        menu.classList.remove('active');
        if (toggleIcon) {
            toggleIcon.setAttribute('data-lucide', 'menu');
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }
    }
};

// Register backdrop click to close mobile menu overlay
document.addEventListener('DOMContentLoaded', () => {
    const menu = document.getElementById('topNavMenu');
    if (menu) {
        menu.addEventListener('click', (e) => {
            if (e.target === menu) {
                window.closeMobileMenu();
            }
        });
    }
    
    // Bind settings button click
    const btnSettings = document.getElementById('btnSettings');
    if (btnSettings && typeof window.openSettings === 'function') {
        btnSettings.addEventListener('click', window.openSettings);
    }
});

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
        if (typeof showToast === 'function') {
            showToast(t('update.toast_title_checking', '更新检测'), t('update.checking', '正在检查更新...'), 'info');
        }
        
        try {
            const update = await check();
            if (update) {
                updateObject = update;
                btnCheck.style.display = 'none';
                if (progressWrapper) progressWrapper.style.display = 'none';
                if (btnInstall) {
                    btnInstall.style.display = 'block';
                    btnInstall.innerText = t('update.download', '下载更新');
                    btnInstall.disabled = false;
                }
                if (typeof showToast === 'function') {
                    showToast(t('update.toast_title_found', '发现新版本'), t('update.found_prefix', '发现新版本 v') + update.version + t('update.found_suffix', '，请点击下载更新'), 'success');
                }
                if (progressBar) progressBar.style.width = '0%';
                updateState = 'download-ready';
            } else {
                btnCheck.style.display = 'block';
                btnCheck.disabled = false;
                if (typeof showToast === 'function') {
                    showToast(t('update.toast_title_latest', '检查完毕'), t('update.latest', '已是最新版本'), 'success');
                }
            }
        } catch (err) {
            if (typeof showToast === 'function') {
                showToast(t('update.toast_title_error', '检测失败'), t('update.check_failed', '更新失败: ') + err, 'error');
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
                btnInstall.innerText = t('update.downloading', '正在下载...');
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
                                if (contentLength > 0 && progressBar) {
                                    const pct = Math.round((downloaded / contentLength) * 100);
                                    progressBar.style.width = pct + '%';
                                }
                                break;
                        }
                    });

                    if (progressWrapper) progressWrapper.style.display = 'none';
                    if (typeof showToast === 'function') {
                        showToast(t('update.toast_title_ready', '下载完成'), t('update.download_success_prefix', 'v') + updateObject.version + t('update.download_success_suffix', ' 下载完成，请点击安装并重启'), 'success');
                    }
                    btnInstall.innerText = t('update.install', '安装并重启');
                    btnInstall.disabled = false;
                    updateState = 'install-ready';
                } catch (err) {
                    if (typeof showToast === 'function') {
                        showToast(t('update.toast_title_error', '下载失败'), t('update.download_failed', '下载失败: ') + err, 'error');
                    }
                    btnInstall.innerText = t('update.redownload', '重新下载');
                    btnInstall.disabled = false;
                    updateState = 'download-ready';
                    if (progressWrapper) progressWrapper.style.display = 'none';
                }
            } else if (updateState === 'install-ready') {
                updateState = 'installing';
                btnInstall.disabled = true;
                btnInstall.innerText = t('update.installing', '正在安装...');
                if (typeof showToast === 'function') {
                    showToast(t('update.toast_title_installing', '正在安装'), t('update.installing_status', '正在安装更新，准备重启...'), 'info');
                }
                
                try {
                    await updateObject.install();
                    
                    if (typeof invoke === 'function') {
                        await invoke('relaunch_app');
                    } else {
                        console.warn("relaunch_app command not found");
                    }
                } catch (err) {
                    if (typeof showToast === 'function') {
                        showToast(t('update.toast_title_error', '安装失败'), t('update.install_failed', '安装失败: ') + err, 'error');
                    }
                    btnInstall.innerText = t('update.reinstall', '重新安装');
                    btnInstall.disabled = false;
                    updateState = 'install-ready';
                }
            }
        });
    }

    window.addEventListener('languagechanged', () => {
        if (btnCheck) {
            btnCheck.innerText = t('update.check_btn', '检查更新');
        }
        if (btnInstall) {
            if (updateState === 'download-ready') {
                btnInstall.innerText = t('update.download', '下载更新');
            } else if (updateState === 'downloading') {
                btnInstall.innerText = t('update.downloading', '正在下载...');
            } else if (updateState === 'install-ready') {
                btnInstall.innerText = t('update.install', '安装并重启');
            } else if (updateState === 'installing') {
                btnInstall.innerText = t('update.installing', '正在安装...');
            } else {
                btnInstall.innerText = t('update.install_btn', '重启安装');
            }
        }
        if (statusText) {
            if (updateState === 'none') {
                if (statusText.innerText !== '') {
                    statusText.innerText = t('update.latest', '已是最新版本');
                }
            } else if (updateState === 'download-ready' && updateObject) {
                statusText.innerText = t('update.found_prefix', '发现新版本 v') + updateObject.version + t('update.found_suffix', '，请点击下载更新');
            } else if (updateState === 'install-ready' && updateObject) {
                statusText.innerText = t('update.download_success_prefix', 'v') + updateObject.version + t('update.download_success_suffix', ' 下载完成，请点击安装并重启');
            }
        }
    });
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
    try {
        if (typeof window.closeMobileMenu === 'function') window.closeMobileMenu();
        const sPerfMode = document.getElementById('togglePerformanceMode');
        if (sPerfMode) sPerfMode.checked = typeof performanceMode !== 'undefined' ? performanceMode : false;
        const selectLanguage = document.getElementById('selectLanguage');
        if (selectLanguage) {
            selectLanguage.value = localStorage.getItem('vmap_set_lang') || 'zh';
        }
        
        // Sync custom background controls and disable invalid ones based on theme
        if (typeof window.syncBackgroundOptions === 'function') {
            window.syncBackgroundOptions();
        }
        
        let isLight = typeof isLightMode !== 'undefined' ? isLightMode : false;
        const bgType = localStorage.getItem('vmap_set_bg_type') || (isLight ? 'default_light' : 'default_dark');
        
        const colorContainer = document.getElementById('customColorContainer');
        const imageContainer = document.getElementById('customImageContainer');
        if (colorContainer) colorContainer.style.display = (bgType === 'color') ? 'flex' : 'none';
        if (imageContainer) imageContainer.style.display = (bgType === 'image') ? 'flex' : 'none';
        
        const inputColor = document.getElementById('inputCustomColor');
        if (inputColor) {
            inputColor.value = localStorage.getItem('vmap_set_bg_color') || '#050508';
        }
        
        const statusText = document.getElementById('textImageStatus');
        if (statusText) {
            const hasImg = !!localStorage.getItem('vmap_set_bg_image_data');
            statusText.innerText = hasImg ? (window.t ? window.t('bg.load_success', '背景图片已应用并保存') : '背景图片已应用并保存') : (window.t ? window.t('bg.no_image', '未选择任何图片') : '未选择任何图片');
        }
        
        const modal = document.getElementById('settingsModal');
        if (modal) modal.classList.add('active');
        else console.error("settingsModal not found in DOM");
    } catch (e) {
        console.error("Error in openSettings:", e);
        const modal = document.getElementById('settingsModal');
        if (modal) modal.classList.add('active');
    }
};

window.closeSettings = function() {
    const modal = document.getElementById('settingsModal');
    if (modal) modal.classList.remove('active');
};

function sendSettings() {
    if (!isRunning) return;
    const settings = {
        loudness_gate: parseFloat(sLoudness.value),
        clarity_threshold: parseFloat(sClarity.value),
        noise_silence_threshold: parseFloat(sNoise.value)
    };
    invoke('vmap_update_settings', { settings: settings }).catch(e => console.error(e));
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
        if (typeof window.syncPerformanceModeCSS === 'function') {
            window.syncPerformanceModeCSS();
        }
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
        sPerfMode.checked = false;
        performanceMode = false;
        localStorage.setItem('vocalmap_perf', 'false');
        if (typeof window.syncPerformanceModeCSS === 'function') {
            window.syncPerformanceModeCSS();
        }
    }
    
    // Reset custom background elements
    const selectBg = document.getElementById('selectBackground');
    if (selectBg) selectBg.value = isLightMode ? 'default_light' : 'default_dark';
    const colorContainer = document.getElementById('customColorContainer');
    const imageContainer = document.getElementById('customImageContainer');
    if (colorContainer) colorContainer.style.display = 'none';
    if (imageContainer) imageContainer.style.display = 'none';
    
    localStorage.removeItem('vmap_set_bg_type');
    localStorage.removeItem('vmap_set_bg_color');
    localStorage.removeItem('vmap_set_bg_image_data');
    if (typeof window.syncBackgroundOptions === 'function') {
        window.syncBackgroundOptions();
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
let lastClientX = -500;
let lastClientY = -500;

function updateGlassPanels(clientX, clientY) {
    document.querySelectorAll('.glass-panel').forEach((panel) => {
        const rect = panel.getBoundingClientRect();
        const x = clientX - rect.left;
        const y = clientY - rect.top;
        panel.style.setProperty('--mouse-x', x + 'px');
        panel.style.setProperty('--mouse-y', y + 'px');
    });
}

document.addEventListener('mousemove', (e) => {
    lastClientX = e.clientX;
    lastClientY = e.clientY;
    updateGlassPanels(lastClientX, lastClientY);
});

document.addEventListener('scroll', () => {
    updateGlassPanels(lastClientX, lastClientY);
}, { passive: true, capture: true });


// 使用说明与帮助 Modal 控制
const helpModal = document.getElementById('helpModal');

window.openHelp = function() {
    if (typeof window.closeMobileMenu === 'function') window.closeMobileMenu();
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
    if (targetBtn) {
        targetBtn.classList.add('active');
        
        // 自动将当前选中的 Tab 按钮居中滚动
        const sidebar = targetBtn.parentElement;
        if (sidebar && sidebar.classList.contains('help-sidebar')) {
            const btnLeft = targetBtn.offsetLeft;
            const btnWidth = targetBtn.offsetWidth;
            const sidebarWidth = sidebar.clientWidth;
            
            // 让按钮中点与滚动容器中点对齐
            const scrollTarget = btnLeft - (sidebarWidth / 2) + (btnWidth / 2);
            
            sidebar.scrollTo({
                left: scrollTarget,
                behavior: 'smooth'
            });
        }
    }
};

window.submitBug = function() {
    if (typeof open === 'function') {
        open("https://github.com/DX-Protst/VocalMap-Release/issues/new");
    } else {
        window.open("https://github.com/DX-Protst/VocalMap-Release/issues/new", "_blank");
    }
};

window.openOfficialWebsite = function() {
    if (typeof open === 'function') {
        open("https://vocalmap.cc.cd");
    } else {
        window.open("https://vocalmap.cc.cd", "_blank");
    }
};

// ==========================================
// Custom Background Logic
// ==========================================
window.applyBackground = function(type, color, imageDataUrl) {
    if (!type || type === 'default') {
        type = isLightMode ? 'default_light' : 'default_dark';
    }
    
    document.body.setAttribute('data-bg-type', type);
    document.body.style.background = '';
    
    if (type === 'color') {
        const customColor = color || localStorage.getItem('vmap_set_bg_color') || '#050508';
        document.body.style.setProperty('background', customColor, 'important');
    } else if (type === 'image') {
        const dataUrl = imageDataUrl || localStorage.getItem('vmap_set_bg_image_data');
        if (dataUrl) {
            document.body.style.setProperty('background', `url(${dataUrl}) center/cover no-repeat fixed`, 'important');
        } else {
            document.body.setAttribute('data-bg-type', isLightMode ? 'default_light' : 'default_dark');
        }
    }
};

window.syncBackgroundOptions = function() {
    const selectBg = document.getElementById('selectBackground');
    if (!selectBg) return;
    
    const darkOpts = ['default_dark', 'black', 'blue_dark', 'green_dark'];
    const lightOpts = ['default_light', 'white', 'blue_light', 'green_light'];
    
    let currentType = localStorage.getItem('vmap_set_bg_type');
    
    if (!currentType || currentType === 'default') {
        currentType = isLightMode ? 'default_light' : 'default_dark';
    }
    
    // Disable/Enable options based on current theme mode
    Array.from(selectBg.options).forEach(opt => {
        if (isLightMode) {
            if (darkOpts.includes(opt.value)) {
                opt.disabled = true;
            } else {
                opt.disabled = false;
            }
        } else {
            if (lightOpts.includes(opt.value)) {
                opt.disabled = true;
            } else {
                opt.disabled = false;
            }
        }
    });
    
    // Handle fallback if current selection is invalid for the active theme mode
    if (isLightMode && darkOpts.includes(currentType)) {
        currentType = 'default_light';
        localStorage.setItem('vmap_set_bg_type', currentType);
    } else if (!isLightMode && lightOpts.includes(currentType)) {
        currentType = 'default_dark';
        localStorage.setItem('vmap_set_bg_type', currentType);
    }
    
    selectBg.value = currentType;
    
    const color = localStorage.getItem('vmap_set_bg_color') || '#050508';
    const imageDataUrl = localStorage.getItem('vmap_set_bg_image_data');
    window.applyBackground(currentType, color, imageDataUrl);
};

window.changeBackgroundStyle = function(type) {
    const colorContainer = document.getElementById('customColorContainer');
    const imageContainer = document.getElementById('customImageContainer');
    
    if (colorContainer) colorContainer.style.display = (type === 'color') ? 'flex' : 'none';
    if (imageContainer) imageContainer.style.display = (type === 'image') ? 'flex' : 'none';
    
    localStorage.setItem('vmap_set_bg_type', type);
    
    if (type === 'color') {
        const color = document.getElementById('inputCustomColor').value;
        window.applyBackground('color', color);
    } else if (type === 'image') {
        const dataUrl = localStorage.getItem('vmap_set_bg_image_data');
        window.applyBackground('image', null, dataUrl);
    } else {
        window.applyBackground(type);
    }
};

window.applyCustomColor = function(color) {
    localStorage.setItem('vmap_set_bg_color', color);
    window.applyBackground('color', color);
};

window.handleImageUpload = function(event) {
    const file = event.target.files[0];
    if (file) {
        if (!file.type.startsWith('image/')) {
            const statusText = document.getElementById('textImageStatus');
            if (statusText) statusText.innerText = window.t('bg.invalid_file', '请选择有效的图片文件');
            return;
        }
        window.compressAndSaveBgImage(file);
    }
};

window.compressAndSaveBgImage = function(file) {
    const statusText = document.getElementById('textImageStatus');
    if (statusText) statusText.innerText = window.t('bg.loading', '正在加载并压缩图片...');
    
    const reader = new FileReader();
    reader.onload = function(e) {
        const img = new Image();
        img.onload = function() {
            const MAX_WIDTH = 1920;
            const MAX_HEIGHT = 1080;
            let width = img.width;
            let height = img.height;
            
            if (width > MAX_WIDTH) {
                height *= MAX_WIDTH / width;
                width = MAX_WIDTH;
            }
            if (height > MAX_HEIGHT) {
                width *= MAX_HEIGHT / height;
                height = MAX_HEIGHT;
            }
            
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            
            const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.75);
            
            try {
                localStorage.setItem('vmap_set_bg_image_data', compressedDataUrl);
                window.applyBackground('image', null, compressedDataUrl);
                if (statusText) statusText.innerText = window.t('bg.load_success', '背景图片已应用并保存');
            } catch (err) {
                console.error("Failed to save background image", err);
                if (statusText) statusText.innerText = window.t('bg.load_failed', '图片太大或存储失败，请重试');
            }
        };
        img.onerror = function() {
            if (statusText) statusText.innerText = window.t('bg.load_failed', '图片加载失败，请重试');
        };
        img.src = e.target.result;
    };
    reader.onerror = function() {
        if (statusText) statusText.innerText = window.t('bg.load_failed', '图片加载失败，请重试');
    };
    reader.readAsDataURL(file);
};

// Initialize and sync background options on startup
if (typeof window.syncBackgroundOptions === 'function') {
    window.syncBackgroundOptions();
}
