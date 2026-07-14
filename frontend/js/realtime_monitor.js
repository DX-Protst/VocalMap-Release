// ==========================================
// VocalMap Realtime Monitor & Drawing Logic
// ==========================================

function hzToMidi(hz) { return 69 + 12 * Math.log2(hz / 440); }
function midiToHz(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }
function getYFromMidi(midi) {
    let normalized = (midi - (viewCenterMidi - VIEW_RANGE / 2)) / VIEW_RANGE;
    return CANVAS_HEIGHT - normalized * CANVAS_HEIGHT; 
}

// 缓存背景层以提升性能
let bgCanvasCache = document.createElement('canvas');
bgCanvasCache.width = CANVAS_WIDTH;
bgCanvasCache.height = CANVAS_HEIGHT;
let bgCtxCache = bgCanvasCache.getContext('2d');
let lastRenderedViewCenterMidi = null;
let lastRenderedTheme = null;

let textBufferSum = { loud: 0, bright: 0, pure: 0, stab: 0, dev: 0, vibrato: 0 };

function getActiveCtx() {
    if (typeof activeTrainingSequence !== 'undefined' && activeTrainingSequence !== null) {
        const tCanvas = document.getElementById('trainingPitchCanvas');
        if (tCanvas) return tCanvas.getContext('2d');
    }
    return pitchCtx;
}

function getActivePrefix() {
    return (typeof activeTrainingSequence !== 'undefined' && activeTrainingSequence !== null) ? 'train' : '';
}

function drawPitchBackground() {
    let ctx = getActiveCtx();
    if (!ctx) return;

    // Reset shadowBlur before clearing and drawing to prevent performance lag, tiling, and flickering
    ctx.shadowBlur = 0;

    let targetCtx = ctx;
    let isPerfMode = typeof performanceMode !== 'undefined' && performanceMode;
    let isTraining = typeof activeTrainingSequence !== 'undefined' && activeTrainingSequence !== null;
    
    let canvasW = ctx.canvas.width;
    let canvasH = ctx.canvas.height;

    // Use offscreen canvas for all background grid drawing to avoid flickering
    targetCtx = bgCtxCache;
    let cacheW = CANVAS_WIDTH;
    let cacheH = CANVAS_HEIGHT;

    // Also reset targetCtx shadowBlur to be safe
    targetCtx.shadowBlur = 0;

    if (!isTraining && lastRenderedViewCenterMidi === viewCenterMidi && lastRenderedTheme === isLightMode) {
        ctx.clearRect(0, 0, canvasW, canvasH);
        ctx.drawImage(bgCanvasCache, 0, 0, cacheW, cacheH, 0, 0, canvasW, canvasH);
        return;
    }

    targetCtx.clearRect(0, 0, cacheW, cacheH);
    const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    
    // getYFromMidi 适配动态高度
    const getLocalY = (midi) => {
        let normalized = (midi - (viewCenterMidi - VIEW_RANGE / 2)) / VIEW_RANGE;
        return cacheH - normalized * cacheH; 
    };
    
    let rowHeight = cacheH / VIEW_RANGE; 
    let minMidi = Math.floor(viewCenterMidi - VIEW_RANGE / 2) - 2;
    let maxMidi = Math.ceil(viewCenterMidi + VIEW_RANGE / 2) + 2;

    for (let m = minMidi; m <= maxMidi; m++) {
        let noteName = noteNames[(m % 12 + 12) % 12]; 
        let y = getLocalY(m);
        let isBlackKey = noteName.includes('#');
        let octave = Math.floor(m / 12) - 1;

        if (isBlackKey) {
            targetCtx.fillStyle = isLightMode ? 'rgba(15, 23, 42, 0.04)' : 'rgba(255, 255, 255, 0.04)';
            targetCtx.fillRect(0, y - rowHeight / 2, cacheW, rowHeight);
        }

        targetCtx.beginPath();
        if (noteName === "C") {
            targetCtx.strokeStyle = isLightMode ? 'rgba(2, 132, 199, 0.6)' : 'rgba(0, 173, 181, 0.4)';
            targetCtx.lineWidth = 1.5;
            targetCtx.moveTo(0, y); targetCtx.lineTo(cacheW, y);
            targetCtx.fillStyle = isLightMode ? 'rgba(2, 132, 199, 1)' : 'rgba(0, 173, 181, 0.9)';
            targetCtx.font = 'bold 12px monospace';
            targetCtx.fillText(`C${octave}`, 5, y - 4);
        } else if (!isBlackKey) {
            targetCtx.strokeStyle = isLightMode ? 'rgba(15, 23, 42, 0.1)' : 'rgba(255, 255, 255, 0.25)';
            targetCtx.lineWidth = 1;
            targetCtx.moveTo(0, y); targetCtx.lineTo(cacheW, y);
            targetCtx.fillStyle = isLightMode ? 'rgba(15, 23, 42, 0.4)' : 'rgba(255, 255, 255, 0.7)';
            targetCtx.font = '10px monospace';
            targetCtx.fillText(`${noteName}${octave}`, 5, y - 2);
        } else {
            targetCtx.strokeStyle = isLightMode ? 'rgba(15, 23, 42, 0.02)' : 'rgba(255, 255, 255, 0.08)';
            targetCtx.lineWidth = 1;
            targetCtx.moveTo(0, y); targetCtx.lineTo(cacheW, y);
        }
        targetCtx.stroke();
    }

    if (!isTraining) {
        lastRenderedViewCenterMidi = viewCenterMidi;
        lastRenderedTheme = isLightMode;
    }
    
    // Copy the rendered grid to the main canvas
    ctx.clearRect(0, 0, canvasW, canvasH);
    ctx.drawImage(bgCanvasCache, 0, 0, cacheW, cacheH, 0, 0, canvasW, canvasH);
}

