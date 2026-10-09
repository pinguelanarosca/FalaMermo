'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const {root, runtimeFiles, verify} = require('./verify-publication.cjs');
const name = 'FalaMermo-v1.0.0.zip';
try {
    const files = [...runtimeFiles, 'README.md', 'docs/RELEASE-v1.0.0.md'];
    verify(root, files);
    const directory = path.join(root, 'dist');
    fs.mkdirSync(directory, {recursive: true});
    const zip = path.join(directory, name);
    // Não atualiza um ZIP anterior, pois isso poderia preservar entradas obsoletas.
    if (fs.existsSync(zip)) {
        if (!process.argv.includes('--verify-existing')) throw Error('Pacote já existe; use --verify-existing para verificar sem sobrescrever: ' + name);
    } else {
        cp.execFileSync('zip', ['-X', '-q', zip, ...files], {cwd: root});
    }
    cp.execFileSync('unzip', ['-t', zip], {stdio: 'pipe'});
    const entries = cp.execFileSync('unzip', ['-Z1', zip], {encoding: 'utf8'}).trim().split('\n');
    if (JSON.stringify([...entries].sort()) !== JSON.stringify([...files].sort())) throw Error('Entradas inesperadas no ZIP');
    const extracted = fs.mkdtempSync(path.join(os.tmpdir(), 'falamermo-package-'));
    cp.execFileSync('unzip', ['-q', zip, '-d', extracted]);
    const result = verify(extracted, entries);
    for (const file of entries) if (!fs.readFileSync(path.join(root, file)).equals(fs.readFileSync(path.join(extracted, file))))
        throw Error('Conteúdo extraído difere do original: ' + file);
    const sha256 = crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex');
    fs.writeFileSync(path.join(directory, name + '.sha256'), sha256 + '  ' + name + '\n');
    console.log(JSON.stringify({zip, bytes: fs.statSync(zip).size, sha256, extracted, ...result}, null, 2));
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}
