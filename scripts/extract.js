const fs = require('fs');

function extractById(id, name) {
    let html = fs.readFileSync('c:/Users/10431/Desktop/vocal map/frontend/src/index.html', 'utf8');
    
    // Find the opening tag containing id="xyz"
    const regex = new RegExp(`<div[^>]*id="${id}"[^>]*>`, 'i');
    const match = html.match(regex);
    if (!match) return false;
    
    const startIdx = match.index;
    
    let count = 0;
    let endIdx = -1;
    let inStr = false;
    let strChar = '';
    for (let i = startIdx; i < html.length; i++) {
        const char = html[i];
        if (!inStr) {
            if (char === '"' || char === "'") { inStr = true; strChar = char; }
            else if (html.substring(i, i+4) === '<div') { count++; i += 3; }
            else if (html.substring(i, i+5) === '</div') {
                count--;
                if (count === 0) {
                    endIdx = html.indexOf('>', i) + 1;
                    break;
                }
                i += 4;
            }
        } else {
            if (char === strChar && html[i-1] !== '\\') { inStr = false; }
        }
    }
    
    if (endIdx !== -1) {
        const content = html.substring(startIdx, endIdx);
        fs.writeFileSync(`c:/Users/10431/Desktop/vocal map/frontend/src/components/${name}.html`, content);
        
        // Update main HTML
        const updated = html.replace(content, `<!-- INCLUDE: components/${name}.html -->`);
        fs.writeFileSync('c:/Users/10431/Desktop/vocal map/frontend/src/index.html', updated);
        console.log(`Extracted ${name}`);
    }
}

extractById('settingsModal', 'modal_settings');
extractById('trainingResultModal', 'modal_training_result');
extractById('helpModal', 'modal_help');

console.log('Done extraction.');
