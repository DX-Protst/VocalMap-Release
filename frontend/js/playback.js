// ==========================================
// VocalMap Playback & Recording Monitor
// ==========================================

const btnToggleRecord = document.getElementById('btnToggleRecord');
const playbackControls = document.getElementById('playbackControls');
const btnPlayPause = document.getElementById('btnPlayPause');
const playbackSlider = document.getElementById('playbackSlider');
const playbackTime = document.getElementById('playbackTime');
const btnExportRecord = document.getElementById('btnExportRecord');
const btnImportRecord = document.getElementById('btnImportRecord');
const importRecordFile = document.getElementById('importRecordFile');
const btnClosePlayback = document.getElementById('btnClosePlayback');
const recordStatusText = document.getElementById('recordStatusText');
const pitchTooltip = document.getElementById('pitchTooltip');

function updatePlaybackSlider() {
    playbackSlider.max = recordedPitchData.length - 1;
    playbackSlider.value = playbackCurrentIndex;
    if (recordedPitchData.length > 0) {
        let t = recordedPitchData[playbackCurrentIndex].time / 1000;
        let total = recordedPitchData[recordedPitchData.length - 1].time / 1000;
        playbackTime.innerText = `${t.toFixed(1)}s / ${total.toFixed(1)}s`;
    }
}

function startPlaybackMode() {
    if (recordedPitchData.length === 0) return;
    isPlayingBack = true;
    playbackCurrentIndex = 0;
    playbackControls.style.display = 'flex';
    btnToggleRecord.style.display = 'none';
    if (recordStatusText) recordStatusText.style.display = 'none';
    updatePlaybackSlider();
    drawPlaybackCanvas();
}

function stopPlaybackMode() {
    isPlayingBack = false;
    playbackControls.style.display = 'none';
    btnToggleRecord.style.display = 'block';
    
    playbackAudio.pause();
    playbackAudio.currentTime = 0;

    if (pitchTooltip) pitchTooltip.style.display = 'none';
    if (pitchCtx) {
        pitchCtx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        drawPitchBackground();
    }
}

if (btnToggleRecord) {
    btnToggleRecord.addEventListener('click', () => {
        if (!isRunning && !isRecordingMonitor) {
            if (typeof showToast === 'function') {
                showToast(t('monitor.record_engine_warning_title', "引擎未就绪"), t('monitor.record_engine_warning', "请先启动右上角声学引擎，建立麦克风桥接后再开启录制！"), "warning");
            } else {
                alert(t('monitor.engine_unready_alert', "请先启动引擎后再开始录制！"));
            }
            return;
        }
        if (!isRecordingMonitor) {
            isRecordingMonitor = true;
            recordedPitchData = [];
            monitorRecordStartTime = performance.now();
             btnToggleRecord.innerHTML = t('monitor.record_start', '<i data-lucide="square" class="lucide-icon"></i> 停止监视录制');
             lucide.createIcons();
            if (recordStatusText) recordStatusText.style.display = 'block';
            playbackControls.style.display = 'none';
            isPlayingBack = false;
            
            let stream = microphone.mediaStream;
            audioChunks = [];
            mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
            mediaRecorder.ondataavailable = e => {
                if (e.data.size > 0) audioChunks.push(e.data);
            };
            mediaRecorder.onstop = () => {
                recordedAudioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                if (recordedPitchData.length > 0) {
                    playbackAudio.src = URL.createObjectURL(recordedAudioBlob);
                    startPlaybackMode();
                }
            };
            mediaRecorder.start();
        } else {
            isRecordingMonitor = false;
              btnToggleRecord.innerHTML = t('monitor.record_stop', '<i data-lucide="circle-dot" class="lucide-icon"></i> 开始监视录制');
              lucide.createIcons();
            if (recordStatusText) recordStatusText.style.display = 'none';
            if (mediaRecorder && mediaRecorder.state !== 'inactive') {
                mediaRecorder.stop();
            }
        }
    });
}