function updateGaugeCSS(id, percent, color, valText) {
    let prefix = getActivePrefix();
    const ring = document.getElementById(`${prefix}Ring${id}`) || document.getElementById(`ring${id}`);
    if (ring) {
        ring.style.setProperty('--p', `${percent}%`);
        ring.style.setProperty('--c', color);
    }
    const valEl = document.getElementById(`${prefix}Val${id}`) || document.getElementById(`val${id}`);
    if (valEl) {
        valEl.innerText = valText;
        valEl.style.color = color;
    }
}

function updateBipolarGaugeCSS(id, deviation, color, valText) {
    let prefix = getActivePrefix();
    const barFill = document.getElementById(`${prefix}BarFill${id}`) || document.getElementById(`barFill${id}`);
    if (barFill) {
        let absDev = Math.min(Math.abs(deviation), 50); 
        let heightPercent = (absDev / 50) * 50; 
        barFill.style.height = `${heightPercent}%`;
        barFill.style.backgroundColor = color;
        barFill.style.boxShadow = `0 0 15px ${color}`;
        
        if (deviation >= 0) {
            barFill.style.bottom = '50%';
            barFill.style.top = 'auto';
        } else {
            barFill.style.top = '50%';
            barFill.style.bottom = 'auto';
        }
    }
    const valEl = document.getElementById(`${prefix}Val${id}`) || document.getElementById(`val${id}`);
    if (valEl) {
        valEl.innerText = valText;
        valEl.style.color = color;
    }
}

function setGaugeDesc(id, text) {
    let prefix = getActivePrefix();
    let descLower = id.toLowerCase();
    const el = document.getElementById(`${prefix}Desc${id}`) || document.getElementById(`desc${id}`);
    if (el) el.innerText = text;
}

let _latestCurrentPitch = -1;
let _latestDataMetrics = null;

