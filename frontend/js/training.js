// ==========================================
// VocalMap Pro Training Logic
// ==========================================

let currentSelectedRange = null;
let currentSelectedLevel = null;

let customLowestMidi = 48; // Default C3
let customHighestMidi = 72; // Default C5

const RANGE_BASES = {
    'soprano': 60, // C4
    'mezzo': 57,   // A3
    'alto': 53,    // F3
    'tenor': 48,   // C3
    'baritone': 43,// G2
    'bass': 40     // E2
};

const RANGE_MIDDLES = {
    'soprano': 72, // C5
    'mezzo': 69,   // A4
    'alto': 65,    // F4
    'tenor': 60,   // C4
    'baritone': 55,// G3
    'bass': 52     // E3
};

const RANGE_NAMES = {
    'soprano': '女高音',
    'mezzo': '女中音',
    'alto': '女低音',
    'tenor': '男高音',
    'baritone': '男中音',
    'bass': '男低音',
    'custom': '自定义'
};

const LEVEL_NAMES = {
    1: '热身激活',
    2: '气息稳定',
    3: '转音练习',
    4: '音准精修',
    5: '三类共鸣',
    6: '综合挑战'
};

function selectTrainingRange(rangeId) {
    if (rangeId === 'custom' && currentSelectedRange === 'custom') {
        // Toggle off
        currentSelectedRange = null;
        localStorage.removeItem('vocalMapSelectedRange');
        const panel = document.getElementById('customRangeConfigPanel');
        panel.style.opacity = '0.3';
        panel.style.pointerEvents = 'none';
        panel.style.borderColor = 'rgba(255,255,255,0.05)';
        panel.style.background = 'rgba(255, 255, 255, 0.02)';
        
        document.querySelectorAll('.range-card').forEach(card => {
            card.style.borderColor = 'transparent';
            card.style.background = 'rgba(255, 255, 255, 0.05)';
        });
        return;
    }
    
    currentSelectedRange = rangeId;
    localStorage.setItem('vocalMapSelectedRange', rangeId);
    
    if (rangeId === 'custom') {
        const panel = document.getElementById('customRangeConfigPanel');
        panel.style.opacity = '1';
        panel.style.pointerEvents = 'auto';
        panel.style.borderColor = 'var(--primary-cyan)';
        panel.style.background = 'rgba(0, 229, 255, 0.05)';
        if (document.getElementById('customLowestNote').options.length === 0) {
            initCustomRangeDropdowns();
        }
        updateCustomRange();
    } else {
        const panel = document.getElementById('customRangeConfigPanel');
        panel.style.opacity = '0.3';
        panel.style.pointerEvents = 'none';
        panel.style.borderColor = 'rgba(255,255,255,0.05)';
        panel.style.background = 'rgba(255, 255, 255, 0.02)';
        trainingBaseMidi = RANGE_MIDDLES[rangeId] || RANGE_BASES[rangeId];
    }
    
    // Update UI
    document.querySelectorAll('.range-card').forEach(card => {
        if (card.dataset.range === rangeId) {
            card.style.borderColor = 'var(--primary-cyan)';
            card.style.background = 'rgba(0, 229, 255, 0.1)';
        } else {
            card.style.borderColor = 'transparent';
            card.style.background = 'rgba(255, 255, 255, 0.05)';
        }
    });
    
    // 自动前往第二级：关卡选择 (仅当非自定义时自动滚动)
    if (rangeId !== 'custom') {
        setTimeout(() => {
            proceedToLevelSelection();
        }, 200);
    }
}

function initCustomRangeDropdowns() {
    const lowestSelect = document.getElementById('customLowestNote');
    const highestSelect = document.getElementById('customHighestNote');
    if (!lowestSelect || !highestSelect) return;
    
    let optionsHTML = '';
    const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    for (let m = 36; m <= 96; m++) {
        let octave = Math.floor(m / 12) - 1;
        let noteName = notes[m % 12] + octave;
        optionsHTML += `<option value="${m}">${noteName} (${m})</option>`;
    }
    lowestSelect.innerHTML = optionsHTML;
    highestSelect.innerHTML = optionsHTML;
    
    const savedLowest = localStorage.getItem('vocalMapCustomLowest');
    const savedHighest = localStorage.getItem('vocalMapCustomHighest');
    if (savedLowest) customLowestMidi = parseInt(savedLowest);
    if (savedHighest) customHighestMidi = parseInt(savedHighest);
    
    lowestSelect.value = customLowestMidi;
    highestSelect.value = customHighestMidi;
    
    // Explicitly call update to synchronize UI text and internal variables
    updateCustomRange();
}

