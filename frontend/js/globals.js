// ==========================================
// VocalMap Global Variables & Exception Logger
// ==========================================

// Global error handler to report exceptions directly to Python terminal for absolute diagnostics
window.addEventListener('error', function(event) {
    const errorMsg = `Error: ${event.message} at ${event.filename || 'unknown'}:${event.lineno || 0}:${event.colno || 0}\nStack: ${event.error ? event.error.stack : 'No stack trace'}`;
    console.error(errorMsg);
    invoke('vmap_log', { message: errorMsg }).catch(err => console.warn("Failed to send log to backend", err));
});

// Capture unhandled promise rejections as well
window.addEventListener('unhandledrejection', function(event) {
    const errorMsg = `Unhandled Promise Rejection: ${event.reason ? (event.reason.message || event.reason) : 'Unknown reason'}\nStack: ${event.reason && event.reason.stack ? event.reason.stack : 'No stack trace'}`;
    console.error(errorMsg);
    invoke('vmap_log', { message: errorMsg }).catch(err => console.warn("Failed to send log to backend", err));
});

const startBtn = document.getElementById('startBtn');
const pitchCanvas = document.getElementById('pitchCanvas');
const pitchCtx = pitchCanvas ? pitchCanvas.getContext('2d') : null;
const wsStatus = document.getElementById('wsStatus');

let audioContext, microphone, processor, ws;
let isRunning = false;
let isLightMode = false;
let performanceMode = localStorage.getItem('vocalmap_perf') !== 'false'; // 默认为 true

const CANVAS_WIDTH = pitchCanvas ? pitchCanvas.width : 850;
const CANVAS_HEIGHT = pitchCanvas ? pitchCanvas.height : 520;
const VIEW_RANGE = 24; 
let viewCenterMidi = 48; 
let targetCenterMidi = 48; 

const SCROLL_SPEED = 8.5; 
const MAX_HISTORY = Math.floor(CANVAS_WIDTH / SCROLL_SPEED); 
let pitchHistory = new Array(MAX_HISTORY).fill(-1); 

const MAX_BUFFER = 15; 
let textBuffer = { loud: [], bright: [], pure: [], stab: [], dev: [], vibrato: [] };
let silentFrames = 0;  
let lastUiUpdateTime = 0; 
const UI_UPDATE_INTERVAL = 250; 

// 监视录制与回放状态
let isRecordingMonitor = false;
let isPlayingBack = false;
let recordedPitchData = []; 
let monitorRecordStartTime = 0;
let playbackCurrentIndex = 0;
let hoverPlaybackIndex = -1;

let mediaRecorder = null;
let audioChunks = [];
let recordedAudioBlob = null;
let playbackAudio = new Audio();

// 支付系统与 Tauri 通信封装
const tauri = window.__TAURI__ || {};
const core = tauri.core || {};
const invoke = core.invoke || (async () => console.warn("Tauri API not found"));
const eventAPI = tauri.event || {};
const listen = eventAPI.listen || (async () => {});
const shell = tauri.shell || {};
const open = shell.open || (async () => {});
const appAPI = tauri.app || {};
const getVersion = appAPI.getVersion || (async () => "2.0.3");
const updater = tauri.updater || {};
const check = updater.check || (async () => null);

const CLOUD_API_BASE = 'http://66.112.209.251:8000/api';
let LOCAL_API_BASE = 'http://127.0.0.1:5050';
let localMachineId = '';
const LICENSE_CACHE_KEY = 'vocalmap_license';

window.internalApiToken = '';

// Retrieve internal api token and backend port from Tauri when startup
(async function initApiTokenAndPort() {
    try {
        if (typeof invoke === 'function') {
            window.internalApiToken = await invoke('get_internal_token');
            const port = await invoke('get_backend_port');
            LOCAL_API_BASE = `http://127.0.0.1:${port}`;
            window.LOCAL_API_BASE = LOCAL_API_BASE;
            if (typeof SEP_BASE !== 'undefined') {
                SEP_BASE = `http://127.0.0.1:${port}`;
                window.SEP_BASE = SEP_BASE;
            }
            console.log(`[Tauri] Internal API Token secured. Backend Port: ${port}`);
        }
    } catch (e) {
        console.warn("Failed to get internal api token or port", e);
    }
})();

// Pro 模式诊断录制
let isProRecording = false;
let recordStartTime = 0;
let recordTimerInterval = null;
let proAudioBlob = null;
let proAudioChunks = [];
let proMediaRecorder = null;
let proTimeline = null;

// System Modes & Status
let currentMode = 'IDLE'; // 'IDLE', 'PRACTICE', 'EVALUATION', 'PLAYBACK', 'TRAINING'
let engineConnected = false;
window.globalPianoVolume = 1.0;
window.globalPlaybackVolume = 1.0;