function handleBackendData(data) {
    if (!isRunning) return;

    if (data.type === "pro_report") {
        renderProReport(data.report);
        return;
    }

    if (isPlayingBack) return; 

    let rawPitch = data.pitch !== undefined ? data.pitch : -1;
    let finalPitch = rawPitch;

    if (rawPitch > 0) {
        let prev = pitchHistory[MAX_HISTORY - 1];
        if (prev > 0 && Math.abs(hzToMidi(rawPitch) - hzToMidi(prev)) <= 12) {
            finalPitch = prev * 0.4 + rawPitch * 0.6; 
        }
    }

    pitchHistory.shift();
    pitchHistory.push(finalPitch);
    _latestCurrentPitch = finalPitch;
    
    if (isRecordingMonitor) {
        const elapsed = (performance.now() - monitorRecordStartTime) / 1000;
        recordedPitchData.push({ pitch: finalPitch > 0 ? finalPitch : -1, time: performance.now() - monitorRecordStartTime });
        const statusEl = document.getElementById('recordStatusText');
        if (statusEl) {
            statusEl.innerText = t('monitor.rec_status_text', '录制中... ') + `${elapsed.toFixed(1)}s`;
        }
    }
    
    let isPerfMode = typeof performanceMode !== 'undefined' && performanceMode;
    if (data.metrics) {
        _latestDataMetrics = data.metrics;
        const m = data.metrics;
        if (finalPitch > 0) {
            silentFrames = 0;
            textBuffer.loud.push(m.loudness);
            textBuffer.bright.push(m.brightness);
            textBuffer.pure.push(m.purity);
            textBuffer.stab.push(m.stability);
            textBuffer.dev.push(m.deviation);
            textBuffer.vibrato.push(m.vibrato || 0);

            if (isPerfMode) {
                textBufferSum.loud += m.loudness;
                textBufferSum.bright += m.brightness;
                textBufferSum.pure += m.purity;
                textBufferSum.stab += m.stability;
                textBufferSum.dev += m.deviation;
                textBufferSum.vibrato += (m.vibrato || 0);
            }

            if (textBuffer.loud.length > MAX_BUFFER) {
                let shiftedLoud = textBuffer.loud.shift();
                let shiftedBright = textBuffer.bright.shift();
                let shiftedPure = textBuffer.pure.shift();
                let shiftedStab = textBuffer.stab.shift();
                let shiftedDev = textBuffer.dev.shift();
                let shiftedVib = textBuffer.vibrato.shift();

                if (isPerfMode) {
                    textBufferSum.loud -= shiftedLoud;
                    textBufferSum.bright -= shiftedBright;
                    textBufferSum.pure -= shiftedPure;
                    textBufferSum.stab -= shiftedStab;
                    textBufferSum.dev -= shiftedDev;
                    textBufferSum.vibrato -= shiftedVib;
                }
            }
        } else {
            silentFrames++;
        }
    }

    if (!isRenderLoopRunning) {
        isRenderLoopRunning = true;
        renderLoop();
    }
}

// ------------------------------------
// 主渲染与 UI 刷新逻辑
// ------------------------------------
let isRenderLoopRunning = false;
let lastRenderTime = performance.now();

function renderLoop() {
    if (!isRunning) {
        isRenderLoopRunning = false;
        return;
    }
    renderFrame();
    requestAnimationFrame(renderLoop);
}