function updateCustomRange() {
    const lowest = parseInt(document.getElementById('customLowestNote').value);
    const highest = parseInt(document.getElementById('customHighestNote').value);
    
    if (lowest >= highest) {
        alert("最高音必须高于最低音！");
        document.getElementById('customHighestNote').value = lowest + 12;
        return updateCustomRange();
    }
    
    customLowestMidi = lowest;
    customHighestMidi = highest;
    trainingBaseMidi = Math.floor((lowest + highest) / 2);
    
    localStorage.setItem('vocalMapCustomLowest', customLowestMidi);
    localStorage.setItem('vocalMapCustomHighest', customHighestMidi);
    
    const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const getNote = (m) => notes[m % 12] + (Math.floor(m / 12) - 1);
    document.getElementById('customRangeDisplayText').innerText = `${getNote(lowest)}(${lowest}) - ${getNote(highest)}(${highest})`;
}

function proceedToLevelSelection() {
    if (!currentSelectedRange) return;
    const fromView = document.getElementById('trainingRangeView');
    const toView = document.getElementById('trainingLevelView');
    if (fromView && toView) {
        fromView.style.display = 'none';
        toView.style.display = 'flex';
        toView.classList.remove('animate-slide-left', 'animate-slide-right', 'animate-slide-up');
        void toView.offsetWidth; // Force reflow
        toView.classList.add('animate-slide-right');
    }
    document.getElementById('displaySelectedRange').innerText = RANGE_NAMES[currentSelectedRange];
}

function backToRangeSelection() {
    const fromView = document.getElementById('trainingLevelView');
    const toView = document.getElementById('trainingRangeView');
    if (fromView && toView) {
        fromView.style.display = 'none';
        toView.style.display = 'flex';
        toView.classList.remove('animate-slide-left', 'animate-slide-right', 'animate-slide-up');
        void toView.offsetWidth; // Force reflow
        toView.classList.add('animate-slide-left');
    }
}

function selectTrainingLevel(level) {
    currentSelectedLevel = parseInt(level);
    
    // Update UI
    document.querySelectorAll('.level-card').forEach(card => {
        if (parseInt(card.dataset.level) === currentSelectedLevel) {
            card.style.borderColor = 'var(--primary-purple)';
            card.style.background = 'rgba(192, 132, 252, 0.1)';
        } else {
            card.style.borderColor = 'transparent';
            card.style.background = 'rgba(255, 255, 255, 0.05)';
        }
    });
    
    // 点到哪关就直接开始！给 150ms 动效缓冲时间
    setTimeout(() => {
        startTraining();
    }, 150);
}

function checkStartReady() {
    // No-op since button was removed and level clicks start training instantly
}

