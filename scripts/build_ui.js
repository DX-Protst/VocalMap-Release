const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '../frontend/src');
const componentsDir = path.join(srcDir, 'components');
const outPath = path.join(__dirname, '../frontend/index.html');

function buildUI() {
    let mainHtml = fs.readFileSync(path.join(srcDir, 'index.html'), 'utf8');
    
    // Simple include mechanism: <!-- INCLUDE: header.html -->
    const regex = /<!--\s*INCLUDE:\s*(.*?)\s*-->/g;
    mainHtml = mainHtml.replace(regex, (match, p1) => {
        const compPath = path.join(srcDir, p1);
        if (fs.existsSync(compPath)) {
            console.log(`Including ${p1}...`);
            return fs.readFileSync(compPath, 'utf8');
        } else {
            console.error(`Component not found: ${compPath}`);
            return match;
        }
    });
    
    fs.writeFileSync(outPath, mainHtml);
    console.log('Build UI completed: ' + outPath);
}

buildUI();