function renderFrame() {
    let now = performance.now();
    let deltaTime = (now - lastRenderTime) / 1000.0;
    lastRenderTime = now;
    
    let ctx = getActiveCtx();
    if (!ctx) return;
    
    let canvasW = ctx.canvas.width;
    let canvasH = ctx.canvas.height;
    
    const getLocalY = (midi) => {
        let normalized = (midi - (viewCenterMidi - VIEW_RANGE / 2)) / VIEW_RANGE;
        return canvasH - normalized * canvasH; 
    };

    // 1. 更新视角和平滑移动
    let currentPitch = _latestCurrentPitch;
    let isTraining = typeof activeTrainingSequence !== 'undefined' && activeTrainingSequence !== null;
    let targetMidiFollow = null;

    if (isTraining && typeof trainingTargetList !== 'undefined') {
        let elapsedSeconds = (performance.now() - trainingStartTime) / 1000.0;
        for (let i = 0; i < trainingTargetList.length; i++) {
            let t = trainingTargetList[i];
            let timeUntilStart = t.startTime - elapsedSeconds;
            let timeUntilEnd = (t.startTime + t.duration) - elapsedSeconds;
            if (timeUntilEnd > 0 && timeUntilStart < 3.0) {
                targetMidiFollow = t.midi;
                break;
            }
        }
    }

    let margin = 3;
    let topBoundary = viewCenterMidi + VIEW_RANGE / 2 - margin;
    let bottomBoundary = viewCenterMidi - VIEW_RANGE / 2 + margin;

    if (targetMidiFollow !== null) {
        if (targetMidiFollow > topBoundary) {
            targetCenterMidi = targetMidiFollow - VIEW_RANGE / 2 + margin;
        } else if (targetMidiFollow < bottomBoundary) {
            targetCenterMidi = targetMidiFollow + VIEW_RANGE / 2 - margin;
        }
        
        if (currentPitch > 0) {
            let currentMidi = hzToMidi(currentPitch);
            let dynamicTop = targetCenterMidi + VIEW_RANGE / 2 - margin;
            let dynamicBot = targetCenterMidi - VIEW_RANGE / 2 + margin;
            if (currentMidi > dynamicTop) {
                targetCenterMidi = currentMidi - VIEW_RANGE / 2 + margin;
            } else if (currentMidi < dynamicBot) {
                targetCenterMidi = currentMidi + VIEW_RANGE / 2 - margin;
            }
        }
    } else if (currentPitch > 0) {
        let currentMidi = hzToMidi(currentPitch);
        if (currentMidi > topBoundary) {
            targetCenterMidi = currentMidi - VIEW_RANGE / 2 + margin;
        } else if (currentMidi < bottomBoundary) {
            targetCenterMidi = currentMidi + VIEW_RANGE / 2 - margin;
        }
    }
    viewCenterMidi += (targetCenterMidi - viewCenterMidi) * 0.1; 

    // 2. 绘制背景
    drawPitchBackground();

    // 2.5 绘制训练靶向区
    if (typeof activeTrainingSequence !== 'undefined' && activeTrainingSequence !== null) {
        drawTrainingTargets(ctx, canvasW, canvasH, getLocalY, deltaTime);
    }

    // 3. 绘制音高曲线
    let isPerfMode = typeof performanceMode !== 'undefined' && performanceMode;
    ctx.beginPath();
    let isDrawing = false;
    let prevX = 0, prevY = 0;
    
    let gradient = ctx.createLinearGradient(0, 0, canvasW, 0);
    gradient.addColorStop(0, '#00E5FF');
    gradient.addColorStop(0.5, '#c084fc');
    gradient.addColorStop(1, '#00E5FF');
    
    if (!isPerfMode) {
        ctx.shadowBlur = isAndroidGlobal ? 0 : 15;
        ctx.shadowColor = 'rgba(192, 132, 252, 0.8)';
        ctx.strokeStyle = gradient;
        ctx.lineWidth = 4;
    } else {
        ctx.shadowBlur = 0;
        ctx.strokeStyle = gradient;
        ctx.lineWidth = 3;
    }
    
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    let currentLineX = canvasW * 0.66;
    for (let i = 0; i < MAX_HISTORY; i++) {
        let p = pitchHistory[i];
        if (p > 0) {
            let x = (i / MAX_HISTORY) * currentLineX;
            let m = hzToMidi(p);
            let y = getLocalY(m); 
            
            if (!isDrawing) {
                ctx.moveTo(x, y);
                isDrawing = true;
            } else {
                let prevP = pitchHistory[i - 1];
                if (prevP > 0 && Math.abs(hzToMidi(p) - hzToMidi(prevP)) > 12) {
                    ctx.moveTo(x, y); 
                } else {
                    let cpX = (prevX + x) / 2;
                    ctx.quadraticCurveTo(cpX, prevY, x, y);
                }
            }
            prevX = x; prevY = y;
        } else {
            isDrawing = false; 
        }
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    // 绘制判定线
    ctx.beginPath();
    ctx.moveTo(currentLineX, 0);
    ctx.lineTo(currentLineX, canvasH);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 2;
    if (typeof activeTrainingSequence !== 'undefined' && activeTrainingSequence !== null) {
        ctx.setLineDash([5, 5]);
        ctx.stroke();
        ctx.setLineDash([]);
    } else {
        ctx.stroke();
    }

    // 4. 绘制当前音高指示器
    if (currentPitch > 0) {
        let currentX = currentLineX;
        let currentMidi = hzToMidi(currentPitch);
        let currentY = getLocalY(currentMidi);
        
        if (!isPerfMode) {
            ctx.shadowBlur = isAndroidGlobal ? 0 : 25;
            ctx.shadowColor = '#00E5FF';
        }
        let pulseRadius = 6 + 2 * Math.sin(Date.now() / 100);
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(currentX, currentY, pulseRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        
        let nearestMidi = Math.round(currentMidi);
        const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
        let noteStr = noteNames[(nearestMidi % 12 + 12) % 12] + (Math.floor(nearestMidi / 12) - 1);
        
        ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') {
            ctx.roundRect(currentX - 50, currentY - 30, 40, 24, 4);
        } else {
            let rx = currentX - 50, ry = currentY - 30, rw = 40, rh = 24, radius = 4;
            ctx.moveTo(rx + radius, ry);
            ctx.lineTo(rx + rw - radius, ry);
            ctx.quadraticCurveTo(rx + rw, ry, rx + rw, ry + radius);
            ctx.lineTo(rx + rw, ry + rh - radius);
            ctx.quadraticCurveTo(rx + rw, ry + rh, rx + rw - radius, ry + rh);
            ctx.lineTo(rx + radius, ry + rh);
            ctx.quadraticCurveTo(rx, ry + rh, rx, ry + rh - radius);
            ctx.lineTo(rx, ry + radius);
            ctx.quadraticCurveTo(rx, ry, rx + radius, ry);
        }
        ctx.fill();
        
        ctx.fillStyle = '#00FFF5';
        ctx.font = 'bold 13px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(noteStr, currentX - 30, currentY - 14);
        ctx.textAlign = 'left'; 

        let prefix = getActivePrefix();
        const valPitchEl = document.getElementById(`${prefix}ValPitch`) || document.getElementById(`valPitch`);
        if (valPitchEl) {
            valPitchEl.innerText = noteStr;
            valPitchEl.style.color = '#00FFF5';
            setGaugeDesc('Pitch', currentPitch.toFixed(1) + " Hz");
        }
    } else {
        let prefix = getActivePrefix();
        const valPitchEl = document.getElementById(`${prefix}ValPitch`) || document.getElementById(`valPitch`);
        if (valPitchEl) {
            valPitchEl.innerText = '--';
            valPitchEl.style.color = 'rgba(255,255,255,0.2)';
            setGaugeDesc('Pitch', t('monitor.waiting', "等待发声..."));
        }
    }

    // 5. 更新仪表盘 UI（受 UI_UPDATE_INTERVAL 节流）
    if (_latestDataMetrics && now - lastUiUpdateTime > UI_UPDATE_INTERVAL && !isPlayingBack) {
        const m = _latestDataMetrics;
        let lColor = m.loudness > 85 ? "#FF5252" : (m.loudness < 30 ? "#00B0FF" : "#00E676");

        if (currentPitch > 0) {
            updateGaugeCSS('Loud', m.loudness, lColor, m.loudness.toFixed(0));
            updateGaugeCSS('Bright', m.brightness, m.brightness > 70 ? "#FFEA00" : (m.brightness < 40 ? "#FF9100" : "#00B0FF"), m.brightness.toFixed(0));
            updateGaugeCSS('Pure', m.purity, m.purity > 70 ? "#00E676" : (m.purity < 50 ? "#9E9E9E" : "#B2FF59"), m.purity.toFixed(0));
            updateGaugeCSS('Stab', m.stability, m.stability > 90 ? "#00E676" : (m.stability < 60 ? "#FF5252" : "#00B0FF"), m.stability.toFixed(0));
            
            let devColor = Math.abs(m.deviation) > 15 ? "#FF5252" : "#00E676";
            let sign = m.deviation > 0 ? "+" : "";
            updateBipolarGaugeCSS('Dev', m.deviation, devColor, sign + m.deviation.toFixed(0));

            if (textBuffer.loud.length > 0) {
                let len = textBuffer.loud.length;
                let avgLoud, avgBright, avgPure, avgStab, avgDev;
                
                if (isPerfMode) {
                    avgLoud = textBufferSum.loud / len;
                    avgBright = textBufferSum.bright / len;
                    avgPure = textBufferSum.pure / len;
                    avgStab = textBufferSum.stab / len;
                    avgDev = textBufferSum.dev / len;
                } else {
                    avgLoud = textBuffer.loud.reduce((a, b) => a + b, 0) / len;
                    avgBright = textBuffer.bright.reduce((a, b) => a + b, 0) / len;
                    avgPure = textBuffer.pure.reduce((a, b) => a + b, 0) / len;
                    avgStab = textBuffer.stab.reduce((a, b) => a + b, 0) / len;
                    avgDev = textBuffer.dev.reduce((a, b) => a + b, 0) / len;
                }

                setGaugeDesc('Loud', avgLoud > 85 ? t('monitor.loud_loud', "💥 强音/爆音") : (avgLoud < 30 ? t('monitor.loud_soft', "🤫 轻声") : t('monitor.loud_normal', "🗣️ 正常音量")));
                setGaugeDesc('Bright', avgBright > 70 ? t('monitor.bright_head', "🟡 头声主导") : (avgBright < 40 ? t('monitor.bright_chest', "🟠 胸声主导") : t('monitor.bright_mix', "🔵 混声")));
                setGaugeDesc('Pure', avgPure > 70 ? t('monitor.pure_tight', "🛡️ 闭合紧密") : (avgPure < 50 ? t('monitor.pure_breathy', "💨 气声漏气") : t('monitor.pure_focused', "🎵 声音集中")));
                setGaugeDesc('Stab', avgStab > 90 ? t('monitor.stab_straight', "➖ 平稳长直") : (avgStab < 60 ? t('monitor.stab_jitter', "⚠️ 震荡") : t('monitor.stab_vibrato', "🌊 颤音自然")));
                setGaugeDesc('Dev', avgDev > 15 ? t('monitor.dev_sharp', "🔺 偏高 (Sharp)") : (avgDev < -15 ? t('monitor.dev_flat', "🔻 偏低 (Flat)") : t('monitor.dev_hit', "✅ 命中靶心")));
            }
        } else {
            updateGaugeCSS('Loud', m.loudness, lColor, m.loudness.toFixed(0));
            const inactiveColor = isLightMode ? 'rgba(255, 255, 255, 0.6)' : 'rgba(255, 255, 255, 0.05)';
            updateGaugeCSS('Bright', 0, inactiveColor, '0');
            updateGaugeCSS('Pure', 0, inactiveColor, '0');
            updateGaugeCSS('Stab', 0, inactiveColor, '0');
            updateBipolarGaugeCSS('Dev', 0, inactiveColor, '0');

            if (silentFrames > 20) {
                setGaugeDesc('Loud', m.loudness > 85 ? t('monitor.loud_loud', "💥 强音/爆音") : (m.loudness < 30 ? t('monitor.loud_soft', "🤫 轻声") : t('monitor.loud_normal', "🗣️ 正常音量")));
                setGaugeDesc('Bright', t('monitor.bright_waiting', "等待持续发声..."));
                setGaugeDesc('Pure', t('monitor.bright_waiting', "等待持续发声..."));
                setGaugeDesc('Stab', t('monitor.bright_waiting', "等待持续发声..."));
                setGaugeDesc('Dev', t('monitor.bright_waiting', "等待持续发声..."));
                textBuffer = { loud: [], bright: [], pure: [], stab: [], dev: [], vibrato: [] };
                textBufferSum = { loud: 0, bright: 0, pure: 0, stab: 0, dev: 0, vibrato: 0 };
            }
        }
        lastUiUpdateTime = now;
    }
}

// ------------------------------------
// 训练靶向区绘制与判定逻辑 (物理时间计分)
// ------------------------------------
function drawTrainingTargets(ctx, canvasW, canvasH, getLocalY, deltaTime) {
    if (!trainingTargetList || trainingTargetList.length === 0) return;
    
    let now = performance.now();
    let elapsedSeconds = (now - trainingStartTime) / 1000.0;
    // 增加 100ms 视觉延迟补偿，抵消音频处理带来的延迟
    let visualElapsedSeconds = Math.max(0, elapsedSeconds - 0.10);
    
    let isHit = false;
    let hitReason = "";
    let currentLineX = canvasW * 0.66;
    
    // Exact physical mapping based on Web Audio API buffer size (2048 samples at 44100Hz)
    const HISTORY_SECONDS = MAX_HISTORY * (2048 / 44100);
    const scrollPixelsPerSecond = currentLineX / HISTORY_SECONDS;
    const TIME_WINDOW = ((canvasW - currentLineX) / scrollPixelsPerSecond) + 1.0;
    
    for (let i = 0; i < trainingTargetList.length; i++) {
        let t = trainingTargetList[i];
        
        // Exact real-time audio scheduling synced with render frame (with safety bound to prevent chord-slamming on lag)
        if (!t.played && elapsedSeconds >= t.startTime - 0.05) {
            t.played = true;
            if (elapsedSeconds < t.startTime + 0.5 && typeof activeTrainingSequence !== 'undefined' && activeTrainingSequence !== null) {
                playGuideTone(t.midi, t.duration);
            }
        }

        if (t.audioOnly) continue;
        
        let timeUntilStart = t.startTime - visualElapsedSeconds;
        let timeUntilEnd = (t.startTime + t.duration) - visualElapsedSeconds;
        
        if (timeUntilEnd < -2.0) continue; 
        if (timeUntilStart > TIME_WINDOW) continue; 
        
        let startX = currentLineX + (timeUntilStart * scrollPixelsPerSecond);
        let endX = currentLineX + (timeUntilEnd * scrollPixelsPerSecond);
        let width = endX - startX;
        
        let y = getLocalY(t.midi);
        let margin = (t.type === 'precision') ? 4 : 10; 
        let boxHeight = margin * 2;
        let boxY = y - margin;
        
        let isActiveNow = (startX <= currentLineX && endX >= currentLineX);
        
        let color = 'rgba(255, 255, 255, 0.15)'; 
        let borderColor = 'rgba(255, 255, 255, 0.5)';
        
        if (isActiveNow) {
            let hitPitch = false;
            if (_latestCurrentPitch > 0) {
                let currentMidi = hzToMidi(_latestCurrentPitch);
                if (Math.abs(currentMidi - t.midi) <= ((t.type==='precision')?0.3:0.8)) { 
                    hitPitch = true;
                }
            }
            
            let hitCondition = hitPitch;
            
            if (hitPitch) {
                if (t.type === 'stability') {
                    let latestStab = textBuffer.stab.length > 0 ? textBuffer.stab[textBuffer.stab.length - 1] : 0;
                    if (latestStab < 70) hitCondition = false;
                    hitReason = hitCondition ? window.t('train.hit_stable', "气息稳定!") : window.t('train.hit_unstable', "气息不稳!");
                } else if (t.type === 'chest') {
                    let latestPure = textBuffer.pure.length > 0 ? textBuffer.pure[textBuffer.pure.length - 1] : 0;
                    if (latestPure < 15) hitCondition = false;
                } else if (t.type === 'head') {
                    let latestBright = textBuffer.bright.length > 0 ? textBuffer.bright[textBuffer.bright.length - 1] : 0;
                    if (latestBright < 2.0) hitCondition = false; 
                }
            }
            
            if (hitCondition) {
                color = 'rgba(0, 229, 255, 0.4)';
                borderColor = 'rgba(0, 229, 255, 1)';
                
                // 物理时间计分：累加确切的 DeltaTime 作为分数
                currentTrainingScore += deltaTime;
                isHit = true;
            } else {
                color = 'rgba(255, 82, 82, 0.3)';
                borderColor = 'rgba(255, 82, 82, 0.8)';
            }
        } else if (timeUntilEnd < 0) {
            color = 'rgba(100, 100, 100, 0.1)'; 
            borderColor = 'rgba(100, 100, 100, 0.2)';
        }
        
        ctx.fillStyle = color;
        ctx.fillRect(startX, boxY, width, boxHeight);
        
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = 2;
        ctx.strokeRect(startX, boxY, width, boxHeight);
        
        if (startX > 0 && startX < canvasW) {
            ctx.fillStyle = borderColor;
            ctx.font = "12px monospace";
            ctx.textAlign = 'left';
            ctx.fillText(t.type, startX + 5, boxY - 5);
        }
    }
    
    // 动态 HUD 指令层
    let upcomingTarget = null;
    for (let i = 0; i < trainingTargetList.length; i++) {
        let t = trainingTargetList[i];
        let timeUntilStart = t.startTime - visualElapsedSeconds;
        let timeUntilEnd = (t.startTime + t.duration) - visualElapsedSeconds;
        if (timeUntilEnd > 0 && timeUntilStart < 2.0) {
            upcomingTarget = t;
            break;
        }
    }
    const overlay = document.getElementById('trainingInstructionOverlay');
    const overlayText = document.getElementById('trainingInstructionText');
    if (overlay && overlayText) {
        if (upcomingTarget && upcomingTarget.instruction) {
            let displayInst = upcomingTarget.instruction;
            if (displayInst.startsWith('[听音提示] ')) {
                let actualInst = displayInst.replace('[听音提示] ', '');
                displayInst = window.t('[听音提示] ', '[Listening Hint] ') + window.t(actualInst, actualInst);
            } else {
                displayInst = window.t(displayInst, displayInst);
            }
            if (overlayText.innerText !== displayInst) {
                overlayText.innerText = displayInst;
            }
            overlay.style.opacity = '1';
        } else {
            overlay.style.opacity = '0';
        }
    }
    
    // 更新外部进度条 UI (100分制防溢出映射)
    let scoreDisplay = Math.min((currentTrainingScore / currentTrainingMaxScore) * 100, 100);
    const progressEl = document.getElementById('trainingScoreProgress');
    const textEl = document.getElementById('trainingScoreText');
    if (progressEl) progressEl.style.width = `${scoreDisplay}%`;
    if (textEl) textEl.innerText = `${Math.floor(scoreDisplay)} / 100`;

    if (isHit) {
        ctx.fillStyle = 'rgba(0, 229, 255, 0.1)';
        ctx.fillRect(0, 0, canvasW, canvasH);
        if (hitReason) {
            ctx.font = "bold 20px 'Inter', sans-serif";
            ctx.fillStyle = '#00E5FF';
            ctx.textAlign = 'center';
            ctx.fillText(hitReason, canvasW / 2, 80);
        }
    }
    
    if (trainingTargetList.length > 0) {
        let lastTarget = trainingTargetList[trainingTargetList.length - 1];
        let endTime = lastTarget.startTime + lastTarget.duration;
        
        // Throttled logging to backend console (once per 2 seconds) to track timeline progression
        if (!window.lastTimelineLogTime || now - window.lastTimelineLogTime > 2000) {
            window.lastTimelineLogTime = now;
            const progressMsg = `[Canvas Draw] elapsedSeconds: ${elapsedSeconds.toFixed(1)}s / targetEndTime: ${endTime.toFixed(1)}s, isModalShowing: ${isTrainingModalShowing}`;
            console.log(progressMsg);
            invoke('vmap_log', { message: progressMsg }).catch(err => {});
        }
        
        if (elapsedSeconds > endTime + 2.0) {
            if (!isTrainingModalShowing) {
                isTrainingModalShowing = true; // Lock state immediately
                
                let safeScore = 0;
                if (typeof currentTrainingScore !== 'undefined' && typeof currentTrainingMaxScore !== 'undefined' && currentTrainingMaxScore > 0) {
                    let calcScore = (currentTrainingScore / currentTrainingMaxScore) * 100;
                    if (!isNaN(calcScore) && isFinite(calcScore)) {
                        safeScore = Math.floor(Math.min(calcScore, 100));
                    }
                }
                
                try {
                    if (typeof showTrainingResultModal === 'function') {
                        showTrainingResultModal(safeScore);
                    } else {
                        alert(window.t('train.finished_alert_prefix', '训练完成！最终达成率: ') + `${safeScore}%`);
                        if (typeof exitTraining === 'function') exitTraining();
                    }
                } catch (e) {
                    console.error("Error showing modal:", e);
                    alert(window.t('train.modal_error', '训练完成！(展示结算面板时发生错误)'));
                    if (typeof exitTraining === 'function') exitTraining();
                }
            }
        }
    }
}

window.updateGaugeThemes = function() {
    if (!isRunning) {
        const inactiveColor = isLightMode ? 'rgba(0, 0, 0, 0.15)' : 'rgba(255, 255, 255, 0.05)';
        updateGaugeCSS('Loud', 0, inactiveColor, '0');
        updateGaugeCSS('Bright', 0, inactiveColor, '0');
        updateGaugeCSS('Pure', 0, inactiveColor, '0');
        updateGaugeCSS('Stab', 0, inactiveColor, '0');
        updateBipolarGaugeCSS('Dev', 0, inactiveColor, '0');
    }
};

drawPitchBackground();
window.updateGaugeThemes();