function generateTrainingSequence(level, baseMidi) {
    let sequence = [];
    let currentTime = 2.0; // 2 seconds prep time
    
    const RESONANCE_ZONES = {
        // Limit is C6(84). Mix: [80, 84], Head: [88, 92]
        'soprano':  { chest: [60, 65], mix: [80, 84], head: [88, 92] },
        // Limit is A5(81). Mix: [77, 81], Head: [85, 89]
        'mezzo':    { chest: [57, 62], mix: [77, 81], head: [85, 89] },
        // Limit is F5(77). Mix: [73, 77], Head: [81, 85]
        'alto':     { chest: [53, 58], mix: [73, 77], head: [81, 85] },
        // Limit is C5(72). Mix: [68, 72], Head: [76, 80]
        'tenor':    { chest: [48, 53], mix: [68, 72], head: [76, 80] },
        // Limit is G4(67). Mix: [63, 67], Head: [71, 75]
        'baritone': { chest: [43, 48], mix: [63, 67], head: [71, 75] },
        // Limit is E4(64). Mix: [60, 64], Head: [68, 72]
        'bass':     { chest: [40, 45], mix: [60, 64], head: [68, 72] }
    };
    
    if (currentSelectedRange === 'custom') {
        RESONANCE_ZONES['custom'] = {
            chest: [customLowestMidi, customLowestMidi + 5],
            mix: [customHighestMidi - 4, customHighestMidi + 4],
            head: [customHighestMidi + 4, customHighestMidi + 8]
        };
    }
    
    let lastMidi = -1; // Track global last midi to avoid consecutive duplicates where appropriate

    let _currentAudioOnly = false;
    const addNote = (midi, duration, type = 'normal', instruction = '') => {
        sequence.push({
            startTime: currentTime,
            duration: duration,
            midi: midi,
            type: type,
            instruction: _currentAudioOnly ? `[听音提示] ${instruction}` : instruction,
            audioOnly: _currentAudioOnly
        });
        currentTime += duration;
        lastMidi = midi;
    };
    
    const playWithPreview = (fn) => {
        let startIdx = sequence.length;
        let pStartTime = currentTime;
        _currentAudioOnly = true;
        
        fn(); 
        
        let endIdx = sequence.length;
        let previewDuration = currentTime - pStartTime;
        
        addRest(1.0); 
        
        let actualStartTime = currentTime;
        for (let i = startIdx; i < endIdx; i++) {
            let pNote = sequence[i];
            let relativeTime = pNote.startTime - pStartTime;
            sequence.push({
                startTime: actualStartTime + relativeTime,
                duration: pNote.duration,
                midi: pNote.midi,
                type: pNote.type,
                instruction: pNote.instruction.replace('[听音提示] ', ''),
                audioOnly: false
            });
        }
        currentTime = actualStartTime + previewDuration;
        addRest(1.0); 
    };
    
    // Rest
    const addRest = (duration) => {
        currentTime += duration;
    };
    
    // Generate Random Int within bounds (inclusive)
    const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
    const randChoice = (arr) => arr[Math.floor(Math.random() * arr.length)];
    // Fisher-Yates shuffle
    const shuffleArray = (array) => {
        let arr = array.slice();
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    };

    const bluesOffsets = [-12, -9, -7, -6, -5, -2, 0, 3, 5, 6, 7, 10, 12, 15, 17, 18, 19];

    if (level === 1) {
        // Level 1: Warmup (随机长音与音阶爬升, 120秒)
        let endT = currentTime + 120;
        while (currentTime < endT) {
            let warmupType = randChoice(['long_note', 'scale_climb', 'arpeggio']);
            playWithPreview(() => {
                if (warmupType === 'long_note') {
                    let possibleOffsets = [-2, 0, 2, 4, 5, 7].filter(o => (baseMidi + o) !== lastMidi);
                    if (possibleOffsets.length === 0) possibleOffsets = [0];
                    let nextOffset = randChoice(possibleOffsets); 
                    addNote(baseMidi + nextOffset, 4.0, 'normal', '平稳长音，调整呼吸');
                } else if (warmupType === 'scale_climb') {
                    let scaleOffsets = [0, 2, 4, 5, 7];
                    for(let i=0; i<scaleOffsets.length; i++) {
                        addNote(baseMidi + scaleOffsets[i], 1.0, 'normal', '顺阶上行，唤醒声带');
                    }
                    for(let i=scaleOffsets.length-2; i>=0; i--) {
                        addNote(baseMidi + scaleOffsets[i], 1.0, 'normal', '顺阶下行');
                    }
                    addNote(baseMidi, 2.5, 'normal', '落音稳住气息');
                } else { // arpeggio
                    let arpOffsets = [0, 4, 7, 12];
                    for(let i=0; i<arpOffsets.length; i++) {
                        addNote(baseMidi + arpOffsets[i], 1.0, 'normal', '琶音上行，打开共鸣腔');
                    }
                    for(let i=arpOffsets.length-2; i>=0; i--) {
                        addNote(baseMidi + arpOffsets[i], 1.0, 'normal', '琶音下行');
                    }
                    addNote(baseMidi, 2.5, 'normal', '落音稳住气息');
                }
            });
        }
    } else if (level === 2) {
        // Level 2: Breath Stability (长音考核, 缩短单次时长并增加频次, 60秒)
        let endT = currentTime + 60;
        while (currentTime < endT) {
            playWithPreview(() => {
                let possibleOffsets = [-5, 0, 4, 7].filter(o => (baseMidi + o) !== lastMidi);
                if (possibleOffsets.length === 0) possibleOffsets = [0];
                let targetOffset = randChoice(possibleOffsets);
                let holdDuration = randChoice([6.0, 7.0, 8.0]);
                addNote(baseMidi + targetOffset, holdDuration, 'stability', '稳定长音，保持核心支撑');
            });
        }
    } else if (level === 3) {
        // Level 3: Riffs (转音练习，加入上行、下行与折返组合, 60秒)
        let endT = currentTime + 60;
        while (currentTime < endT) {
            let runLength = randInt(4, 7);
            let direction = randChoice(['up', 'down', 'combo']);
            playWithPreview(() => {
                if (direction === 'down') {
                    let currentIdx = randInt(7, 11);
                    for (let i = 0; i < runLength; i++) {
                        let dur = (i === 0 || i === runLength - 1) ? 0.35 : 0.25;
                        addNote(baseMidi + bluesOffsets[currentIdx], dur, 'riff', '丝滑布鲁斯转音，放松喉头');
                        currentIdx -= randChoice([1, 1, 1, 1, 2]); // bias heavily towards 1 index step
                        if (currentIdx < 0) currentIdx = 0;
                    }
                    addNote(baseMidi + bluesOffsets[currentIdx], 2.0, 'riff', '稳定落音');
                } else if (direction === 'up') {
                    let currentIdx = randInt(3, 6);
                    for (let i = 0; i < runLength; i++) {
                        let dur = (i === 0 || i === runLength - 1) ? 0.35 : 0.25;
                        addNote(baseMidi + bluesOffsets[currentIdx], dur, 'riff', '轻盈上行，寻找高位共鸣');
                        currentIdx += randChoice([1, 1, 1, 1, 2]);
                        if (currentIdx > 12) currentIdx = 12;
                    }
                    addNote(baseMidi + bluesOffsets[currentIdx], 2.0, 'riff', '稳定落音');
                } else { // combo
                    let half = Math.floor(runLength / 2);
                    let currentIdx = randInt(5, 8);
                    for (let i = 0; i < half; i++) {
                        let dur = (i === 0) ? 0.35 : 0.25;
                        addNote(baseMidi + bluesOffsets[currentIdx], dur, 'riff', '波浪转音，灵活折返');
                        currentIdx += randChoice([1, 1, 1, 2]);
                        if (currentIdx > 12) currentIdx = 12;
                    }
                    for (let i = half - 1; i >= 0; i--) {
                        let dur = (i === 0) ? 0.35 : 0.25;
                        addNote(baseMidi + bluesOffsets[currentIdx], dur, 'riff', '波浪转音，灵活折返');
                        currentIdx -= randChoice([1, 1, 1, 2]);
                        if (currentIdx < 0) currentIdx = 0;
                    }
                    addNote(baseMidi + bluesOffsets[currentIdx], 2.0, 'riff', '回到基准');
                }
            });
        }
    } else if (level === 4) {
        // Level 4: Precision (音准精修，增强随机度与双向跳跃, 60秒)
        let endT = currentTime + 60;
        while (currentTime < endT) {
            playWithPreview(() => {
                let possibleRoots = [-4, -2, 0, 2, 4].filter(o => (baseMidi + o) !== lastMidi);
                if (possibleRoots.length === 0) possibleRoots = [0];
                let rootOffset = randChoice(possibleRoots);
                let jumpInterval = randChoice([-12, -7, -5, -4, 4, 5, 7, 12]);
                addNote(baseMidi + rootOffset, 2.0, 'precision', '定音准备，音准聚焦');
                addNote(baseMidi + rootOffset + jumpInterval, 2.0, 'precision', '高跨度跳跃，精准打击');
            });
        }
    } else if (level === 5) {
        // Level 5: Resonance Zones (三类共鸣，确保每次循环均出现，并引入区域内随机音高, 30秒)
        let endT = currentTime + 30;
        let rangeId = currentSelectedRange || 'tenor';
        let zones = RESONANCE_ZONES[rangeId] || RESONANCE_ZONES['tenor'];
        
        while (currentTime < endT) {
            let zoneTypes = shuffleArray(['chest', 'mix', 'head']);
            for (let zone of zoneTypes) {
                if (currentTime >= endT) break;
                
                playWithPreview(() => {
                    let targetMidi = randInt(zones[zone][0], zones[zone][1]);
                    if (targetMidi === lastMidi) {
                        targetMidi = (targetMidi < zones[zone][1]) ? targetMidi + 1 : targetMidi - 1;
                    }
                    
                    if (zone === 'chest') {
                        addNote(targetMidi, 5.0, 'chest', '底音区目标，打开胸声共鸣');
                    } else if (zone === 'mix') {
                        addNote(targetMidi, 5.0, 'mix', '换声区目标，使用混声建立连接');
                    } else {
                        addNote(targetMidi, 5.0, 'head', '高音区目标，释放明亮的头声');
                    }
                });
            }
        }
    } else if (level === 6) {
        // Level 6: Ultimate (120秒随机大杂烩，重用前5关的动态逻辑)
        let endT = currentTime + 120;
        let challengeBag = [];
        
        while (currentTime < endT) {
            if (challengeBag.length === 0) {
                // 囊括前五关的核心能力：热身、稳定、转音、跳跃、共鸣
                challengeBag = shuffleArray(['warmup', 'stability', 'riff', 'jump', 'resonance']);
            }
            let challengeType = challengeBag.pop();
            
            playWithPreview(() => {
                if (challengeType === 'warmup') {
                    let warmupType = randChoice(['long_note', 'scale_climb']);
                    if (warmupType === 'long_note') {
                        let possibleOffsets = [-2, 0, 2, 4, 5, 7].filter(o => (baseMidi + o) !== lastMidi);
                        if (possibleOffsets.length === 0) possibleOffsets = [0];
                        let nextOffset = randChoice(possibleOffsets); 
                        addNote(baseMidi + nextOffset, 4.0, 'normal', '平稳发声，深呼吸');
                    } else {
                        let scaleOffsets = [0, 2, 4, 5, 7];
                        for(let i=0; i<scaleOffsets.length; i++) {
                            addNote(baseMidi + scaleOffsets[i], 1.0, 'normal', '顺阶上行');
                        }
                        for(let i=scaleOffsets.length-2; i>=0; i--) {
                            addNote(baseMidi + scaleOffsets[i], 1.0, 'normal', '顺阶下行');
                        }
                        addNote(baseMidi, 2.5, 'normal', '落音稳住气息');
                    }
                } else if (challengeType === 'stability') {
                    let possibleOffsets = [-5, 0, 4, 7].filter(o => (baseMidi + o) !== lastMidi);
                    if (possibleOffsets.length === 0) possibleOffsets = [0];
                    let targetOffset = randChoice(possibleOffsets);
                    let holdDuration = randChoice([6.0, 7.0, 8.0]);
                    addNote(baseMidi + targetOffset, holdDuration, 'stability', '稳定长音，保持核心支撑');
                } else if (challengeType === 'riff') {
                    let runLength = randInt(4, 7);
                    let riffDir = randChoice(['up', 'down', 'combo']);
                    if (riffDir === 'down') {
                        let currentIdx = randInt(7, 11);
                        for (let i = 0; i < runLength; i++) {
                            let dur = (i === 0 || i === runLength - 1) ? 0.35 : 0.25;
                            addNote(baseMidi + bluesOffsets[currentIdx], dur, 'riff', '极速下行转音');
                            currentIdx -= randChoice([1, 1, 1, 1, 2]);
                            if (currentIdx < 0) currentIdx = 0;
                        }
                        addNote(baseMidi + bluesOffsets[currentIdx], 2.0, 'riff', '着陆稳住');
                    } else if (riffDir === 'up') {
                        let currentIdx = randInt(3, 6);
                        for (let i = 0; i < runLength; i++) {
                            let dur = (i === 0 || i === runLength - 1) ? 0.35 : 0.25;
                            addNote(baseMidi + bluesOffsets[currentIdx], dur, 'riff', '极速上行转音');
                            currentIdx += randChoice([1, 1, 1, 1, 2]);
                            if (currentIdx > 12) currentIdx = 12;
                        }
                        addNote(baseMidi + bluesOffsets[currentIdx], 2.0, 'riff', '着陆稳住');
                    } else {
                        let half = Math.floor(runLength / 2);
                        let currentIdx = randInt(5, 8);
                        for (let i = 0; i < half; i++) {
                            let dur = (i === 0) ? 0.35 : 0.25;
                            addNote(baseMidi + bluesOffsets[currentIdx], dur, 'riff', '波浪转音');
                            currentIdx += randChoice([1, 1, 1, 2]);
                            if (currentIdx > 12) currentIdx = 12;
                        }
                        for (let i = half - 1; i >= 0; i--) {
                            let dur = (i === 0) ? 0.35 : 0.25;
                            addNote(baseMidi + bluesOffsets[currentIdx], dur, 'riff', '波浪转音');
                            currentIdx -= randChoice([1, 1, 1, 2]);
                            if (currentIdx < 0) currentIdx = 0;
                        }
                        addNote(baseMidi + bluesOffsets[currentIdx], 2.0, 'riff', '回到基准');
                    }
                } else if (challengeType === 'jump') {
                    let possibleRoots = [-4, -2, 0, 2, 4].filter(o => (baseMidi + o) !== lastMidi);
                    if (possibleRoots.length === 0) possibleRoots = [0];
                    let rootOffset = randChoice(possibleRoots);
                    let jumpInterval = randChoice([-12, -7, -5, -4, 4, 5, 7, 12]);
                    addNote(baseMidi + rootOffset, 2.0, 'precision', '定音准备，音准聚焦');
                    addNote(baseMidi + rootOffset + jumpInterval, 2.0, 'precision', '高跨度跳跃，精准打击');
                } else { // resonance
                    let rangeId = currentSelectedRange || 'tenor';
                    let zones = RESONANCE_ZONES[rangeId] || RESONANCE_ZONES['tenor'];
                    let zone = randChoice(['chest', 'mix', 'head']);
                    let targetMidi = randInt(zones[zone][0], zones[zone][1]);
                    if (targetMidi === lastMidi) {
                        targetMidi = (targetMidi < zones[zone][1]) ? targetMidi + 1 : targetMidi - 1;
                    }
                    
                    if (zone === 'chest') {
                        addNote(targetMidi, 5.0, 'chest', '底音区目标，打开胸声共鸣');
                    } else if (zone === 'mix') {
                        addNote(targetMidi, 5.0, 'mix', '换声区目标，使用混声建立连接');
                    } else {
                        addNote(targetMidi, 5.0, 'head', '高音区极限挑战，释放头声');
                    }
                }
            });
        }
    }
    
    return sequence;
}