if (btnClosePlayback) {
    btnClosePlayback.addEventListener('click', () => {
        stopPlaybackMode();
    });
}

function playbackLoop() {
    if (!isPlayingBack || playbackAudio.paused) return;
    
    let targetTimeMs = playbackAudio.currentTime * 1000;
    
    let idx = recordedPitchData.findIndex(d => d.time >= targetTimeMs);
    if (idx === -1) idx = recordedPitchData.length - 1;
    if (idx < 0) idx = 0;
    
    playbackCurrentIndex = idx;
    updatePlaybackSlider();
    drawPlaybackCanvas();
    
    requestAnimationFrame(playbackLoop);
}

playbackAudio.addEventListener('play', () => {
    btnPlayPause.innerHTML = t('monitor.playback_pause', '<i data-lucide="pause" class="lucide-icon"></i> 暂停');
    lucide.createIcons();
    requestAnimationFrame(playbackLoop);
});

playbackAudio.addEventListener('pause', () => {
    btnPlayPause.innerHTML = t('monitor.playback_play', '<i data-lucide="play" class="lucide-icon"></i> 播放');
    lucide.createIcons();
});

playbackAudio.addEventListener('ended', () => {
    btnPlayPause.innerHTML = t('monitor.playback_play', '<i data-lucide="play" class="lucide-icon"></i> 播放');
    lucide.createIcons();
    playbackAudio.currentTime = 0;
    playbackCurrentIndex = 0;
    updatePlaybackSlider();
    drawPlaybackCanvas();
});

if (btnPlayPause) {
    btnPlayPause.addEventListener('click', () => {
        if (!playbackAudio.paused) {
            playbackAudio.pause();
        } else {
            playbackAudio.play();
        }
    });
}

if (playbackSlider) {
    playbackSlider.addEventListener('input', (e) => {
        playbackCurrentIndex = parseInt(e.target.value);
        let targetTimeMs = recordedPitchData[playbackCurrentIndex].time;
        playbackAudio.currentTime = targetTimeMs / 1000;
        updatePlaybackSlider();
        drawPlaybackCanvas();
    });
}

if (btnExportRecord) {
    btnExportRecord.addEventListener('click', async () => {
        if (recordedPitchData.length === 0 || !recordedAudioBlob) {
            if (typeof showToast === 'function') {
                showToast(t('diag.prompt', "提示"), t('monitor.no_record_data', "暂无完整的录制数据"), "warning");
            } else {
                alert(t('monitor.no_record_data', "暂无完整的录制数据"));
            }
            return;
        }
        
        const dialog = window.__TAURI__ ? window.__TAURI__.dialog : null;
        const core = window.__TAURI__ ? window.__TAURI__.core : null;
        
        if (!dialog || !core) {
            alert(t('diag.not_desktop', "非桌面端环境，无法使用原生导出"));
            return;
        }
        
        try {
            const savePath = await dialog.save({
                filters: [{ name: 'VocalMap Record', extensions: ['vmap'] }]
            });
            
            if (savePath) {
                const arrayBuffer = await recordedAudioBlob.arrayBuffer();
                const uint8Array = new Uint8Array(arrayBuffer);
                
                const fs = window.__TAURI__.fs;
                const webmPath = savePath.replace(/\.vmap$/, '') + '.webm';
                
                // Write text data
                await fs.writeTextFile(savePath, JSON.stringify(recordedPitchData));
                
                // Write binary data directly to avoid IPC JSON serialization
                await fs.writeFile(webmPath, uint8Array);
                
                alert(t('diag.export_vmap_success', "导出成功！已保存:\n") + `${savePath}\n${webmPath}`);
            }
        } catch (err) {
            alert(t('monitor.export_failed', "导出失败: ") + err);
        }
    });
}

