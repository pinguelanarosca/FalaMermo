// Carrega no VM exatamente a fonte compartilhada importada pelo service worker ESM.
const fs=require('node:fs'),path=require('node:path');
module.exports=function readBackground(file){
 const source=fs.readFileSync(file,'utf8');
 return ['tts-config.js','tts-adaptive.js','live-config.js','live-tts-diagnostics.js','live-stt-diagnostics.js','global-jobs.js','stt-scheduler.js'].map(name=>fs.readFileSync(path.join(path.dirname(file),name),'utf8')).join('\n')+'\n'+source.replace(/^import '\.\/(?:tts-(?:config|adaptive)|live-(?:config|tts-diagnostics|stt-diagnostics)|global-jobs|stt-scheduler)\.js';\n/gm,'');
};
