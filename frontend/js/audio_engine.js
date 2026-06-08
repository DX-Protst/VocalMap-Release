// ==========================================
// VocalMap Audio Engine Logic
// ==========================================

async function initMicrophoneSelect() {
    const select = document.getElementById('selectMicrophone');
    if (!select) return;
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devices.filter(device => device.kind === 'audioinput');
        
        // Save current selection if possible
        const currentVal = select.value;
        const savedDeviceId = localStorage.getItem('vocalmap_microphone') || currentVal;
        
        select.innerHTML = '';
        const defaultOption = document.createElement('option');
        defaultOption.value = 'default';
        defaultOption.text = t('audio.default_device', '系统默认设备 (Default)');
        select.appendChild(defaultOption);
        
        audioInputs.forEach(device => {
            if (device.deviceId === 'default' || device.deviceId === 'communications') return;
            const option = document.createElement('option');
            option.value = device.deviceId;
            option.text = device.label || `${t('audio.mic_label', '麦克风')} (${device.deviceId.substring(0,5)}...)`;
            if (device.deviceId === savedDeviceId) {
                option.selected = true;
            }
            select.appendChild(option);
        });
        
        select.onchange = () => {
            localStorage.setItem('vocalmap_microphone', select.value);
        };
        
    } catch (e) {
        console.error("无法枚举麦克风", e);
        if (select.options.length === 0) {
            select.innerHTML = '<option value="default">' + t('audio.no_devices', '无法获取设备列表') + '</option>';
        }
    }
}

async function checkEnvironment() {
    try {
        let hasVCRedist = await invoke('check_vcredist');
        if (!hasVCRedist) {
            alert(t('audio.vc_redist_warning', "⚠️ 严重环境缺失：\n\n检测到您的系统未安装微软 C++ 运行库 (VC++ 2015-2022 Redistributable)。\n\nVocalMap 的音频核心需要此底层环境才能运行。\n\n点击【确定】将自动为您打开微软官方下载链接，请下载并安装 x64 版本后，重新启动本软件！"));
            await open("https://aka.ms/vs/17/release/vc_redist.x64.exe");
            return false;
        }
    } catch (e) {
        console.warn("检查环境失败", e);
    }
    return true;
}

async function startEngine() {
    let envOk = await checkEnvironment();
    if (!envOk) return;

    try {
        const wsUrl = LOCAL_API_BASE.replace('http://', 'ws://') + '/ws?token=' + encodeURIComponent(window.internalApiToken || '');
        ws = new WebSocket(wsUrl);
        
        ws.onopen = async () => {
            wsStatus.innerText = t('audio.backend_connected', "连接状态: 已连接"); wsStatus.style.color = "#00ADB5";
            try {
                let baseConstraints = {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false
                };
                let audioConstraints = { ...baseConstraints };
                const savedDeviceId = localStorage.getItem('vocalmap_microphone');
                if (savedDeviceId && savedDeviceId !== 'default') {
                    audioConstraints.deviceId = { exact: savedDeviceId };
                }
                
                let stream;
                try {
                    stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: false });
                } catch (err) {
                    console.warn("使用指定麦克风失败，回退到默认设备", err);
                    stream = await navigator.mediaDevices.getUserMedia({ audio: baseConstraints, video: false });
                }
                
                initMicrophoneSelect(); // Update labels after permission granted
                
                audioContext = new (window.AudioContext || window.webkitAudioContext)({sampleRate: 44100});
                microphone = audioContext.createMediaStreamSource(stream);
                processor = audioContext.createScriptProcessor(2048, 1, 1);
                processor.onaudioprocess = (e) => {
                    if (!isRunning || ws.readyState !== WebSocket.OPEN) return;
                    let float32Array = e.inputBuffer.getChannelData(0);
                    let int16Array = new Int16Array(float32Array.length);
                    for (let i = 0; i < float32Array.length; i++) {
                        let s = Math.max(-1, Math.min(1, float32Array[i]));
                        int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
                    }
                    ws.send(int16Array.buffer);
                };
                microphone.connect(processor);
                processor.connect(audioContext.destination);
                isRunning = true;
                if (typeof renderLoop === 'function' && !isRenderLoopRunning) {
                    isRenderLoopRunning = true;
                    renderLoop();
                }
                if (typeof sendSettings === 'function') sendSettings();
                startBtn.innerHTML = t('audio.stop_engine', '<i data-lucide="square" class="lucide-icon"></i> 停止引擎 / Stop');
                lucide.createIcons();
                startBtn.className = "btn-danger";
                startBtn.style.backgroundColor = ""; // Clear any lingering inline styles
            } catch (err) {
                console.error('麦克风访问失败:', err);
                if (typeof showToast === 'function') {
                    showToast(t('audio.mic_access_failed_title', "麦克风访问失败"), t('audio.mic_access_failed_msg', "无法访问您的音频输入设备: ") + err.name + "。请确认 Windows 麦克风隐私授权已开启！", "error");
                } else {
                    alert(t('audio.mic_access_failed_alert', "无法访问麦克风: ") + err.name + " - " + err.message);
                }
                ws.close();
            }
        };
        
        ws.onmessage = (event) => {
            handleBackendData(JSON.parse(event.data));
        };
        
        ws.onclose = () => {
            stopEngine();
        };
        
    } catch (err) { 
        console.error('引擎启动失败:', err); 
        if (typeof showToast === 'function') {
            showToast(t('audio.engine_start_failed_title', "引擎启动失败"), t('audio.engine_start_failed_msg', "无法连接麦克风或后端分析引擎，请检查后端服务是否正在运行！"), "error");
        } else {
            alert(t('audio.engine_start_failed_msg', "无法连接麦克风或后端引擎，请检查设置。"));
        }
    }
}

