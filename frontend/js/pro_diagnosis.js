// ==========================================
// VocalMap Pro Diagnosis & Radar Report Logic
// ==========================================

const domIdle = document.getElementById('proStateIdle');
const domRecording = document.getElementById('proStateRecording');
const domReport = document.getElementById('proStateReport');
const btnImportAudioDetect = document.getElementById('btnImportAudioDetect');
const importAudioDetectFile = document.getElementById('importAudioDetectFile');
let currentDetectAudioSource = null;

if (document.getElementById('btnStartRecord')) {
    document.getElementById('btnStartRecord').addEventListener('click', () => {
        if (!isRunning || ws.readyState !== WebSocket.OPEN) {
            if (typeof showToast === 'function') {
                showToast(t('diag.mic_warn_title', "全息诊断警告"), t('diag.mic_warn_msg', "全息全录诊断舱需要先启动声学系统。请先点击右上角【连接后端并启动】按钮！"), "warning");
            } else {
                alert(t('audio.engine_start_failed_msg', "无法连接麦克风或后端分析引擎，请检查后端服务是否正在运行！"));
            }
            return;
        }
        domIdle.style.display = 'none'; domRecording.style.display = 'flex'; domReport.style.display = 'none';
        
        domRecording.classList.remove('animate-slide-left', 'animate-slide-right', 'animate-slide-up');
        void domRecording.offsetWidth;
        domRecording.classList.add('animate-slide-up');
        
        isProRecording = true; recordStartTime = performance.now();
        recordTimerInterval = setInterval(() => {
            const elTimer = document.getElementById('recordTimer');
            if (elTimer) {
                elTimer.innerText = ((performance.now() - recordStartTime) / 1000).toFixed(1) + 's';
            }
        }, 100);
        
        proAudioChunks = [];
        if (microphone && microphone.mediaStream) {
            try {
                proMediaRecorder = new MediaRecorder(microphone.mediaStream, { mimeType: 'audio/webm;codecs=opus' });
                proMediaRecorder.ondataavailable = e => {
                    if (e.data.size > 0) proAudioChunks.push(e.data);
                };
                proMediaRecorder.onstop = () => {
                    proAudioBlob = new Blob(proAudioChunks, { type: 'audio/webm' });
                };
                proMediaRecorder.start(200);
            } catch(e) {
                console.warn("无法启动 Pro 模式录音:", e);
            }
        }
        
        ws.send(JSON.stringify({ action: "start_record" }));
    });
}

if (btnImportAudioDetect) {
    btnImportAudioDetect.addEventListener('click', () => {
        if (!isRunning || ws.readyState !== WebSocket.OPEN) {
            if (typeof showToast === 'function') {
                showToast(t('diag.mic_warn_title', "全息诊断警告"), t('diag.import_warn_msg', "导入全长音频进行一键诊断需要先启动声学引擎，打通底层检测服务通道！"), "warning");
            } else {
                alert(t('audio.engine_start_failed_msg', "无法连接麦克风或后端分析引擎，请检查后端服务是否正在运行！"));
            }
            return;
        }
        importAudioDetectFile.click();
    });
}

if (importAudioDetectFile) {
    importAudioDetectFile.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        importAudioDetectFile.value = ''; // reset
        
        try {
            domIdle.style.display = 'none'; 
            domRecording.style.display = 'none'; 
            domReport.style.display = 'flex';
            
            domReport.classList.remove('animate-slide-left', 'animate-slide-right', 'animate-slide-up');
            void domReport.offsetWidth;
            domReport.classList.add('animate-slide-up');
            
            document.getElementById('reportContent').innerText = t('diag.processing', "🚀 正在进行离线高速分析，请稍候...");

            const arrayBuffer = await file.arrayBuffer();
            proAudioBlob = new Blob([arrayBuffer], { type: file.type });
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
            
            const float32Array = audioBuffer.getChannelData(0);
            const int16Array = new Int16Array(float32Array.length);
            for (let i = 0; i < float32Array.length; i++) {
                let s = Math.max(-1, Math.min(1, float32Array[i]));
                int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
            }
            
            const response = await fetch('http://127.0.0.1:5050/api/analyze_buffer', {
                method: 'POST',
                body: int16Array.buffer,
                headers: { 'Content-Type': 'application/octet-stream' }
            });
            
            const data = await response.json();
            if (data.type === 'pro_report') {
                renderProReport(data.report);
            } else {
                document.getElementById('reportContent').innerText = t('diag.process_failed', "分析失败: 未知返回格式");
            }
        } catch (err) {
            alert(t('diag.export_failed', "保存长图失败: ") + err);
            domReport.style.display = 'none';
            domIdle.style.display = 'flex';
        }
    });
}

