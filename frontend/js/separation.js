// ==========================================
// VocalMap Pro Audio Separation Engine
// ==========================================

window.switchProTab = async function(tabName) {
    currentProTab = tabName;
    const singStates = ['proStateIdle', 'proStateRecording', 'proStateReport'];
    const sepState = document.getElementById('proStateSeparation');
    const trainState = document.getElementById('proStateTraining');
    const btnSing = document.getElementById('btnSubTabSing');
    const btnSep = document.getElementById('btnSubTabSep');
    const btnTrain = document.getElementById('btnSubTabTrain');

    if (tabName === 'sep') {
        try {
            const hasDeps = await invoke('check_dependencies');
            if (!hasDeps) {
                showDownloadOverlay();
                return; 
            }
        } catch (e) {
            console.warn(e);
        }

        singStates.forEach(function(id) {
            var el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
        if (trainState) trainState.style.display = 'none';
        if (sepState) sepState.style.display = 'flex';
        
        if (btnSing) btnSing.classList.remove('active-mini');
        if (btnTrain) btnTrain.classList.remove('active-mini');
        if (btnSep) btnSep.classList.add('active-mini');
        
        if (sepState) {
            sepState.classList.remove('animate-slide-left', 'animate-slide-right', 'animate-slide-up');
            void sepState.offsetWidth;
            sepState.classList.add('animate-slide-right');
        }
    } else if (tabName === 'train') {
        singStates.forEach(function(id) {
            var el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
        if (sepState) sepState.style.display = 'none';
        if (trainState) trainState.style.display = 'flex';
        
        if (btnSing) btnSing.classList.remove('active-mini');
        if (btnSep) btnSep.classList.remove('active-mini');
        if (btnTrain) btnTrain.classList.add('active-mini');
        
        if (trainState) {
            trainState.classList.remove('animate-slide-left', 'animate-slide-right', 'animate-slide-up');
            void trainState.offsetWidth;
            trainState.classList.add('animate-slide-up');
        }
    } else {
        if (sepState) sepState.style.display = 'none';
        if (trainState) trainState.style.display = 'none';
        var idle = document.getElementById('proStateIdle');
        if (idle) {
            idle.style.display = 'flex';
            idle.classList.remove('animate-slide-left', 'animate-slide-right', 'animate-slide-up');
            void idle.offsetWidth;
            idle.classList.add('animate-slide-left');
        }
        if (btnSep) btnSep.classList.remove('active-mini');
        if (btnTrain) btnTrain.classList.remove('active-mini');
        if (btnSing) btnSing.classList.add('active-mini');
    }
};

function showDownloadOverlay() {
    let overlay = document.getElementById('envDownloadOverlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'envDownloadOverlay';
        overlay.className = 'modal-overlay active';
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:"Segoe UI",sans-serif; transition: opacity 0.3s;';
        
        overlay.innerHTML = `
            <div class="modal-content glass-panel" style="padding:40px;width:540px;text-align:center;">
                <h2 style="margin-top:0;color:var(--primary-cyan);">${t('sep.dl_title', '初始化 AI 分离引擎')}</h2>
                <p style="color:var(--text-muted);font-size:14px;line-height:1.6;margin-bottom:20px;">
                    ${t('sep.dl_desc', '首次使用音轨分离功能需要下载运行环境及模型权重。<br>这包含 PyTorch、CUDA 加速库以及两个高性能模型（总计约 5GB）。<br>下载时间取决于您的网速，请保持网络畅通。')}
                </p>
                <div id="dlProgressContainer" style="display:none;margin-bottom:20px;">
                    <div style="width:100%;height:8px;background:var(--glass-border);border-radius:4px;overflow:hidden;">
                        <div id="dlProgressBar" style="width:0%;height:100%;background:var(--primary-cyan);transition:width 0.3s;"></div>
                    </div>
                    <p id="dlProgressText" style="color:var(--primary-cyan);font-size:13px;margin-top:10px;">${t('sep.dl_preparing', '准备下载...')}</p>
                </div>
                <div id="dlConsole" style="display:none; width:100%; height:180px; background:rgba(0,0,0,0.5); border:1px solid var(--glass-border); border-radius:6px; margin-bottom:20px; overflow-y:auto; text-align:left; padding:10px; font-family:'JetBrains Mono', monospace; font-size:11px; color:#a399b5; box-sizing:border-box;"></div>
                <button id="btnStartEnvDl" style="background:var(--primary-cyan);color:#121212;border:none;padding:12px 30px;border-radius:6px;font-size:15px;cursor:pointer;font-weight:bold;transition:0.2s;">
                    ${t('sep.dl_btn_dl', '🚀 立即开始下载 (5GB)')}
                </button>
                <button id="btnCancelEnvDl" style="background:transparent;color:var(--text-muted);border:none;margin-top:15px;cursor:pointer;font-size:13px;">
                    ${t('sep.dl_btn_later', '以后再说，返回主界面')}
                </button>
            </div>
        `;
        document.body.appendChild(overlay);

        document.getElementById('btnCancelEnvDl').onclick = () => {
            overlay.style.display = 'none';
            document.getElementById('btnStartEnvDl').style.display = 'inline-block';
            document.getElementById('btnCancelEnvDl').innerText = t('sep.dl_btn_later', '以后再说，返回主界面');
            document.getElementById('dlProgressContainer').style.display = 'none';
            document.getElementById('dlProgressBar').style.width = '0%';
            document.getElementById('dlProgressText').innerText = t('sep.dl_preparing', '准备下载...');
            document.getElementById('dlProgressText').style.color = 'var(--primary-cyan)';
            document.getElementById('dlProgressBar').style.background = 'var(--primary-cyan)';
            document.getElementById('dlConsole').style.display = 'none';
        };

        let progressUnlisten = null;
        let consoleUnlisten = null;

        document.getElementById('btnStartEnvDl').onclick = async () => {
            document.getElementById('btnStartEnvDl').style.display = 'none';
            document.getElementById('btnCancelEnvDl').style.display = 'none';
            document.getElementById('dlProgressContainer').style.display = 'block';
            document.getElementById('dlConsole').style.display = 'block';
            document.getElementById('dlConsole').innerHTML = '';
            
            try {
                if (!progressUnlisten) {
                    progressUnlisten = await listen('download-progress', (event) => {
                        const data = event.payload;
                        document.getElementById('dlProgressBar').style.width = data.percent + '%';
                        document.getElementById('dlProgressText').innerText = data.message + ' (' + data.percent.toFixed(1) + '%)';
                    });
                }
                
                if (!consoleUnlisten) {
                    consoleUnlisten = await listen('download-console', (event) => {
                        const data = event.payload;
                        const consoleEl = document.getElementById('dlConsole');
                        const line = document.createElement('div');
                        line.innerText = data.line;
                        consoleEl.appendChild(line);
                        consoleEl.scrollTop = consoleEl.scrollHeight;
                    });
                }

                const result = await invoke('start_download');
                if (result.success) {
                    document.getElementById('dlProgressText').innerText = t('sep.dl_success', '✅ 下载部署完成！正在进入系统...');
                    document.getElementById('dlProgressText').style.color = 'var(--primary-green)';
                    document.getElementById('dlProgressBar').style.background = 'var(--primary-green)';
                    
                    if (progressUnlisten) { progressUnlisten(); progressUnlisten = null; }
                    if (consoleUnlisten) { consoleUnlisten(); consoleUnlisten = null; }

                    setTimeout(() => {
                        overlay.style.display = 'none';
                        window.switchProTab('sep');
                    }, 2000);
                }
            } catch (error) {
                document.getElementById('dlProgressText').innerText = t('sep.dl_failed', '❌ 下载失败: ') + error;
                document.getElementById('dlProgressText').style.color = 'var(--primary-red)';
                document.getElementById('dlProgressBar').style.background = 'var(--primary-red)';
                document.getElementById('btnCancelEnvDl').style.display = 'inline-block';
                document.getElementById('btnCancelEnvDl').innerText = t('sep.dl_close_retry', '关闭并重试');
            }
        };
    }
    overlay.style.display = 'flex';
}

window.setDevice = function(device) {
    forceCPU = (device === 'cpu');
    var btnGPU = document.getElementById('btnGPU');
    var btnCPU = document.getElementById('btnCPU');
    if (forceCPU) {
        if (btnGPU) btnGPU.className = 'btn-ghost';
        if (btnCPU) btnCPU.className = 'btn-cyan';
    } else {
        if (btnGPU) btnGPU.className = 'btn-cyan';
        if (btnCPU) btnCPU.className = 'btn-ghost';
    }
};

// 乐器分离面板
(function initSepInst() {
    var zone = document.getElementById('sepInstUploadZone');
    var input = document.getElementById('sepInstFileInput');
    var btn = document.getElementById('btnStartSepInst');
    var resetBtn = document.getElementById('btnResetSepInst');
    if (!zone) return;

    zone.addEventListener('click', function() { input.click(); });
    zone.addEventListener('dragover', function(e) { e.preventDefault(); zone.style.borderColor = 'var(--primary-cyan)'; });
    zone.addEventListener('dragleave', function() { zone.style.borderColor = 'var(--glass-border)'; });
    zone.addEventListener('drop', function(e) {
        e.preventDefault(); zone.style.borderColor = 'var(--glass-border)';
        if (e.dataTransfer.files.length > 0) handleInstFile(e.dataTransfer.files[0]);
    });
    input.addEventListener('change', function() {
        if (input.files.length > 0) handleInstFile(input.files[0]);
    });
    btn.addEventListener('click', function() { startSeparation('inst'); });
    resetBtn.addEventListener('click', resetInstUI);

    function handleInstFile(file) {
        selectedFileInst = file;
        var sizeMB = (file.size / 1024 / 1024).toFixed(1);
        zone.innerHTML = '<div>' +
            '<i data-lucide="file-audio" style="width: 32px; height: 32px; color: var(--primary-cyan); margin: 0 auto 8px; display: block;"></i>' +
            '<p style="color: var(--primary-cyan); margin: 3px 0; font-weight: bold; font-size: 14px;">' + file.name + '</p>' +
            '<p style="color: var(--text-muted); font-size: 11px;">' + sizeMB + ' MB</p>' +
            '</div>';
        if (window.lucide) window.lucide.createIcons();
        btn.style.display = 'block';
        resetBtn.style.display = 'none';
        document.getElementById('sepInstResults').style.display = 'none';
        document.getElementById('sepInstProcessing').style.display = 'none';
    }
})();

function resetInstUI() {
    selectedFileInst = null;
    document.getElementById('btnStartSepInst').style.display = 'none';
    document.getElementById('sepInstProcessing').style.display = 'none';
    document.getElementById('sepInstResults').style.display = 'none';
    document.getElementById('btnResetSepInst').style.display = 'none';
    resetSepProgressUI('inst');
    var zone = document.getElementById('sepInstUploadZone');
    if (zone) {
        zone.innerHTML = '<i data-lucide="folder-open" style="width: 36px; height: 36px; stroke-width: 1.5px; margin: 0 auto 12px; color: var(--primary-cyan); display: block;"></i>' +
            '<p style="color: var(--text-main); margin: 3px 0; font-size: 14px; font-weight: bold;">' + t('sep.click_to_upload', '点击或拖拽上传音频') + '</p>' +
            '<p style="color: var(--text-muted); font-size: 11px;">WAV / MP3 / FLAC</p>';
        if (window.lucide) window.lucide.createIcons();
    }
}

// 人声和声分离面板
(function initSepVoc() {
    var zone = document.getElementById('sepVocUploadZone');
    var input = document.getElementById('sepVocFileInput');
    var btn = document.getElementById('btnStartSepVoc');
    var resetBtn = document.getElementById('btnResetSepVoc');
    if (!zone) return;

    zone.addEventListener('click', function() { input.click(); });
    zone.addEventListener('dragover', function(e) { e.preventDefault(); zone.style.borderColor = 'var(--primary-purple)'; });
    zone.addEventListener('dragleave', function() { zone.style.borderColor = 'var(--glass-border)'; });
    zone.addEventListener('drop', function(e) {
        e.preventDefault(); zone.style.borderColor = 'var(--glass-border)';
        if (e.dataTransfer.files.length > 0) handleVocFile(e.dataTransfer.files[0]);
    });
    input.addEventListener('change', function() {
        if (input.files.length > 0) handleVocFile(input.files[0]);
    });
    btn.addEventListener('click', function() { startSeparation('voc'); });
    resetBtn.addEventListener('click', resetVocUI);

    function handleVocFile(file) {
        selectedFileVoc = file;
        var sizeMB = (file.size / 1024 / 1024).toFixed(1);
        zone.innerHTML = '<div>' +
            '<i data-lucide="file-audio" style="width: 32px; height: 32px; color: var(--primary-purple); margin: 0 auto 8px; display: block;"></i>' +
            '<p style="color: var(--primary-purple); margin: 3px 0; font-weight: bold; font-size: 14px;">' + file.name + '</p>' +
            '<p style="color: var(--text-muted); font-size: 11px;">' + sizeMB + ' MB</p>' +
            '</div>';
        if (window.lucide) window.lucide.createIcons();
        btn.style.display = 'block';
        resetBtn.style.display = 'none';
        document.getElementById('sepVocResults').style.display = 'none';
        document.getElementById('sepVocProcessing').style.display = 'none';
    }
})();

function resetVocUI() {
    selectedFileVoc = null;
    document.getElementById('btnStartSepVoc').style.display = 'none';
    document.getElementById('sepVocProcessing').style.display = 'none';
    document.getElementById('sepVocResults').style.display = 'none';
    document.getElementById('btnResetSepVoc').style.display = 'none';
    resetSepProgressUI('voc');
    var zone = document.getElementById('sepVocUploadZone');
    if (zone) {
        zone.innerHTML = '<i data-lucide="music" style="width: 36px; height: 36px; stroke-width: 1.5px; margin: 0 auto 12px; color: var(--primary-purple); display: block;"></i>' +
            '<p style="color: var(--text-main); margin: 3px 0; font-size: 14px; font-weight: bold;">' + t('sep.click_to_upload', '点击或拖拽上传音频') + '</p>' +
            '<p style="color: var(--text-muted); font-size: 11px;">WAV / MP3 / FLAC</p>';
        if (window.lucide) window.lucide.createIcons();
    }
}

// 通用分离逻辑
function getSepProgressIds(panelType) {
    var prefix = panelType === 'inst' ? 'sepInst' : 'sepVoc';
    return {
        text: prefix + 'Progress',
        bar: prefix + 'ProgressBar',
        percent: prefix + 'ProgressPercent',
        box: prefix + 'ProgressBox'
    };
}

function ensureSepProgressUI(panelType) {
    var ids = getSepProgressIds(panelType);
    var textEl = document.getElementById(ids.text);
    if (!textEl || document.getElementById(ids.box)) return;

    var color = panelType === 'inst' ? 'var(--primary-cyan)' : 'var(--primary-purple)';
    var box = document.createElement('div');
    box.id = ids.box;
    box.style.cssText = 'margin-top:14px;text-align:left;';
    box.innerHTML =
        '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">' +
            '<div style="flex:1;height:8px;background:rgba(255,255,255,0.08);border:1px solid var(--glass-border);border-radius:6px;overflow:hidden;">' +
                '<div id="' + ids.bar + '" style="width:0%;height:100%;background:' + color + ';box-shadow:0 0 10px ' + color + ';transition:width 0.25s ease;"></div>' +
            '</div>' +
            '<span id="' + ids.percent + '" style="width:46px;text-align:right;font-family:JetBrains Mono,monospace;font-size:11px;color:' + color + ';">0%</span>' +
        '</div>';
    textEl.insertAdjacentElement('afterend', box);
}

function resetSepProgressUI(panelType) {
    var ids = getSepProgressIds(panelType);
    var bar = document.getElementById(ids.bar);
    var percent = document.getElementById(ids.percent);
    if (bar) bar.style.width = '0%';
    if (percent) percent.innerText = '0%';
}

function renderSepProgress(panelType, task) {
    ensureSepProgressUI(panelType);
    var ids = getSepProgressIds(panelType);
    var textEl = document.getElementById(ids.text);
    var bar = document.getElementById(ids.bar);
    var percentEl = document.getElementById(ids.percent);
    var hasProgress = task && task.progress !== undefined && task.progress !== null && task.progress !== '';
    var progress = Number(hasProgress ? task.progress : NaN);
    if (!Number.isFinite(progress)) {
        progress = percentEl ? parseInt(percentEl.innerText, 10) : 0;
    }
    if (!Number.isFinite(progress)) progress = 0;
    progress = Math.max(0, Math.min(100, Math.round(progress)));

    if (bar) bar.style.width = progress + '%';
    if (percentEl) percentEl.innerText = progress + '%';

    var statusText = (task && task.status_text) ? String(task.status_text).trim() : '';
    if (textEl) {
        if (statusText) {
            textEl.innerText = progress > 0 && !/%/.test(statusText)
                ? t('sep.model_running', 'Model running, progress: ') + progress + '% - ' + statusText
                : statusText;
        } else if (progress > 0) {
            textEl.innerText = t('sep.model_running', 'Model running, progress: ') + progress + '% ...';
        } else {
            textEl.innerText = t('sep.model_loading', 'Model loading, please wait...');
        }
    }

}

async function startSeparation(panelType) {
    var selectedFile = panelType === 'inst' ? selectedFileInst : selectedFileVoc;
    if (!selectedFile) return;

    var modelKey = panelType === 'inst' ? 'logic_roformer_6s' : 'bs_roformer_karaoke';
    var btnId = panelType === 'inst' ? 'btnStartSepInst' : 'btnStartSepVoc';
    var procId = panelType === 'inst' ? 'sepInstProcessing' : 'sepVocProcessing';
    var resId = panelType === 'inst' ? 'sepInstResults' : 'sepVocResults';
    var progId = panelType === 'inst' ? 'sepInstProgress' : 'sepVocProgress';

    document.getElementById(btnId).style.display = 'none';
    document.getElementById(resId).style.display = 'none';
    document.getElementById(procId).style.display = 'block';
    ensureSepProgressUI(panelType);
    resetSepProgressUI(panelType);
    document.getElementById(progId).innerText = forceCPU ? t('sep.cpu_processing', 'CPU 处理中...') : t('sep.uploading_processing', '上传并推理中...');

    var formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('model_key', modelKey);
    formData.append('force_cpu', forceCPU ? 'true' : 'false');

    try {
        var resp = await fetch(SEP_BASE + '/api/separation/separate', {
            method: 'POST',
            body: formData,
            headers: {
                'X-VocalMap-Token': window.internalApiToken || ''
            }
        });
        var data = await resp.json();
        if (!resp.ok) {
            throw new Error(data.error || data.detail || ('HTTP ' + resp.status));
        }
        if (data.error) {
            alert(t('sep.task_error', '分离失败: ') + data.error);
            if (panelType === 'inst') resetInstUI(); else resetVocUI();
            return;
        }
        var taskId = data.task_id;
        document.getElementById(progId).innerText = t('sep.model_running_wait', '模型推理中，请耐心等待...');
        var acceptedLogs = ['Task ' + taskId + ' accepted. Waiting for backend output...'];
        if (data.progress_protocol) {
            acceptedLogs.push('Backend progress protocol: ' + data.progress_protocol);
        }
        if (data.worker_started) {
            acceptedLogs.push('Backend worker thread reported started by /api/separation/separate.');
        } else {
            acceptedLogs.push('Backend did not report worker_started in the start response.');
        }
        renderSepProgress(panelType, {
            progress: 0,
            status_text: data.worker_started
                ? 'Backend worker started. Polling task state...'
                : t('sep.model_running_wait', 'Model running, please wait...'),
            logs: acceptedLogs
        });
        pollSepTask(taskId, panelType);
    } catch (err) {
        alert(t('sep.request_failed', '请求失败: ') + err.message);
        if (panelType === 'inst') resetInstUI(); else resetVocUI();
    }
}

async function pollSepTask(taskId, panelType, consecutiveErrors) {
    consecutiveErrors = consecutiveErrors || 0;
    var progId = panelType === 'inst' ? 'sepInstProgress' : 'sepVocProgress';
    try {
        var resp = await fetch(SEP_BASE + '/api/separation/task/' + taskId, {
            headers: {
                'X-VocalMap-Token': window.internalApiToken || ''
            }
        });
        var task = await resp.json();
        if (!resp.ok || task.error) {
            throw new Error(task.error || task.detail || ('HTTP ' + resp.status));
        }
        consecutiveErrors = 0;
        if (task.status === 'completed') {
            renderSepProgress(panelType, task);
            showSepResults(taskId, task, panelType);
            return;
        } else if (task.status === 'error') {
            alert(t('sep.task_error', '分离出错: ') + (task.error || '未知错误'));
            if (panelType === 'inst') resetInstUI(); else resetVocUI();
            return;
        } else {
            var statusText = task.status_text || '';
            var progress = task.progress;
            var text = '';
            if (statusText) {
                var hasPercent = /%/.test(statusText);
                if (progress !== undefined && progress > 0 && !hasPercent) {
                    text = t('sep.model_running', '模型推理中，进度: ') + progress + '% - ' + statusText;
                } else {
                    text = statusText;
                }
            } else {
                if (progress !== undefined && progress > 0) {
                    text = t('sep.model_running', '模型推理中，进度: ') + progress + '% ...';
                } else {
                    text = t('sep.model_loading', '模型初始化中，请稍候...');
                }
            }
            document.getElementById(progId).innerText = text;
            renderSepProgress(panelType, task);
        }
    } catch (err) {
        console.error('轮询失败:', err);
        consecutiveErrors++;
        renderSepProgress(panelType, {
            progress: 0,
            status_text: '轮询任务状态失败，正在重试 (' + consecutiveErrors + '/10): ' + err.message,
            logs: [
                'Poll failed for task ' + taskId + ': ' + err.message,
                'Check backend port/token or whether the running Tauri app is using the updated backend files.'
            ]
        });
        if (consecutiveErrors >= 10) {
            alert(t('sep.max_retries_reached', '轮询连续失败达最大次数，已停止。请检查网络。'));
            if (panelType === 'inst') resetInstUI(); else resetVocUI();
            return;
        }
    }
    setTimeout(function() { pollSepTask(taskId, panelType, consecutiveErrors); }, 1500);
}

function showSepResults(taskId, task, panelType) {
    var procId = panelType === 'inst' ? 'sepInstProcessing' : 'sepVocProcessing';
    var resId = panelType === 'inst' ? 'sepInstResults' : 'sepVocResults';
    var listId = panelType === 'inst' ? 'sepInstStemsList' : 'sepVocStemsList';
    var resetBtnId = panelType === 'inst' ? 'btnResetSepInst' : 'btnResetSepVoc';

    document.getElementById(procId).style.display = 'none';
    document.getElementById(resId).style.display = 'block';
    document.getElementById(resetBtnId).style.display = 'block';

    var labels, colors, icons;
    if (panelType === 'inst') {
        labels = {
            'bass': t('sep.stem.bass', '贝斯'), 'drums': t('sep.stem.drums', '鼓组'), 'vocals': t('sep.stem.vocals', '人声'),
            'other': t('sep.stem.other', '其他'), 'guitar': t('sep.stem.guitar', '吉他'), 'piano': t('sep.stem.piano', '钢琴'),
            'instrumental': t('sep.stem.instrumental', '纯伴奏')
        };
        colors = {
            'bass': '#FF9100', 'drums': '#FF5252', 'vocals': '#00FFF5',
            'other': '#CE93D8', 'guitar': '#00E676', 'piano': '#FFEA00',
            'instrumental': '#448AFF'
        };
        icons = {
            'bass': 'guitar', 'drums': 'drum', 'vocals': 'mic',
            'other': 'disc', 'guitar': 'guitar', 'piano': 'piano',
            'instrumental': 'music'
        };
    } else {
        labels = { 'vocals': t('sep.stem.voc_lead', '人声'), 'instrumental': t('sep.stem.voc_harmony', '伴奏与和声') };
        colors = { 'vocals': '#00FFF5', 'instrumental': '#CE93D8' };
        icons = { 'vocals': 'mic', 'instrumental': 'music' };
    }

    var html = '';
    var stems = task.stems || {};
    for (var instr in stems) {
        var label = labels[instr] || instr;
        var color = colors[instr] || 'var(--primary-cyan)';
        var iconName = icons[instr] || 'music';
        html += '<div style="display: flex; align-items: center; background: var(--upload-zone-bg); border: 1px solid var(--glass-border); backdrop-filter: blur(8px); box-shadow: 0 4px 12px rgba(0,0,0,0.05); padding: 10px 14px; border-radius: 8px; border-left: 4px solid ' + color + '; margin-bottom: 6px;">' +
            '<i data-lucide="' + iconName + '" style="color: ' + color + '; margin-right: 10px; width: 16px; height: 16px; display: inline-flex; align-items: center; justify-content: center;"></i>' +
            '<span style="flex: 1; color: var(--text-main); font-size: 14px; font-weight: bold;">' + label + '</span>' +
            '<button onclick="window.downloadStemResult(event, \'' + taskId + '\', \'' + instr + '\', \'' + label + '\')" style="background: ' + color + '; color: #121212; border: none; padding: 4px 12px; border-radius: 3px; font-size: 11px; font-weight: bold; cursor: pointer; transition: 0.2s; outline: none;">' + t('sep.write_wav', '下载 WAV') + '</button>' +
            '</div>';
    }
    
    if (stems['vocals']) {
        html += '<div style="display: flex; gap: 10px; margin-top: 15px;">';
        
        html += '<div style="flex: 1; display: flex; align-items: center; background: rgba(0, 229, 255, 0.1); border: 1px dashed var(--primary-cyan); backdrop-filter: blur(8px); box-shadow: 0 4px 12px rgba(0,0,0,0.1); padding: 12px 14px; border-radius: 8px;">' +
            '<i data-lucide="waves" style="color: var(--primary-cyan); margin-right: 10px; width: 18px; height: 18px; display: inline-flex; align-items: center; justify-content: center;"></i>' +
            '<span style="flex: 1; color: var(--text-main); font-size: 13px; font-weight: bold;">导出标准复盘包 (.vmap)</span>' +
            '<button onclick="window.exportCustomMap(event, \'' + taskId + '\', \'vmap\')" style="background: var(--primary-cyan); color: #121212; border: none; padding: 6px 14px; border-radius: 4px; font-size: 12px; font-weight: bold; cursor: pointer; transition: 0.2s; outline: none;">导出</button>' +
            '</div>';
            
        html += '<div style="flex: 1; display: flex; align-items: center; background: rgba(255, 215, 0, 0.1); border: 1px dashed #FFD700; backdrop-filter: blur(8px); box-shadow: 0 4px 12px rgba(0,0,0,0.1); padding: 12px 14px; border-radius: 8px;">' +
            '<i data-lucide="target" style="color: #FFD700; margin-right: 10px; width: 18px; height: 18px; display: inline-flex; align-items: center; justify-content: center;"></i>' +
            '<span style="flex: 1; color: var(--text-main); font-size: 13px; font-weight: bold;">导出自定义靶向关卡 (.tmap)</span>' +
            '<button onclick="window.exportCustomMap(event, \'' + taskId + '\', \'tmap\')" style="background: #FFD700; color: #121212; border: none; padding: 6px 14px; border-radius: 4px; font-size: 12px; font-weight: bold; cursor: pointer; transition: 0.2s; outline: none;">导出</button>' +
            '</div>';
            
        html += '</div>';
    }
    
    document.getElementById(listId).innerHTML = html;
    if (window.lucide) {
        window.lucide.createIcons();
    }
}

window.downloadStemResult = async function(event, taskId, instr, label) {
    var downloadUrl = SEP_BASE + '/api/separation/download/' + taskId + '/' + instr + '?token=' + encodeURIComponent(window.internalApiToken || '');
    const dialog = window.__TAURI__ ? window.__TAURI__.dialog : null;
    const core = window.__TAURI__ ? window.__TAURI__.core : null;
    
    if (dialog && core) {
        try {
            const savePath = await dialog.save({
                defaultPath: `${label}_${taskId.substring(0, 5)}.wav`,
                filters: [{ name: 'WAV Audio', extensions: ['wav'] }]
            });
            if (!savePath) return;

            const btn = event.target;
            const oldText = btn.innerText;
            btn.innerText = t('sep.writing', "写入中...");
            btn.disabled = true;

            const res = await fetch(SEP_BASE + '/api/separation/save_to_disk', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'X-VocalMap-Token': window.internalApiToken || ''
                },
                body: JSON.stringify({
                    task_id: taskId,
                    stem: instr,
                    save_path: savePath
                })
            });
            const data = await res.json();
            if (data.error) throw new Error(data.error);
            
            btn.innerText = t('sep.write_success', "写入成功");
            setTimeout(() => { btn.innerText = oldText; btn.disabled = false; }, 2000);
        } catch (e) {
            alert(t('sep.write_failed', "下载出错: ") + e.message);
            const btn = event.target;
            btn.innerText = t('sep.write_failed', "下载失败");
            btn.disabled = false;
        }
    } else {
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = `${label}.wav`;
        a.click();
    }
};

window.exportCustomMap = async function(event, taskId, type) {
    const dialog = window.__TAURI__ ? window.__TAURI__.dialog : null;
    const core = window.__TAURI__ ? window.__TAURI__.core : null;
    
    if (!dialog || !core) {
        alert(t('diag.not_desktop', "非桌面端环境，无法使用原生导出"));
        return;
    }
    
    try {
        const ext = type;
        const defaultName = type === 'tmap' ? `Target_${taskId.substring(0, 5)}` : `Original_${taskId.substring(0, 5)}`;
        const savePath = await dialog.save({
            defaultPath: `${defaultName}.${ext}`,
            filters: [{ name: `VocalMap ${ext.toUpperCase()}`, extensions: [ext] }]
        });
        if (!savePath) return;

        const btn = event.target;
        const oldText = btn.innerText;
        btn.innerText = "生成中...";
        btn.disabled = true;

        const endpoint = type === 'tmap' ? '/api/separation/export_tmap' : '/api/separation/export_vmap';

        const res = await fetch(SEP_BASE + endpoint, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'X-VocalMap-Token': window.internalApiToken || ''
            },
            body: JSON.stringify({
                task_id: taskId,
                save_path: savePath
            })
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        
        btn.innerText = "导出成功";
        const msg = type === 'tmap' 
            ? "导出成功！请前往【关卡训练营 -> 自定义靶向特训】导入进行游玩！" 
            : "导出成功！请在主页面点击“导入”进行复盘！";
        alert(msg + "\n" + data[`${ext}_path`]);
        setTimeout(() => { btn.innerText = oldText; btn.disabled = false; }, 3000);
    } catch (e) {
        alert("导出出错: " + e.message);
        const btn = event.target;
        btn.innerText = "导出失败";
        btn.disabled = false;
    }
};

// --- 格式转换舱 (Format Converter) ---
(function initFormatConverter() {
    var zone = document.getElementById('fcDropZone');
    var input = document.getElementById('fcInput');
    var text = document.getElementById('fcText');
    var subText = document.getElementById('fcSubText');
    var icon = document.getElementById('fcIcon');
    var actions = document.getElementById('fcActions');
    var btnTmap = document.getElementById('btnFcTmap');
    var btnVmap = document.getElementById('btnFcVmap');
    
    if (!zone) return;
    
    var currentFile = null;
    
    zone.addEventListener('click', async function() { 
        if (!window.__TAURI__) return document.getElementById('fcInput').click();
        try {
            var selected = await window.__TAURI__.dialog.open({
                filters: [{ name: 'Supported Files', extensions: ['wav', 'mp3', 'flac', 'vmap', 'tmap', 'webm'] }],
                multiple: true
            });
            if (selected) {
                if (!Array.isArray(selected)) selected = [selected];
                let mainFile = null;
                let webmFile = null;
                for (let i = 0; i < selected.length; i++) {
                    let sel = selected[i];
                    let filename = sel.split('\\').pop().split('/').pop();
                    let f = new File([], filename); // Do not read buffer into memory to prevent freeze
                    f.path = sel;
                    if (filename.toLowerCase().endsWith('.webm')) webmFile = f;
                    else mainFile = f;
                }
                if (!mainFile && webmFile) mainFile = webmFile;
                if (mainFile) {
                    mainFile.webmFile = webmFile;
                    handleFcFile(mainFile);
                }
            }
        } catch (e) { console.error(e); }
    });
    zone.addEventListener('dragover', function(e) { e.preventDefault(); zone.style.borderColor = '#FFD700'; });
    zone.addEventListener('dragleave', function() { zone.style.borderColor = 'var(--glass-border)'; });
    
    function processFileList(filesList) {
        let mainFile = null;
        let webmFile = null;
        for (let i = 0; i < filesList.length; i++) {
            let f = filesList[i];
            if (f.name.toLowerCase().endsWith('.webm')) webmFile = f;
            else mainFile = f;
        }
        if (!mainFile && webmFile) mainFile = webmFile;
        if (mainFile) {
            mainFile.webmFile = webmFile;
            handleFcFile(mainFile);
        }
    }
    
    zone.addEventListener('drop', function(e) {
        e.preventDefault(); zone.style.borderColor = 'var(--glass-border)';
        if (e.dataTransfer.files.length > 0) processFileList(e.dataTransfer.files);
    });
    input.addEventListener('change', function(e) {
        if (e.target.files.length > 0) processFileList(e.target.files);
    });
    
    function handleFcFile(file) {
        var name = file.name.toLowerCase();
        var isWav = name.endsWith('.wav') || name.endsWith('.mp3') || name.endsWith('.flac');
        var isVmap = name.endsWith('.vmap');
        var isTmap = name.endsWith('.tmap');
        
        if (!isWav && !isVmap && !isTmap) {
            alert('不支持的文件格式！仅支持 .wav, .vmap, .tmap');
            return;
        }
        
        currentFile = file;
        text.innerText = file.name + (file.webmFile ? ' (+ webm)' : '');
        text.style.color = '#FFD700';
        icon.setAttribute('data-lucide', 'check-circle');
        window.lucide.createIcons();
        
        actions.style.opacity = '1';
        actions.style.pointerEvents = 'auto';
        
        if (isWav) {
            subText.innerText = '已准备就绪，请选择提取目标格式';
            btnTmap.style.display = 'block';
            btnVmap.style.display = 'block';
        } else if (isVmap) {
            subText.innerText = '已检测到 .vmap 文件，可转换为靶向特训块';
            btnTmap.style.display = 'block';
            btnVmap.style.display = 'none';
        } else if (isTmap) {
            subText.innerText = '已检测到 .tmap 文件，可转化为连续复盘线';
            btnTmap.style.display = 'none';
            btnVmap.style.display = 'block';
        }
    }
    
    async function executeConversion(targetFormat) {
        if (!currentFile) return;
        
        var originalText = targetFormat === 'tmap' ? '转换为 .tmap (靶向特训块)' : '转换为 .vmap (连续复盘线)';
        var btn = targetFormat === 'tmap' ? btnTmap : btnVmap;
        
        try {
            var savePath = await window.__TAURI__.dialog.save({
                title: `保存 .${targetFormat} 文件`,
                filters: [{ name: 'VocalMap Data', extensions: [targetFormat] }],
                defaultPath: currentFile.name.replace(/\.[^/.]+$/, "") + `.${targetFormat}`
            });
            
            if (!savePath) return;
            
            btn.innerHTML = `<i data-lucide="loader" class="lucide-icon spin"></i> 正在转换...`;
            window.lucide.createIcons();
            btn.style.pointerEvents = 'none';
            
            var formData = new FormData();
            formData.append('file', currentFile);
            formData.append('target_format', targetFormat);
            formData.append('save_path', savePath);
            if (currentFile.path) formData.append('source_path', currentFile.path);
            if (currentFile.webmFile) {
                formData.append('webm_file', currentFile.webmFile);
                if (currentFile.webmFile.path) formData.append('webm_source_path', currentFile.webmFile.path);
            }
            
            var res = await fetch(window.SEP_BASE + '/api/convert/process', {
                method: 'POST',
                body: formData,
                headers: {
                    'X-VocalMap-Token': window.internalApiToken || ''
                }
            });
            var json = await res.json();
            
            if (json.status === 'success') {
                if (window.toast) {
                    window.toast(`格式转换成功！`, 'success');
                } else {
                    alert('格式转换成功！\n保存路径: ' + savePath);
                }
                
                currentFile = null;
                text.innerText = '点击或拖拽文件到此处';
                text.style.color = 'var(--text-main)';
                subText.innerText = '.vmap | .tmap | .wav';
                actions.style.opacity = '0.5';
                actions.style.pointerEvents = 'none';
                icon.setAttribute('data-lucide', 'file-up');
                window.lucide.createIcons();
            } else {
                throw new Error(json.error || '未知错误');
            }
            
        } catch (e) {
            if (window.toast) {
                window.toast('转换失败: ' + e.message, 'error');
            } else {
                alert('转换失败: ' + e.message);
            }
        } finally {
            btn.innerText = originalText;
            btn.style.pointerEvents = 'auto';
        }
    }
    
    btnTmap.addEventListener('click', function() { executeConversion('tmap'); });
    btnVmap.addEventListener('click', function() { executeConversion('vmap'); });

})();