if (btnImportRecord) {
    btnImportRecord.addEventListener('click', async () => {
        const dialog = window.__TAURI__ ? window.__TAURI__.dialog : null;
        const fs = window.__TAURI__ ? window.__TAURI__.fs : null;
        const core = window.__TAURI__ ? window.__TAURI__.core : null;
        
        if (!dialog || !core || !fs) {
            alert(t('diag.not_desktop', "非桌面端环境，无法使用原生导入"));
            return;
        }
        
        try {
            const filePath = await dialog.open({
                multiple: false,
                filters: [{ name: 'VocalMap Record', extensions: ['vmap'] }]
            });
            
            if (filePath) {
                const content = await fs.readTextFile(filePath);
                let parsed = JSON.parse(content);
                if (parsed && parsed.timeline) {
                    recordedPitchData = parsed.timeline;
                } else if (parsed && parsed.data && parsed.data.timeline) {
                    recordedPitchData = parsed.data.timeline;
                } else {
                    recordedPitchData = parsed;
                }
                
                const webmPath = filePath.replace(/\.vmap$/, '') + '.webm';
                try {
                    const uint8Array = await fs.readFile(webmPath);
                    const blob = new Blob([uint8Array], { type: 'audio/webm' });
                    playbackAudio.src = URL.createObjectURL(blob);
                } catch(e) { console.warn("No webm found for vmap", e); }
                
                if (Array.isArray(recordedPitchData) && recordedPitchData.length > 0) {
                    startPlaybackMode();
                }
            }
        } catch (err) {
            alert(t('monitor.import_failed', "导入失败或缺少音频文件: ") + err);
        }
    });
}