if (document.getElementById('btnStopRecord')) {
    document.getElementById('btnStopRecord').addEventListener('click', () => {
        isProRecording = false; clearInterval(recordTimerInterval);
        domRecording.style.display = 'none'; domReport.style.display = 'flex';
        
        if (proMediaRecorder && proMediaRecorder.state !== "inactive") {
            proMediaRecorder.stop();
        }
        
        domReport.classList.remove('animate-slide-left', 'animate-slide-right', 'animate-slide-up');
        void domReport.offsetWidth;
        domReport.classList.add('animate-slide-up');
        
        if (currentDetectAudioSource) {
            try { currentDetectAudioSource.stop(); } catch(e) {}
            currentDetectAudioSource.disconnect();
            currentDetectAudioSource = null;
            if (microphone && processor) {
                try { microphone.connect(processor); } catch (e) {}
            }
        }
        
        document.getElementById('reportContent').innerText = t('diag.analyzing_rec', "正在综合分析刚才的演唱数据，请稍候...");
        ws.send(JSON.stringify({ action: "stop_record" }));
    });
}

if (document.getElementById('btnResetRecord')) {
    document.getElementById('btnResetRecord').addEventListener('click', () => {
        domReport.style.display = 'none'; domIdle.style.display = 'flex';
        const elTimer = document.getElementById('recordTimer');
        if (elTimer) {
            elTimer.innerText = '0.0s';
        }
        proAudioBlob = null;
        proTimeline = null;
        domIdle.classList.remove('animate-slide-left', 'animate-slide-right', 'animate-slide-up');
        void domIdle.offsetWidth;
        domIdle.classList.add('animate-slide-left');
    });
}

// 导出长图
const btnExportImage = document.getElementById('btnExportImage');
if (btnExportImage) {
    btnExportImage.addEventListener('click', () => {
        if (typeof domtoimage === 'undefined') {
            alert(t('diag.library_loading', "长图导出库尚未加载完成，请稍后再试！"));
            return;
        }
        const exportDiv = document.querySelector('#proStateReport > div:first-child > div');
        if (exportDiv) exportDiv.style.display = 'none';
        const btnReset = document.getElementById('btnResetRecord');
        if (btnReset && btnReset.parentNode.tagName !== 'DIV') btnReset.style.display = 'none';
        
        const reportContainer = document.getElementById('proStateReport');
        const reportContent = document.getElementById('reportContent');
        
        const overlay = document.createElement('div');
        overlay.style.position = 'fixed';
        overlay.style.top = '0'; overlay.style.left = '0';
        overlay.style.width = '100vw'; overlay.style.height = '100vh';
        overlay.style.background = '#0a0715';
        overlay.style.zIndex = '99999';
        overlay.style.display = 'flex';
        overlay.style.flexDirection = 'column';
        overlay.style.alignItems = 'center';
        overlay.style.justifyContent = 'center';
        overlay.innerHTML = '<div style="font-size: 64px; animation: pulse 1.5s infinite;">📸</div><div style="color: var(--primary-cyan); margin-top: 24px; font-size: 18px; font-weight: 800; letter-spacing: 1px;">' + t('diag.image_exporting_overlay', "正在为您提取原生高精度图像...") + '</div>';
        document.body.appendChild(overlay);
        
        const origContainerHeight = reportContainer.style.height;
        const origContainerOverflow = reportContainer.style.overflowY;
        const origContainerPadding = reportContainer.style.padding;
        
        const origContentHeight = reportContent.style.height;
        const origContentOverflow = reportContent.style.overflowY;
        const origContentFlex = reportContent.style.flex;
        
        reportContainer.style.height = 'max-content';
        reportContainer.style.overflowY = 'visible';
        reportContainer.style.padding = '40px';
        
        reportContent.style.height = 'max-content';
        reportContent.style.overflowY = 'visible';
        reportContent.style.flex = 'none';

        setTimeout(() => {
            const scale = 2;
            const w = reportContainer.scrollWidth;
            const h = reportContainer.scrollHeight;

            domtoimage.toPng(reportContainer, {
                quality: 1.0,
                bgcolor: '#0d0914', 
                width: w * scale,
                height: h * scale,
                style: {
                    transform: `scale(${scale})`,
                    transformOrigin: 'top left',
                    width: w + 'px',
                    height: h + 'px',
                    margin: '0'
                }
            }).then(async imgDataUrl => {
                reportContainer.style.height = origContainerHeight;
                reportContainer.style.overflowY = origContainerOverflow;
                reportContainer.style.padding = origContainerPadding;
                
                reportContent.style.height = origContentHeight;
                reportContent.style.overflowY = origContentOverflow;
                reportContent.style.flex = origContentFlex;
                
                if (exportDiv) exportDiv.style.display = 'flex';
                if (btnReset && btnReset.parentNode.tagName !== 'DIV') btnReset.style.display = 'inline-block';
                
                document.body.removeChild(overlay);
                
                const dialog = window.__TAURI__ ? window.__TAURI__.dialog : null;
                const core = window.__TAURI__ ? window.__TAURI__.core : null;
                if (!dialog || !core) {
                    const a = document.createElement('a');
                    a.href = imgDataUrl;
                    a.download = `VocalMap_Pro_Report_${new Date().getTime()}.png`;
                    a.click();
                    return;
                }

                try {
                    const savePath = await dialog.save({
                        filters: [{ name: 'Image', extensions: ['png'] }]
                    });
                    if (!savePath) return;

                    const base64Data = imgDataUrl.split(',')[1];
                    const byteCharacters = atob(base64Data);
                    const byteNumbers = new Array(byteCharacters.length);
                    for (let i = 0; i < byteCharacters.length; i++) {
                        byteNumbers[i] = byteCharacters.charCodeAt(i);
                    }
                    const byteArray = new Uint8Array(byteNumbers);
                    const fs = window.__TAURI__.fs;

                    await fs.writeFile(savePath, byteArray);
                    alert(t('diag.export_success', "报告长图导出成功！\n已保存至: ") + savePath);
                } catch (err) {
                    alert(t('diag.export_failed', "保存长图失败: ") + err);
                }
            }).catch(err => {
                reportContainer.style.height = origContainerHeight;
                reportContainer.style.overflowY = origContainerOverflow;
                reportContainer.style.padding = origContainerPadding;
                
                reportContent.style.height = origContentHeight;
                reportContent.style.overflowY = origContentOverflow;
                reportContent.style.flex = origContentFlex;
                
                if (exportDiv) exportDiv.style.display = 'flex';
                if (btnReset && btnReset.parentNode.tagName !== 'DIV') btnReset.style.display = 'inline-block';
                document.body.removeChild(overlay);
                alert(t('diag.export_failed', "长图导出失败: ") + err);
            });
        }, 300);
    });
}