function startTraining() {
    if (!isRunning || ws.readyState !== WebSocket.OPEN) {
        if (typeof showToast === 'function') {
            showToast("全息舱检测警告", "检测到系统引擎尚未就绪。请先点击右上角【连接后端并启动】按钮，打通声学网关！", "warning");
        } else {
            alert("请先点击右上角的【连接后端并启动】引擎！");
        }
        return;
    }
    
    // Generate sequence
    trainingTargetList = generateTrainingSequence(currentSelectedLevel, trainingBaseMidi);
    activeTrainingSequence = currentSelectedLevel;
    currentTrainingScore = 0;
    trainingCurrentTargetIndex = 0;
    isTrainingModalShowing = false;
    
    // Target duration logic for scoring (100 points max total for perfect hitting over time)
    currentTrainingMaxScore = 0;
    trainingTargetList.forEach(t => {
        if (!t.audioOnly) {
            currentTrainingMaxScore += t.duration;
        }
    });
    
    // UI Transitions
    const fromView = document.getElementById('trainingLevelView');
    const toView = document.getElementById('trainingSessionView');
    if (fromView && toView) {
        fromView.style.display = 'none';
        toView.style.display = 'flex';
        toView.classList.remove('animate-slide-left', 'animate-slide-right', 'animate-slide-up');
        void toView.offsetWidth; // Force reflow
        toView.classList.add('animate-slide-up');
    }
    document.getElementById('trainingActiveLevelName').innerText = `正在进行: 关卡 ${currentSelectedLevel} ${LEVEL_NAMES[currentSelectedLevel]}`;
    document.getElementById('trainingScoreProgress').style.width = '0%';
    document.getElementById('trainingScoreText').innerText = `0 / 100`;
    
    // Clean up old canvas resizing logic to ensure graphics match realtime monitor
    const canvas = document.getElementById('trainingPitchCanvas');
    
    // Ensure render mode is focused on the target
    viewCenterMidi = trainingBaseMidi + 6; // Center the view roughly around the middle of the octave
    targetCenterMidi = viewCenterMidi;
    
    trainingStartTime = performance.now();
    
    // Audio scheduling is now handled dynamically in realtime_monitor.js to perfectly sync with visual blocks and prevent setTimeout overlapping drift

    // Robust timer to guarantee the training modal pops up at the end of the session
    if (trainingTargetList.length > 0) {
        let lastTarget = trainingTargetList[trainingTargetList.length - 1];
        let totalDurationSeconds = lastTarget.startTime + lastTarget.duration + 2.0;
        
        if (window.trainingEndTimer) {
            clearTimeout(window.trainingEndTimer);
        }
        
        const scheduleLog = `[Timer Scheduled] totalDurationSeconds: ${totalDurationSeconds}s, level: ${currentSelectedLevel}, range: ${currentSelectedRange}`;
        console.log(scheduleLog);
        fetch('http://127.0.0.1:5050/api/log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: scheduleLog })
        }).catch(err => {});
        
        window.trainingEndTimer = setTimeout(() => {
            // Double check that the training session is still active and has not been cancelled/exited
            const activeCheckLog = `[Timer Fire] activeTrainingSequence: ${activeTrainingSequence}, currentSelectedLevel: ${currentSelectedLevel}, isTrainingModalShowing: ${isTrainingModalShowing}`;
            console.log(activeCheckLog);
            fetch('http://127.0.0.1:5050/api/log', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: activeCheckLog })
            }).catch(err => {});

            if (activeTrainingSequence === currentSelectedLevel && !isTrainingModalShowing) {
                console.log("[Timer] Training completed! Triggering result modal.");
                isTrainingModalShowing = true; // Lock state immediately
                
                let scoreDisplay = Math.min((currentTrainingScore / currentTrainingMaxScore) * 100, 100);
                let safeScore = 0;
                if (!isNaN(scoreDisplay) && isFinite(scoreDisplay)) {
                    safeScore = Math.floor(scoreDisplay);
                }
                
                try {
                    if (typeof showTrainingResultModal === 'function') {
                        showTrainingResultModal(safeScore);
                    } else {
                        alert(`训练完成！最终达成率: ${safeScore}%`);
                        if (typeof exitTraining === 'function') exitTraining();
                    }
                } catch (e) {
                    console.error("Error showing modal via timer:", e);
                    alert(`训练完成！(展示结算面板时发生错误)`);
                    if (typeof exitTraining === 'function') exitTraining();
                }
            }
        }, totalDurationSeconds * 1000);
    }
    
    console.log("Training started:", trainingTargetList);
}

