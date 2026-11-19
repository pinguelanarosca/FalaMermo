'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {root,PUBLIC_VERSION,publicFiles,verify}=require('../tools/verify-publication.cjs');
test('publicação v1.0.9 alinha manifest V3, README, notas e recursos do scheduler/player',()=>{
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
 assert.equal(PUBLIC_VERSION,'1.0.9');assert.equal(manifest.version,PUBLIC_VERSION);assert.equal(manifest.manifest_version,3);
 const readme=fs.readFileSync(path.join(root,'README.md'),'utf8'),notes=fs.readFileSync(path.join(root,'docs/RELEASE-v'+PUBLIC_VERSION+'.md'),'utf8');
 assert.match(readme,/FalaMermo v1\.0\.9/);assert.match(notes,/^# FalaMermo v1\.0\.9/);assert.ok(publicFiles().includes('stt-scheduler.js'));assert.ok(publicFiles().includes('docs/RELEASE-v1.0.3.md'));assert.ok(publicFiles().includes('docs/RELEASE-v1.0.4.md'));assert.ok(publicFiles().includes('docs/RELEASE-v1.0.9.md'));assert.ok(publicFiles().includes('task.html'));assert.ok(publicFiles().includes('task.js'));assert.equal(verify(root,publicFiles(),{syntax:false}).manifestVersion,PUBLIC_VERSION);
 assert.ok(fs.readFileSync(path.join(root,'.gitignore'),'utf8').includes('!docs/RELEASE-v1.0.9.md'));
 const packager=fs.readFileSync(path.join(root,'tools/package-release.cjs'),'utf8');assert.match(packager,/PUBLIC_VERSION/);assert.doesNotMatch(packager,/FalaMermo-v1\.0\.1\.zip/);
});
test('verificador rejeita divergência da versão pública antes de publicar',t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'falamermo-version-test-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));manifest.version='2.0.2';fs.writeFileSync(path.join(directory,'manifest.json'),JSON.stringify(manifest));
 assert.throws(()=>verify(directory,['manifest.json'],{syntax:false}),/versão pública 1\.0\.9/);
});
test('publicação inclui dependências locais de todos os cenários Chrome do HUD',()=>{
 const selected=new Set(publicFiles());
 for(const file of ['tests/hud-border-states-chrome.cjs','tests/hud-conflict-chrome.cjs','tests/hud-interactions-chrome.cjs'])assert.ok(selected.has(file),file);
 for(const file of selected){
  if(!file.startsWith('tests/')||!file.endsWith('.cjs'))continue;
  const source=fs.readFileSync(path.join(root,file),'utf8');
  for(const [,relative]of source.matchAll(/require\(['"](\.\/[^'"]+\.cjs)['"]\)/g)){
   const dependency=path.posix.normalize(path.posix.join(path.posix.dirname(file),relative));
   assert.ok(selected.has(dependency),`${file}: dependência ausente ${dependency}`);
  }
 }
});