// 导出为 VMAP
const btnExportVmap = document.getElementById('btnExportVmap');
if (btnExportVmap) {
    btnExportVmap.addEventListener('click', async () => {
        if (!proAudioBlob || !proTimeline) {
            alert(t('diag.no_data', "无法导出：缺少音频录制数据或时间轴数据。"));
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
            if (!savePath) return;

            const audioArrayBuffer = await proAudioBlob.arrayBuffer();
            const audioBytes = new Uint8Array(audioArrayBuffer);
            const fs = window.__TAURI__.fs;
            const webmPath = savePath.replace(/\.vmap$/, '') + '.webm';

            await fs.writeTextFile(savePath, JSON.stringify(proTimeline));
            await fs.writeFile(webmPath, audioBytes);
            
            alert(t('diag.export_vmap_success', "导出成功！已保存:\n") + savePath + "\n" + webmPath);
        } catch (e) {
            alert(t('diag.export_failed', "保存失败: ") + e);
        }
    });
}

// 五维雷达图绘制 (音准/稳定/纯净/共鸣/颤音)
function drawRadarChart(canvas, radarData) {
    var ctx = canvas.getContext('2d');
    var w = canvas.width, h = canvas.height;
    var cx = w / 2, cy = h / 2;
    var R = 115; 
    var labelR = R + 30;

    var labels = [t('diag.radar_accuracy', '音准'), t('diag.radar_stability', '稳定'), t('diag.radar_purity', '纯净'), t('diag.radar_resonance', '共鸣'), t('diag.radar_vibrato', '颤音')];
    var keys = ['accuracy', 'stability', 'purity', 'resonance', 'vibrato'];
    var N = labels.length;
    var values = keys.map(function(k) { return radarData[k] || 0; });

    ctx.clearRect(0, 0, w, h);

    // 背景网格 (五层同心五边形)
    for (var level = 1; level <= 5; level++) {
        var r = (R / 5) * level;
        ctx.beginPath();
        for (var i = 0; i < N; i++) {
            var angle = -Math.PI / 2 + (2 * Math.PI / N) * i;
            var x = cx + r * Math.cos(angle);
            var y = cy + r * Math.sin(angle);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.strokeStyle = isLightMode ? 'rgba(15, 23, 42, 0.04)' : 'rgba(255,255,255,0.04)';
        ctx.lineWidth = 1;
        ctx.stroke();
        
        if (level === 5) {
            ctx.fillStyle = isLightMode ? 'rgba(15, 23, 42, 0.2)' : 'rgba(255,255,255,0.1)';
            ctx.font = '10px "JetBrains Mono", monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('100', cx, cy - r - 12);
        }
    }

    // 轴线
    for (var j = 0; j < N; j++) {
        var a = -Math.PI / 2 + (2 * Math.PI / N) * j;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + R * Math.cos(a), cy + R * Math.sin(a));
        ctx.strokeStyle = isLightMode ? 'rgba(15, 23, 42, 0.03)' : 'rgba(255,255,255,0.03)';
        ctx.stroke();
    }

    // 数据区域 (半透明渐变填充 + 发光)
    ctx.beginPath();
    for (var k = 0; k < N; k++) {
        var angle = -Math.PI / 2 + (2 * Math.PI / N) * k;
        var dist = (values[k] / 100) * R;
        var px = cx + dist * Math.cos(angle);
        var py = cy + dist * Math.sin(angle);
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
    }
    ctx.closePath();
    
    var grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
    grad.addColorStop(0, 'rgba(192, 132, 252, 0.4)');
    grad.addColorStop(1, 'rgba(0, 229, 255, 0.1)');
    ctx.fillStyle = grad;
    
    ctx.shadowBlur = 20;
    ctx.shadowColor = 'rgba(192, 132, 252, 0.5)';
    ctx.fill();
    ctx.strokeStyle = '#c084fc';
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.shadowBlur = 0;

    // 数据点小圆 + 数值
    for (var m = 0; m < N; m++) {
        var a1 = -Math.PI / 2 + (2 * Math.PI / N) * m;
        var d1 = (values[m] / 100) * R;
        var dx = cx + d1 * Math.cos(a1);
        var dy = cy + d1 * Math.sin(a1);

        ctx.beginPath();
        ctx.arc(dx, dy, 5, 0, Math.PI * 2);
        
        ctx.shadowBlur = 10;
        ctx.shadowColor = '#00E5FF';
        ctx.fillStyle = '#00E5FF';
        ctx.fill();
        ctx.shadowBlur = 0;

        var valColor = values[m] >= 80 ? '#00E676' : (values[m] >= 50 ? '#FFEA00' : '#FF5252');
        ctx.fillStyle = valColor;
        ctx.font = 'bold 12px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(Math.round(values[m]), dx, dy - 10);
    }

    // 轴标签
    ctx.fillStyle = '#a399b5';
    ctx.font = '600 13px "Inter", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (var n = 0; n < N; n++) {
        var a2 = -Math.PI / 2 + (2 * Math.PI / N) * n;
        var lx = cx + labelR * Math.cos(a2);
        var ly = cy + labelR * Math.sin(a2);
        ctx.fillText(labels[n], lx, ly);
    }
}