function stopEngine() {
    isRunning = false;

    if (typeof exitTraining === 'function' && typeof activeTrainingSequence !== 'undefined' && activeTrainingSequence !== null) {
        exitTraining();
        if (typeof showToast === 'function') {
            showToast(t('audio.training_terminated_title', "训练已终止"), t('audio.training_terminated_msg', "后端引擎已断开，当前训练被强制终止。"), "warning");
        }
    }

    if (processor) processor.disconnect();
    if (microphone) microphone.disconnect();
    if (audioContext) audioContext.close();
    if (ws) ws.close();
    
    startBtn.innerHTML = t('audio.start_engine', '<i data-lucide="zap" class="lucide-icon"></i> 启动引擎'); 
    lucide.createIcons();
    startBtn.className = "btn-cyan";
    startBtn.style.backgroundColor = ""; // Clear inline styles
    
    pitchHistory.fill(-1); 
    pitchCtx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    drawPitchBackground();
    
    textBuffer = { loud: [], bright: [], pure: [], stab: [], dev: [], vibrato: [] };
    silentFrames = 0;
    
    const valPitchEl = document.getElementById('valPitch');
    if (valPitchEl) {
        valPitchEl.innerText = '--';
        valPitchEl.style.color = '#555';
        document.getElementById('descPitch').innerText = t('monitor.waiting', "等待发声...");
    }
    wsStatus.innerText = t('audio.backend_disconnected', "连接状态: 已断开"); wsStatus.style.color = "#E23E57";
}

startBtn.addEventListener('click', () => isRunning ? stopEngine() : startEngine());

// Initialize microphone list on startup
initMicrophoneSelect();

// Listen to language changes to update wsStatus and startBtn texts dynamically
window.addEventListener('languagechanged', () => {
    if (wsStatus) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            wsStatus.innerText = t('audio.backend_connected', "连接状态: 已连接");
            wsStatus.style.color = "#00ADB5";
        } else {
            wsStatus.innerText = t('audio.backend_disconnected', "连接状态: 已断开");
            wsStatus.style.color = "#E23E57";
        }
    }
    if (startBtn) {
        if (isRunning) {
            startBtn.innerHTML = t('audio.stop_engine', '<i data-lucide="square" class="lucide-icon"></i> 停止引擎 / Stop');
        } else {
            startBtn.innerHTML = t('audio.start_engine', '<i data-lucide="zap" class="lucide-icon"></i> 启动引擎');
        }
        if (window.lucide) {
            window.lucide.createIcons();
        }
    }
});
