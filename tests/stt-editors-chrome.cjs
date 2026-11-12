'use strict';
// Servidor local e runner Chrome isolado. Requer pacotes ProseMirror locais, sem APIs remotas.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),os=require('node:os'),{spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),modules=process.env.PROSEMIRROR_DIR;
if(!modules)throw Error('Defina PROSEMIRROR_DIR para node_modules com prosemirror-model/state/view/transform e orderedmap.');
const allowed=new Set(['prosemirror-model','prosemirror-state','prosemirror-view','prosemirror-transform','orderedmap']);
const server=http.createServer((req,res)=>{
 let file=req.url==='/'?path.join(__dirname,process.argv.includes('--continuous')?'stt-continuous-browser.html':'stt-editors-browser.html'):req.url==='/dictation-runtime.js'?path.join(root,'dictation-runtime.js'):null;
 const match=/^\/modules\/([^/]+)\/dist\/index.js$/.exec(req.url);if(match&&allowed.has(match[1]))file=path.join(modules,match[1],'dist/index.js');
 if(!file||!fs.existsSync(file)){res.writeHead(404);res.end();return;}
 res.setHeader('Content-Type',file.endsWith('.html')?'text/html; charset=utf-8':'application/javascript');res.setHeader('Cache-Control','no-store');res.end(fs.readFileSync(file));
});
async function main(){
 await new Promise((resolve,reject)=>server.once('error',reject).listen(process.argv.includes('--serve')?18771:0,'127.0.0.1',resolve));
 const url='http://127.0.0.1:'+server.address().port;
 if(process.argv.includes('--serve')){console.log(url);return;}
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'falamermo-editors-'));
 const chrome=spawn('google-chrome',['--headless','--no-sandbox','--disable-gpu','--disable-background-networking','--no-first-run','--remote-debugging-pipe','--user-data-dir='+path.join(dir,'profile')],{stdio:['ignore','ignore','pipe','pipe','pipe']});
 chrome.stderr.pipe(fs.createWriteStream(path.join(dir,'chrome.log')));
 const pending=new Map();let id=0,buffer='';
 function call(method,params={},sessionId){return new Promise((resolve,reject)=>{const n=++id,timer=setTimeout(()=>{pending.delete(n);reject(Error('Timeout '+method));},10000);pending.set(n,{resolve,reject,timer});chrome.stdio[3].write(JSON.stringify({id:n,method,params,sessionId})+'\0');});}
 chrome.stdio[4].on('data',data=>{buffer+=data;let at;while((at=buffer.indexOf('\0'))>=0){const msg=JSON.parse(buffer.slice(0,at));buffer=buffer.slice(at+1);const p=pending.get(msg.id);if(p){pending.delete(msg.id);clearTimeout(p.timer);msg.error?p.reject(Error(JSON.stringify(msg.error))):p.resolve(msg.result);}}});
 try{
  console.log(JSON.stringify({chrome:(await call('Browser.getVersion')).product,versions:Object.fromEntries([...allowed].map(name=>[name,JSON.parse(fs.readFileSync(path.join(modules,name,'package.json'))).version])),artifacts:dir}));
  const {targetId}=await call('Target.createTarget',{url});const {sessionId}=await call('Target.attachToTarget',{targetId,flatten:true});
  async function evaluate(expression){const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},sessionId);if(r.exceptionDetails)throw Error(r.exceptionDetails.text);return r.result.value;}
  for(let i=0;i<100;i++){if(await evaluate('!!document.querySelector("#run")?.onclick'))break;await new Promise(r=>setTimeout(r,50));}
  await evaluate('document.querySelector("#run").click()');let result;
  for(let i=0;i<200;i++){result=await evaluate('(()=>{try{return JSON.parse(document.querySelector("#result").textContent)}catch{return null}})()');if(result?.done)break;await new Promise(r=>setTimeout(r,50));}
  console.log(JSON.stringify(result,null,2));
  const shot=await call('Page.captureScreenshot',{},sessionId);fs.writeFileSync(path.join(dir,'result.png'),Buffer.from(shot.data,'base64'));
  if(!result?.done||result.results.some(r=>!r.passed))process.exitCode=1;
 }finally{chrome.kill();server.close();for(const p of pending.values())clearTimeout(p.timer);}
}
main().catch(error=>{console.error(error);server.close();process.exitCode=1;});
