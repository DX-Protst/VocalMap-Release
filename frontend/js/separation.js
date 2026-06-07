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
                <h2 style="margin-top:0;color:var(--primary-cyan);">初始化 AI 分离引擎</h2>
                <p style="color:var(--text-muted);font-size:14px;line-height:1.6;margin-bottom:20px;">
                    首次使用音轨分离功能需要下载运行环境及模型权重。<br>
                    这包含 PyTorch、CUDA 加速库以及两个高性能模型（总计约 5GB）。<br>
                    下载时间取决于您的网速，请保持网络畅通。
                </p>
                <div id="dlProgressContainer" style="display:none;margin-bottom:20px;">
                    <div style="width:100%;height:8px;background:var(--glass-border);border-radius:4px;overflow:hidden;">
                        <div id="dlProgressBar" style="width:0%;height:100%;background:var(--primary-cyan);transition:width 0.3s;"></div>
                    </div>
                    <p id="dlProgressText" style="color:var(--primary-cyan);font-size:13px;margin-top:10px;">准备下载...</p>
                </div>
                <div id="dlConsole" style="display:none; width:100%; height:180px; background:rgba(0,0,0,0.5); border:1px solid var(--glass-border); border-radius:6px; margin-bottom:20px; overflow-y:auto; text-align:left; padding:10px; font-family:'JetBrains Mono', monospace; font-size:11px; color:#a399b5; box-sizing:border-box;"></div>
                <button id="btnStartEnvDl" style="background:var(--primary-cyan);color:#121212;border:none;padding:12px 30px;border-radius:6px;font-size:15px;cursor:pointer;font-weight:bold;transition:0.2s;">
                    🚀 立即开始下载 (5GB)
                </button>
                <button id="btnCancelEnvDl" style="background:transparent;color:var(--text-muted);border:none;margin-top:15px;cursor:pointer;font-size:13px;">
                    以后再说，返回主界面
                </button>
            </div>
        `;
        document.body.appendChild(overlay);

        document.getElementById('btnCancelEnvDl').onclick = () => {
            overlay.style.display = 'none';
            document.getElementById('btnStartEnvDl').style.display = 'inline-block';
            document.getElementById('btnCancelEnvDl').innerText = '以后再说，返回主界面';
            document.getElementById('dlProgressContainer').style.display = 'none';
            document.getElementById('dlProgressBar').style.width = '0%';
            document.getElementById('dlProgressText').innerText = '准备下载...';
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
                    document.getElementById('dlProgressText').innerText = '✅ 下载部署完成！正在进入系统...';
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
                document.getElementById('dlProgressText').innerText = '❌ 下载失败: ' + error;
                document.getElementById('dlProgressText').style.color = 'var(--primary-red)';
                document.getElementById('dlProgressBar').style.background = 'var(--primary-red)';
                document.getElementById('btnCancelEnvDl').style.display = 'inline-block';
                document.getElementById('btnCancelEnvDl').innerText = '关闭并重试';
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
    var zone = document.getElementById('sepInstUploadZone');
    if (zone) {
        zone.innerHTML = '<i data-lucide="folder-open" style="width: 36px; height: 36px; stroke-width: 1.5px; margin: 0 auto 12px; color: var(--primary-cyan); display: block;"></i>' +
            '<p style="color: var(--text-main); margin: 3px 0; font-size: 14px; font-weight: bold;">点击或拖拽上传音频</p>' +
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
    var zone = document.getElementById('sepVocUploadZone');
    if (zone) {
        zone.innerHTML = '<i data-lucide="music" style="width: 36px; height: 36px; stroke-width: 1.5px; margin: 0 auto 12px; color: var(--primary-purple); display: block;"></i>' +
            '<p style="color: var(--text-main); margin: 3px 0; font-size: 14px; font-weight: bold;">点击或拖拽上传音频</p>' +
            '<p style="color: var(--text-muted); font-size: 11px;">WAV / MP3 / FLAC</p>';
        if (window.lucide) window.lucide.createIcons();
    }
}

// 通用分离逻辑
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
    document.getElementById(progId).innerText = forceCPU ? 'CPU 处理中...' : '上传并推理中...';

    var formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('model_key', modelKey);
    formData.append('force_cpu', forceCPU ? 'true' : 'false');

    try {
        var resp = await fetch(SEP_BASE + '/api/separation/separate', {
            method: 'POST',
            body: formData
        });
        var data = await resp.json();
        if (data.error) {
            alert('分离失败: ' + data.error);
            if (panelType === 'inst') resetInstUI(); else resetVocUI();
            return;
        }
        var taskId = data.task_id;
        document.getElementById(progId).innerText = '模型推理中，请耐心等待...';
        pollSepTask(taskId, panelType);
    } catch (err) {
        alert('请求失败: ' + err.message);
        if (panelType === 'inst') resetInstUI(); else resetVocUI();
    }
}

async function pollSepTask(taskId, panelType) {
    var progId = panelType === 'inst' ? 'sepInstProgress' : 'sepVocProgress';
    try {
        var resp = await fetch(SEP_BASE + '/api/separation/task/' + taskId);
        var task = await resp.json();
        if (task.status === 'completed') {
            showSepResults(taskId, task, panelType);
            return;
        } else if (task.status === 'error') {
            alert('分离出错: ' + (task.error || '未知错误'));
            if (panelType === 'inst') resetInstUI(); else resetVocUI();
            return;
        } else {
            if (task.progress !== undefined && task.progress > 0) {
                document.getElementById(progId).innerText = '模型推理中，进度: ' + task.progress + '% ...';
            } else {
                if (task.status_text) {
                    document.getElementById(progId).innerText = task.status_text;
                } else {
                    document.getElementById(progId).innerText = '模型初始化中，请稍候...';
                }
            }
        }
    } catch (err) {
        console.error('轮询失败:', err);
    }
    setTimeout(function() { pollSepTask(taskId, panelType); }, 1500);
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
            'bass': '贝斯', 'drums': '鼓组', 'vocals': '人声',
            'other': '其他', 'guitar': '吉他', 'piano': '钢琴',
            'instrumental': '纯伴奏'
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
        labels = { 'vocals': '伴奏与和声', 'instrumental': '人声' };
        colors = { 'vocals': '#CE93D8', 'instrumental': '#00FFF5' };
        icons = { 'vocals': 'music', 'instrumental': 'mic' };
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
            '<button onclick="window.downloadStemResult(event, \'' + taskId + '\', \'' + instr + '\', \'' + label + '\')" style="background: ' + color + '; color: #121212; border: none; padding: 4px 12px; border-radius: 3px; font-size: 11px; font-weight: bold; cursor: pointer; transition: 0.2s; outline: none;">下载 WAV</button>' +
            '</div>';
    }
    document.getElementById(listId).innerHTML = html;
    if (window.lucide) {
        window.lucide.createIcons();
    }
}

window.downloadStemResult = async function(event, taskId, instr, label) {
    var downloadUrl = SEP_BASE + '/api/separation/download/' + taskId + '/' + instr;
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
            btn.innerText = "写入中...";
            btn.disabled = true;

            const res = await fetch(SEP_BASE + '/api/separation/save_to_disk', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    task_id: taskId,
                    stem: instr,
                    save_path: savePath
                })
            });
            const data = await res.json();
            if (data.error) throw new Error(data.error);
            
            btn.innerText = "写入成功";
            setTimeout(() => { btn.innerText = oldText; btn.disabled = false; }, 2000);
        } catch (e) {
            alert("下载出错: " + e.message);
            const btn = event.target;
            btn.innerText = "下载失败";
            btn.disabled = false;
        }
    } else {
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = `${label}.wav`;
        a.click();
    }
};