// Pro 音轨分离
let currentProTab = 'sing';
let selectedFileInst = null;
let selectedFileVoc = null;
let SEP_BASE = 'http://127.0.0.1:5050';
let forceCPU = false;

// ==========================================
// VocalMap Pro Training Level Variables
// ==========================================
let activeTrainingSequence = null; 
let currentTrainingScore = 0;
let currentTrainingMaxScore = 0;
let trainingStartTime = 0;
let trainingBaseMidi = 48; 
let trainingTargetList = []; // format: [{startTime, duration, midi, type: 'normal'|'vibrato'}]
let trainingCurrentTargetIndex = -1;
let isTrainingModalShowing = false;

// High-Fidelity Additive Web Audio API Synth for Piano Guide Tones
function playGuideTone(midiNote, durationSeconds = 1.0) {
    if (!audioContext || audioContext.state === 'suspended') return;
    
    // Initialize a global compressor to prevent clipping when volume is high
    if (!window.pianoCompressor) {
        window.pianoCompressor = audioContext.createDynamicsCompressor();
        window.pianoCompressor.threshold.value = -8; // Start compressing at -8dB
        window.pianoCompressor.knee.value = 12;
        window.pianoCompressor.ratio.value = 12; // Hard ratio to catch peaks
        window.pianoCompressor.attack.value = 0.002;
        window.pianoCompressor.release.value = 0.15;
        window.pianoCompressor.connect(audioContext.destination);
    }
    
    const freq = 440 * Math.pow(2, (midiNote - 69) / 12);
    
    // Master gain for the note
    const masterGain = audioContext.createGain();
    masterGain.gain.setValueAtTime(0, audioContext.currentTime);
    // Envelope: quick attack, exponential decay (piano style)
    // Base multiplier increased to 2.0, compressor will prevent clipping
    masterGain.gain.linearRampToValueAtTime(2.0 * window.globalPianoVolume, audioContext.currentTime + 0.02);
    masterGain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + durationSeconds + 0.5);
    
    // Lowpass filter (wooden body resonance)
    const filter = audioContext.createBiquadFilter();
    filter.type = 'lowpass';
    // Frequency sweeps down slightly to simulate harmonic decay
    filter.frequency.setValueAtTime(Math.min(freq * 5, 4000), audioContext.currentTime);
    filter.frequency.exponentialRampToValueAtTime(Math.min(freq * 1.5, 1000), audioContext.currentTime + durationSeconds);
    filter.Q.value = 1.5;
    
    // Connect chain
    masterGain.connect(filter);
    filter.connect(window.pianoCompressor);

    // Additive Oscillators
    const createOsc = (type, freqRatio, gainLevel) => {
        const osc = audioContext.createOscillator();
        const oscGain = audioContext.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq * freqRatio, audioContext.currentTime);
        oscGain.gain.value = gainLevel;
        osc.connect(oscGain);
        oscGain.connect(masterGain);
        osc.start(audioContext.currentTime);
        osc.stop(audioContext.currentTime + durationSeconds + 0.5);
        return osc;
    };

    // 1. Fundamental (warm body)
    createOsc('triangle', 1, 0.6);
    // 2. Sub-octave (thickness)
    createOsc('sine', 0.5, 0.2);
    // 3. Second harmonic (bright metal strike)
    createOsc('sine', 2, 0.15);
    // 4. Third harmonic (tine presence)
    createOsc('sine', 3, 0.05);
}

// High-Fidelity Modern Toast Notification System
function showToast(title, message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    // Create toast card
    const toast = document.createElement('div');
    toast.className = `vocalmap-toast ${type}`;

    // Select Lucide Icon based on notification type
    let iconName = 'info';
    if (type === 'success') iconName = 'check-circle';
    else if (type === 'warning') iconName = 'alert-triangle';
    else if (type === 'error') iconName = 'x-circle';

    toast.innerHTML = `
        <i data-lucide="${iconName}" class="vocalmap-toast-icon"></i>
        <div class="vocalmap-toast-content">
            <div class="vocalmap-toast-title">${title}</div>
            <div class="vocalmap-toast-message">${message}</div>
        </div>
    `;

    // Append to container
    container.appendChild(toast);

    // Initialize Lucide icon in the new toast element
    if (typeof lucide !== 'undefined') {
        lucide.createIcons({ root: toast });
    }

    // Trigger slide-in animation with a tiny delay
    setTimeout(() => {
        toast.classList.add('show');
    }, 50);

    // Dismiss function
    const dismiss = () => {
        if (toast.classList.contains('dismissed')) return;
        toast.classList.add('dismissed');
        toast.classList.remove('show');
        setTimeout(() => {
            if (toast.parentNode === container) {
                container.removeChild(toast);
            }
        }, 400);
    };

    // Support manual click to dismiss instantly
    toast.addEventListener('click', dismiss);

    // Auto-destroy after 3.0 seconds (including 400ms slide-out animation)
    setTimeout(() => {
        dismiss();
    }, 3000);
}
