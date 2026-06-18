// ==========================================
// Theme Logic
// ==========================================
function initTheme() {
    const savedTheme = localStorage.getItem('vocalmap_theme');
    if (savedTheme) {
        setTheme(savedTheme);
    } else {
        const isLight = window.matchMedia('(prefers-color-scheme: light)').matches;
        setTheme(isLight ? 'light' : 'dark');
    }

    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', e => {
        if (!localStorage.getItem('vocalmap_theme')) {
            setTheme(e.matches ? 'light' : 'dark');
        }
    });
}

function setTheme(theme) {
    isLightMode = (theme === 'light');
    if (isLightMode) {
        document.documentElement.setAttribute('data-theme', 'light');
    } else {
        document.documentElement.removeAttribute('data-theme');
    }
    
    // Sync background options with the new color mode
    if (typeof window.syncBackgroundOptions === 'function') {
        window.syncBackgroundOptions();
    }
    
    if (typeof pitchCtx !== 'undefined' && pitchCtx !== null) {
        if (typeof drawPitchBackground === 'function') {
            drawPitchBackground();
        }
    }
    if (typeof updateGaugeThemes === 'function') {
        updateGaugeThemes();
    }
}

function toggleTheme() {
    const newTheme = isLightMode ? 'dark' : 'light';
    setTheme(newTheme);
    localStorage.setItem('vocalmap_theme', newTheme);
}

// Initialize theme on script load
initTheme();