function drawPlaybackCanvas() {
    if (!isPlayingBack || !pitchCtx) return;
    let centerPitch = recordedPitchData[playbackCurrentIndex].pitch;
    
    if (centerPitch > 0) {
        let currentMidi = hzToMidi(centerPitch);
        let margin = 3;
        let topBoundary = viewCenterMidi + VIEW_RANGE / 2 - margin;
        let bottomBoundary = viewCenterMidi - VIEW_RANGE / 2 + margin;
        if (currentMidi > topBoundary) {
            targetCenterMidi = currentMidi - VIEW_RANGE / 2 + margin;
        } else if (currentMidi < bottomBoundary) {
            targetCenterMidi = currentMidi + VIEW_RANGE / 2 - margin;
        }
    }
    viewCenterMidi += (targetCenterMidi - viewCenterMidi) * 0.2; 
    
    drawPitchBackground();
    
    let HALF_HISTORY = Math.floor((CANVAS_WIDTH / 2) / SCROLL_SPEED);
    
    pitchCtx.beginPath();
    let isDrawing = false;
    let prevX = 0, prevY = 0;
    
    let gradient = pitchCtx.createLinearGradient(0, 0, CANVAS_WIDTH, 0);
    gradient.addColorStop(0, '#00E5FF');
    gradient.addColorStop(0.5, '#c084fc');
    gradient.addColorStop(1, '#00E5FF');
    
    pitchCtx.shadowBlur = 15;
    pitchCtx.shadowColor = 'rgba(192, 132, 252, 0.8)';
    pitchCtx.strokeStyle = gradient;
    pitchCtx.lineWidth = 4;
    pitchCtx.lineCap = 'round';
    pitchCtx.lineJoin = 'round';

    for (let i = playbackCurrentIndex - HALF_HISTORY; i <= playbackCurrentIndex + HALF_HISTORY; i++) {
        if (i >= 0 && i < recordedPitchData.length) {
            let p = recordedPitchData[i].pitch;
            if (p > 0) {
                let x = CANVAS_WIDTH / 2 + (i - playbackCurrentIndex) * SCROLL_SPEED;
                let y = getYFromMidi(hzToMidi(p));
                
                if (!isDrawing) {
                    pitchCtx.moveTo(x, y);
                    isDrawing = true;
                } else {
                    let prevP = i > 0 ? recordedPitchData[i - 1].pitch : -1;
                    if (prevP > 0 && Math.abs(hzToMidi(p) - hzToMidi(prevP)) > 12) {
                        pitchCtx.moveTo(x, y); 
                    } else {
                        let cpX = (prevX + x) / 2;
                        pitchCtx.quadraticCurveTo(cpX, prevY, x, y);
                    }
                }
                prevX = x; prevY = y;
            } else {
                isDrawing = false;
            }
        } else {
            isDrawing = false;
        }
    }
    pitchCtx.stroke();
    pitchCtx.shadowBlur = 0;
    
    let cx = CANVAS_WIDTH / 2;
    pitchCtx.beginPath();
    pitchCtx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    pitchCtx.lineWidth = 1;
    pitchCtx.moveTo(cx, 0);
    pitchCtx.lineTo(cx, CANVAS_HEIGHT);
    pitchCtx.stroke();
    
    if (centerPitch > 0) {
        let cy = getYFromMidi(hzToMidi(centerPitch));
        pitchCtx.shadowBlur = 25;
        pitchCtx.shadowColor = '#FFFFFF';
        pitchCtx.fillStyle = '#FFFFFF';
        pitchCtx.beginPath();
        pitchCtx.arc(cx, cy, 6, 0, Math.PI * 2);
        pitchCtx.fill();
        pitchCtx.shadowBlur = 0;
    }
    
    if (hoverPlaybackIndex >= 0 && hoverPlaybackIndex < recordedPitchData.length) {
        let hp = recordedPitchData[hoverPlaybackIndex].pitch;
        if (hp > 0) {
            let hx = cx + (hoverPlaybackIndex - playbackCurrentIndex) * SCROLL_SPEED;
            let hy = getYFromMidi(hzToMidi(hp));
            
            pitchCtx.beginPath();
            pitchCtx.strokeStyle = 'rgba(0, 229, 255, 0.6)';
            pitchCtx.lineWidth = 1;
            pitchCtx.setLineDash([4, 4]);
            pitchCtx.moveTo(hx, 0);
            pitchCtx.lineTo(hx, CANVAS_HEIGHT);
            pitchCtx.stroke();
            pitchCtx.setLineDash([]);
            
            pitchCtx.fillStyle = '#00FFF5';
            pitchCtx.beginPath();
            pitchCtx.arc(hx, hy, 4, 0, Math.PI * 2);
            pitchCtx.fill();
            
            let m = Math.round(hzToMidi(hp));
            const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
            let noteStr = noteNames[(m % 12 + 12) % 12] + (Math.floor(m / 12) - 1);
            
            if (pitchTooltip) {
                pitchTooltip.innerText = `${noteStr} (${hp.toFixed(1)}Hz)`;
                pitchTooltip.style.left = (hx + 10) + 'px';
                pitchTooltip.style.top = (hy - 30) + 'px';
                pitchTooltip.style.display = 'block';
            }
        } else {
            if (pitchTooltip) pitchTooltip.style.display = 'none';
        }
    } else {
        if (pitchTooltip) pitchTooltip.style.display = 'none';
    }
}

if (pitchCanvas) {
    pitchCanvas.addEventListener('mousemove', (e) => {
        if (!isPlayingBack || recordedPitchData.length === 0) return;
        const rect = pitchCanvas.getBoundingClientRect();
        const scaleX = CANVAS_WIDTH / rect.width;
        const x = (e.clientX - rect.left) * scaleX;
        let offsetIdx = Math.round((x - CANVAS_WIDTH / 2) / SCROLL_SPEED);
        hoverPlaybackIndex = playbackCurrentIndex + offsetIdx;
        drawPlaybackCanvas();
    });

    pitchCanvas.addEventListener('mouseleave', () => {
        if (isPlayingBack) {
            hoverPlaybackIndex = -1;
            drawPlaybackCanvas();
            if (pitchTooltip) pitchTooltip.style.display = 'none';
        }
    });
}