function renderProReport(reportData) {
    if (reportData.timeline) {
        proTimeline = reportData.timeline;
    }
    
    var el = document.getElementById('reportContent');
    if (!el) return;

    el.style.display = 'block';
    el.style.overflowY = 'auto';
    el.style.textAlign = 'left';

    if (!reportData || reportData.status === 'error') {
        let errMsg = reportData ? reportData.message : t('diag.report_unavailable', '报告数据不可用，请重新录制。');
        if (errMsg === '有效发声数据不足，请大声演唱并保持足够时长。') {
            errMsg = t('diag.insufficient_data', '有效发声数据不足，请大声演唱并保持足够时长。');
        } else if (errMsg && errMsg.indexOf('未找到许可证文件') !== -1) {
            errMsg = t('diag.license_missing', '未找到许可证文件。请先购买 Pro 版并激活。');
        } else if (errMsg && errMsg.indexOf('您的许可证已过期') !== -1) {
            errMsg = t('diag.license_expired', '您的许可证已过期，请续费。');
        } else if (errMsg && (errMsg.indexOf('许可证验证失败') !== -1 || errMsg.indexOf('许可证校验异常') !== -1 || errMsg.indexOf('许可证签名伪造') !== -1)) {
            errMsg = t('diag.license_invalid', '许可证验证失败，请重新激活。');
        }
        el.innerHTML = '<div style="color:#FF5252; text-align:center; padding:40px;">'
            + errMsg
            + '</div>';
        return;
    }

    var html = '';

    if (reportData.radar_data) {
        html += '<div style="text-align:center; margin-bottom:18px;">'
            + '<canvas id="radarCanvas" width="300" height="300"></canvas>'
            + '</div>';
    }

    if (reportData.radar_data) {
        var rd = reportData.radar_data;
        var labels = [t('diag.radar_accuracy', '音准'), t('diag.radar_stability', '稳定'), t('diag.radar_purity', '纯净'), t('diag.radar_resonance', '共鸣'), t('diag.radar_vibrato', '颤音')];
        var keys = ['accuracy','stability','purity','resonance','vibrato'];
        html += '<div style="display:flex; gap:12px; flex-wrap:wrap; margin-bottom:16px;">';
        for (var i = 0; i < labels.length; i++) {
            var v = rd[keys[i]] || 0;
            var c = v >= 80 ? 'var(--primary-cyan)' : (v >= 50 ? '#FFEA00' : 'var(--primary-red)');
            html += '<div style="background:var(--upload-zone-bg); border:1px solid var(--glass-border); backdrop-filter:blur(8px); box-shadow:0 4px 12px rgba(0,0,0,0.05); padding:6px 14px; border-radius:8px; text-align:center; min-width:60px;">'
                + '<div style="color:var(--text-muted); font-size:11px;">' + labels[i] + '</div>'
                + '<div style="color:' + c + '; font-size:20px; font-weight:bold; font-family:monospace;">' + v + '</div>'
                + '</div>';
        }
        html += '</div>';
    }

    var hasContent = false;

    var dims = (reportData.analysis && reportData.analysis.dimensions) || [];
    if (dims.length > 0) {
        hasContent = true;
        html += '<div style="color:var(--primary-cyan); font-size:14px; font-weight:bold; margin-bottom:8px;">' + t('diag.report_findings', '诊断发现') + '</div>';
        dims.forEach(function(d) {
            var v = d.value || 0;
            var tc = v >= 80 ? 'var(--primary-cyan)' : (v >= 50 ? '#FFEA00' : 'var(--primary-red)');
            html += '<div style="background:var(--upload-zone-bg); border:1px solid var(--glass-border); backdrop-filter:blur(8px); box-shadow:0 4px 12px rgba(0,0,0,0.05); color:var(--text-main); padding:8px 12px; margin-bottom:8px; border-radius:8px; border-left:4px solid ' + tc + ';">'
                + '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">'
                + '<span style="color:var(--text-muted); font-size:12px;">' + d.label + '</span>'
                + '<span style="color:' + tc + '; font-weight:bold; font-size:14px; font-family:monospace;">' + v + '</span>'
                + '</div>'
                + '<div style="color:var(--text-muted); font-size:12px; line-height:1.6;">' + d.text + '</div>'
                + '</div>';
        });
    }

    var cross = (reportData.analysis && reportData.analysis.cross) || [];
    if (cross.length > 0) {
        hasContent = true;
        html += '<div style="color:var(--primary-cyan); font-size:14px; font-weight:bold; margin-bottom:8px; margin-top:14px;">' + t('diag.report_insights', '多维交叉洞察') + '</div>';
        cross.forEach(function(cr) {
            html += '<div style="background:var(--upload-zone-bg); border:1px solid var(--glass-border); backdrop-filter:blur(8px); box-shadow:0 4px 12px rgba(0,0,0,0.05); color:var(--text-main); padding:8px 12px; margin-bottom:8px; border-radius:8px; border-left:4px solid var(--primary-cyan);">'
                + '<span style="color:var(--primary-cyan); font-size:11px; font-weight:bold;">' + cr.pair + '</span> '
                + '<span style="color:var(--text-muted); font-size:12px; line-height:1.5;">' + cr.text + '</span>'
                + '</div>';
        });
    }

    if (!hasContent) {
        html += '<div style="color:var(--text-muted); text-align:center; padding:30px;">' + t('diag.report_normal', '各项指标均在正常范围，未发现明显问题。') + '</div>';
    }

    html += '<div style="margin-top:14px; color:var(--text-muted); font-size:11px; border-top:1px solid var(--glass-border); padding-top:8px;">'
        + t('diag.report_duration', '录制时长') + ': ' + (reportData.duration_sec || 0) + 's'
        + '  |  ' + t('diag.report_data_size', '数据量') + ': ' + (reportData.data_size_kb || 0) + 'KB</div>';

    el.innerHTML = html;
    el.scrollTop = 0;

    if (reportData.radar_data) {
        var radarCanvas = document.getElementById('radarCanvas');
        if (radarCanvas) {
            drawRadarChart(radarCanvas, reportData.radar_data);
        }
    }
}
