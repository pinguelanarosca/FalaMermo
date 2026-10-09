'use strict';
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const root = path.resolve(__dirname, '..');
const runtimeFiles = [
    'manifest.json', 'background.js', 'content.js', 'content.css',
    'popup.html', 'popup.js', 'options.html', 'options.js',
    'offscreen.html', 'offscreen.js', 'lens-permission.html', 'lens-permission.js',
    'tts-config.js', 'tts-adaptive.js', 'live-config.js', 'live-session-manager.js',
    'live-tts-diagnostics.js', 'live-stt-diagnostics.js', 'mic-capture-worklet.js', 'pcm-player-worklet.js',
    'icons/icon16.png', 'icons/icon48.png', 'icons/icon128.png',
];
function publicFiles() {
    return [...runtimeFiles, 'README.md', '.gitignore', 'docs/RELEASE-v1.0.0.md', 'docs/RELEASE-v1.0.1.md',
        'tools/verify-publication.cjs', 'tools/package-release.cjs',
        ...fs.readdirSync(path.join(root, 'tests')).filter(name =>
            name.endsWith('.test.cjs') || name === 'load-background.cjs').map(name => 'tests/' + name)].sort();
}
const secretRules = [
    ['Google API key', /AIza[0-9A-Za-z_-]{35}/g],
    ['GitHub token', /(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})/g],
    ['Private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g],
    ['AWS access key', /(?:AKIA|ASIA)[A-Z0-9]{16}/g],
    ['OpenAI token', /sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}/g],
    ['Credential in URL', /https?:\/\/[^\s/'"<>:]+:[^\s/'"<>@]+@/g],
    ['Bearer token literal', /Bearer\s+[A-Za-z0-9_.-]{32,}/g],
];
function verify(directory = root, files = publicFiles(), {syntax = true} = {}) {
    const selected = new Set(files);
    const findings = [];
    for (const file of files) {
        if (file.startsWith('/') || file.split('/').includes('..') || /(?:^|\/)(?:\.git|\.env[^/]*|\.aws|\.codex|\.agents|node_modules)(?:\/|$)|\.(?:env|log|pem|key|zip)$/i.test(file))
            throw Error('Arquivo proibido na publicação: ' + file);
        const absolute = path.join(directory, file), stat = fs.lstatSync(absolute);
        if (!stat.isFile() || stat.isSymbolicLink()) throw Error('Não é arquivo regular: ' + file);
        if (!file.endsWith('.png')) {
            const text = fs.readFileSync(absolute, 'utf8');
            for (const [rule, pattern] of secretRules) {
                pattern.lastIndex = 0;
                for (const match of text.matchAll(pattern)) findings.push({file, line: text.slice(0, match.index).split('\n').length, rule});
            }
        }
        if (syntax && /\.(?:js|cjs)$/.test(file)) {
            const checked = cp.spawnSync(process.execPath, ['--check', absolute], {encoding: 'utf8'});
            if (checked.status !== 0) throw Error('Sintaxe JavaScript inválida: ' + file);
        }
    }
    if (findings.length) {
        // Nunca inclui os valores encontrados. Suspende a publicação até revisão.
        throw Error('Possíveis segredos: ' + JSON.stringify(findings));
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
    if (manifest.manifest_version !== 3 || !/^\d+(\.\d+){0,3}$/.test(manifest.version)) throw Error('Manifest inválido');
    if (manifest.background?.type !== 'module') throw Error('Background deve permanecer módulo');
    const resources = [manifest.background.service_worker, manifest.action.default_popup, manifest.options_page,
        ...Object.values(manifest.icons || {}), ...Object.values(manifest.action.default_icon || {}),
        ...manifest.content_scripts.flatMap(item => [...item.js, ...(item.css || [])]),
        ...manifest.web_accessible_resources.flatMap(item => item.resources)];
    for (const file of files) {
        if (file.endsWith('.html')) {
            const html = fs.readFileSync(path.join(directory, file), 'utf8');
            for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
                if (!/^(?:https?:|#|data:)/.test(match[1])) resources.push(path.posix.join(path.posix.dirname(file), match[1]));
            }
        }
        if (file.endsWith('.js')) {
            const code = fs.readFileSync(path.join(directory, file), 'utf8');
            for (const match of code.matchAll(/getURL\(['"]([^'"]+)['"]\)/g)) resources.push(match[1]);
            for (const match of code.matchAll(/^import\s+['"]\.\/([^'"]+)['"]/gm)) resources.push(match[1]);
        }
    }
    for (const resource of resources) if (!selected.has(resource)) throw Error('Recurso ausente: ' + resource);
    return {files: files.length, javascript: files.filter(file => /\.(?:js|cjs)$/.test(file)).length,
        manifestVersion: manifest.version, manifestName: manifest.name, secretFindings: 0, referencesChecked: resources.length};
}
module.exports = {root, runtimeFiles, publicFiles, verify};
if (require.main === module) {
    try { console.log(JSON.stringify(verify(), null, 2)); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
}
