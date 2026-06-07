const fs = require('fs');
const path = require('path');
const JavaScriptObfuscator = require('javascript-obfuscator');

const srcDir = path.join(__dirname, '../frontend/src');
const componentsDir = path.join(srcDir, 'components');
const outPath = path.join(__dirname, '../frontend/index.html');

function build() {
    console.log('Building UI...');
    let mainHtml = fs.readFileSync(path.join(srcDir, 'index.html'), 'utf8');
    
    // Match <!-- INCLUDE: components/name.html -->
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
    
    console.log('Inlining and obfuscating external JavaScript...');
    const extScriptRegex = /<script\s+src="([^"]+)"><\/script>/gi;
    mainHtml = mainHtml.replace(extScriptRegex, (match, srcPath) => {
        if (!srcPath.endsWith('.js') || srcPath.includes('http')) return match;
        
        const jsPath = path.join(srcDir, '..', srcPath);
        if (fs.existsSync(jsPath)) {
            console.log(`Inlining and obfuscating ${srcPath}...`);
            let content = fs.readFileSync(jsPath, 'utf8');
            try {
                // 跳过包含第三方大库的混淆以节省构建时间和内存
                if (srcPath.includes('.min.') || srcPath.includes('lucide')) {
                    return `<script>\n${content}\n</script>`;
                }
                const obfuscated = JavaScriptObfuscator.obfuscate(content, {
                    compact: true,
                    controlFlowFlattening: true,
                    deadCodeInjection: true,
                    stringArray: true,
                    stringArrayEncoding: ['base64'],
                }).getObfuscatedCode();
                return `<script>\n${obfuscated}\n</script>`;
            } catch (e) {
                console.warn(`Obfuscation failed for ${srcPath}:`, e.message);
                return match;
            }
        } else {
            console.warn(`Could not find script to inline: ${jsPath}`);
            return match;
        }
    });

    fs.writeFileSync(outPath, mainHtml);
    console.log('Build UI completed: ' + outPath);
}

build();