function exitTraining() {
    stopTraining();
    const fromView = document.getElementById('trainingSessionView');
    const toView = document.getElementById('trainingLevelView');
    if (fromView && toView) {
        fromView.style.display = 'none';
        toView.style.display = 'flex';
        toView.classList.remove('animate-slide-left', 'animate-slide-right', 'animate-slide-up');
        void toView.offsetWidth; // Force reflow
        toView.classList.add('animate-slide-left');
    }
}

function stopTraining() {
    activeTrainingSequence = null;
    trainingTargetList = [];
    currentTrainingScore = 0;
    isTrainingModalShowing = false;
    
    // Clear the robust timer if active
    if (window.trainingEndTimer) {
        clearTimeout(window.trainingEndTimer);
        window.trainingEndTimer = null;
    }
    
    // Hide HUD overlay if it was showing
    const overlay = document.getElementById('trainingInstructionOverlay');
    if (overlay) overlay.style.opacity = '0';
}

function showTrainingResultModal(score) {
    const logCall = `[showTrainingResultModal] called with score: ${score}`;
    console.log(logCall);
    fetch('http://127.0.0.1:5050/api/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: logCall })
    }).catch(err => console.warn(err));

    const modal = document.getElementById('trainingResultModal');
    const scoreVal = document.getElementById('trainingResultScoreVal');
    const feedbackBox = document.getElementById('trainingResultFeedback');
    const tutorialText = document.getElementById('trainingResultTutorialText');
    
    const domCheck = `[showTrainingResultModal DOM check] modal: ${!!modal}, scoreVal: ${!!scoreVal}, feedbackBox: ${!!feedbackBox}, tutorialText: ${!!tutorialText}`;
    console.log(domCheck);
    fetch('http://127.0.0.1:5050/api/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: domCheck })
    }).catch(err => console.warn(err));
    
    if (modal && scoreVal && feedbackBox) {
        scoreVal.innerText = score;
        
        // AI Feedback generation based on score
        let feedbackHTML = "";
        if (score >= 90) {
            feedbackHTML = `<b style="color: #00E676;"><i data-lucide="check-circle" class="lucide-icon" style="width:16px;height:16px;"></i> 完美驾驭！</b><br>您的气息支撑和音准控制堪称专业级表现，共鸣通道完全打开。可以尝试更高难度的挑战或跨音区练习了！`;
        } else if (score >= 70) {
            feedbackHTML = `<b style="color: #00B0FF;"><i data-lucide="thumbs-up" class="lucide-icon" style="width:16px;height:16px;"></i> 表现优秀！</b><br>您已经掌握了该关卡的核心发声技巧。但在长音稳定度或音阶切换的瞬间还可以更加平滑，继续保持练习！`;
        } else if (score >= 50) {
            feedbackHTML = `<b style="color: #FFEA00;"><i data-lucide="alert-circle" class="lucide-icon" style="width:16px;height:16px;"></i> 潜力很大！</b><br>音准大方向是正确的，但在特定靶向区间出现了气息不稳或音高游离。建议先退回上一关进行慢速的热身巩固。`;
        } else {
            feedbackHTML = `<b style="color: #FF5252;"><i data-lucide="info" class="lucide-icon" style="width:16px;height:16px;"></i> 需要调整！</b><br>音准偏差较大，可能是发声机能尚未唤醒或音区选择不匹配。别灰心，建议重新选择您的核心音区，从最基础的长直音开始练起。`;
        }
        
        feedbackBox.innerHTML = feedbackHTML;
        
        if (tutorialText) {
            let tutorialHTML = "";
            if (currentSelectedLevel === 1) {
                tutorialHTML = "【热身激活】目标是唤醒声带。得分的关键在于<b>放松喉头</b>，不要追求音量，而是追求在每个音符转换时的平滑度与音高的准确命中。";
            } else if (currentSelectedLevel === 2) {
                tutorialHTML = "【气息稳定】得分的关键是<b>控制呼气的均匀度</b>。在超长音期间，请使用横膈膜支撑，保持发光线条（稳定度 Stab）笔直，不要让声音发抖。";
            } else if (currentSelectedLevel === 3) {
                tutorialHTML = "【转音练习】得分的关键在于<b>颗粒感</b>。遇到密集的下行音阶，切忌滑音拖沓。可以在练习时加入微弱的“弹”的感觉，确保每个音都能单独被识别框捕获。";
            } else if (currentSelectedLevel === 4) {
                tutorialHTML = "【音准精修】面对大跨度跳跃，不要在滑动中寻找音高。得分秘诀是：在心里提前“听”到目标音，然后用气息<b>直接精准降落</b>在目标矩形内。";
            } else if (currentSelectedLevel === 5) {
                tutorialHTML = "【三类共鸣】得分要求不仅是音准！底音区需要您提高胸腔震动（声带闭合严实）；中音区需结合面罩共鸣；高音区需放松下巴，让气流冲击头腔（提升亮度 Brightness）。";
            } else if (currentSelectedLevel === 6) {
                tutorialHTML = "【综合挑战】这不仅考核声乐机能，更考核体力。高分的秘诀是学会<b>在间隙合理偷气</b>，在转音时收力，在长音时使用核心对抗。";
            }
            tutorialText.innerHTML = tutorialHTML;
        }

        if (typeof lucide !== 'undefined') {
            lucide.createIcons({ root: modal });
        }
        
        modal.classList.add('active');
    }
}

function closeTrainingResultModal() {
    const modal = document.getElementById('trainingResultModal');
    if (modal) {
        modal.classList.remove('active');
    }
    if (typeof exitTraining === 'function') {
        exitTraining();
    }
}

window.addEventListener('DOMContentLoaded', () => { 
    initCustomRangeDropdowns(); 
    
    const savedRange = localStorage.getItem('vocalMapSelectedRange');
    if (savedRange) {
        selectTrainingRange(savedRange);
        if (savedRange === 'custom') {
            setTimeout(() => {
                proceedToLevelSelection();
            }, 300);
        }
    }
});
