(function(root,factory){const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else root.DictationRuntime=api;})(globalThis,function(root){
'use strict';
const ACK_TIMEOUT_MS=10000;
function timeout(promise,ms,code){let timer;return Promise.race([Promise.resolve(promise),new Promise((_,reject)=>{timer=setTimeout(()=>{const error=new Error(code);error.code=code;reject(error);},ms);})]).finally(()=>clearTimeout(timer));}
class AudioQueue{
 constructor({send,onFailure=()=>{},onProgress=()=>{},metrics={},ackTimeoutMs=ACK_TIMEOUT_MS,maxPendingChunks=root.SttRealtime?.CONFIG.maxPendingPackets??320,maxPendingBytes=root.SttRealtime?.CONFIG.maxQueuedBytes??960000}){this.send=send;this.onFailure=onFailure;this.onProgress=onProgress;this.metrics=metrics;this.ackTimeoutMs=ackTimeoutMs;this.maxPendingChunks=maxPendingChunks;this.maxPendingBytes=maxPendingBytes;this.tail=Promise.resolve();this.failure=null;this.closed=false;Object.assign(metrics,{queuedChunks:0,queuedBytes:0,pendingChunks:0,pendingBytes:0,forwardedChunks:0,forwardedBytes:0,ackTimeouts:0});}
 push(payload,bytes){if(this.closed||this.failure)return false;const queuedAt=Date.now(),m=this.metrics;if(m.pendingChunks>=this.maxPendingChunks||m.pendingBytes+bytes>this.maxPendingBytes){const error=Object.assign(Error('Fila STT cheia; captura interrompida sem descarte silencioso.'),{code:'BACKPRESSURE'});this.failure=error;const cleanup=Promise.resolve().then(()=>this.onFailure(error)).catch(reason=>console.error('[STT queue cleanup]',reason?.name||'Error'));this.tail=Promise.all([this.tail,cleanup]).then(()=>{});return false;}m.queuedChunks++;m.queuedBytes+=bytes;m.pendingChunks++;m.pendingBytes+=bytes;this.onProgress(m);
  const work=this.tail.then(async()=>{if(this.failure||this.closed)return;const waiting=Date.now()-queuedAt;m.queueWaitMs=waiting;m.maxQueueWaitMs=Math.max(m.maxQueueWaitMs||0,waiting);m.forwardedChunks++;m.forwardedBytes+=bytes;this.onProgress(m);const reply=await timeout(this.send(payload),this.ackTimeoutMs,'ACK_TIMEOUT');if(!reply?.success)throw Error(reply?.error||'Áudio Live sem confirmação de envio.');m.ackChunks=(m.ackChunks||0)+1;m.ackBytes=(m.ackBytes||0)+bytes;m.pendingChunks--;m.pendingBytes-=bytes;this.onProgress(m);});
  this.tail=work.catch(error=>{if(this.failure||this.closed)return;this.failure=error;if(error.code==='ACK_TIMEOUT')m.ackTimeouts++;this.onProgress(m);return Promise.resolve(this.onFailure(error)).catch(failure=>console.error('[STT queue cleanup]',failure));});return true;
 }
 async drain(){await this.tail;if(this.failure)throw this.failure;if(this.closed&&this.metrics.pendingChunks)throw Error('A fila STT foi encerrada antes de confirmar todo o áudio.');}
 close(){this.closed=true;}
}
// Apenas captura STT: falhas reais de dispositivo/worklet não podem parecer um Stop.
function watchCapture(capture,{onFailure,onState=()=>{}}){
 const removers=[];let failed=false;
 const listen=(target,event,fn)=>{if(!target?.addEventListener)return;target.addEventListener(event,fn);removers.push(()=>target.removeEventListener(event,fn));};
 const fail=(reason,message)=>{if(failed||capture.stopping||capture.released)return;failed=true;const error=Object.assign(Error(message),{code:'CAPTURE_FAILURE',stopReason:reason});Promise.resolve().then(()=>onFailure(error)).catch(error=>root.console?.error('[STT capture failure]',error?.name||'Error'));};
 for(const track of capture.stream?.getTracks()||[])listen(track,'ended',()=>fail('microphone-ended','O dispositivo encerrou o microfone durante o ditado. O resultado pode estar incompleto.'));
 listen(capture.node,'processorerror',()=>fail('worklet-error','O AudioWorklet do microfone falhou. O ditado foi interrompido; o texto recebido permanece no cartão.'));
 listen(capture.context,'statechange',()=>{onState();if(capture.context.state==='closed')fail('context-closed','O AudioContext do microfone foi encerrado inesperadamente. O resultado pode estar incompleto.');});
 return()=>{failed=true;for(const remove of removers)remove();};
}
function editable(element){return Boolean(element&&element.isConnected!==false&&!element.disabled&&!element.readOnly&&(element.isContentEditable||typeof element.value==='string'&&typeof element.selectionStart==='number'));}
// Chromium preserva espaços visuais do contenteditable usando NBSP ao editar. Não é reversão do editor.
function textOf(element){return typeof element.value==='string'?element.value:(element.textContent||'').replace(/\u00a0/g,' ');}
function visualText(element){return typeof element.value==='string'?element.value:(typeof element.innerText==='string'?element.innerText:element.textContent||'').replace(/\u00a0/g,' ');}
function visualOffset(raw,visible,offset){let cursor=0;for(let i=0;i<offset;i++){while(visible[cursor]==='\n'&&raw[i]!=='\n')cursor++;if(raw[i]!==visible[cursor])return null;cursor++;}return cursor;}
function rawOffset(raw,visible,offset){let cursor=0;for(let i=0;i<=raw.length;i++){while(cursor<offset&&visible[cursor]==='\n'&&raw[i]!=='\n')cursor++;if(cursor===offset)return i;if(i===raw.length||raw[i]!==visible[cursor])return null;cursor++;}return null;}
function offsetOf(element,node,offset){const doc=element.ownerDocument||root.document,range=doc.createRange();range.selectNodeContents(element);range.setEnd(node,offset);return range.toString().length;}
function atOffset(element,offset,forward=false){const doc=element.ownerDocument||root.document,walker=doc.createTreeWalker(element,4);let node,last;while((node=walker.nextNode())){last=node;if(offset<node.textContent.length||offset===node.textContent.length&&!forward)return{node,offset};offset-=node.textContent.length;}return last?{node:last,offset:last.textContent.length}:{node:element,offset:element.childNodes?.length||0};}
// BR sobrevive ao parser de editores estruturados; LF em um Text pode virar espaço.
function rangeText(node){
 if(node.nodeType===3)return node.data;
 if(node.nodeName==='BR')return node.classList?.contains('ProseMirror-trailingBreak')?'':'\n';
 return Array.from(node.childNodes||[],rangeText).join('');
}
function rangeOffset(element,node,offset){const range=(element.ownerDocument||root.document).createRange();range.selectNodeContents(element);range.setEnd(node,offset);return rangeText(range.cloneContents()).length;}
function atRangeOffset(element,offset,forward=false){
 const walker=(element.ownerDocument||root.document).createTreeWalker(element,5);let node,last;
 while((node=walker.nextNode())){
  if(node.nodeType!==3&&node.nodeName!=='BR')continue;
  const length=node.nodeType===3?node.length:rangeText(node).length;
  if(!length)continue;
  last=node;
  if(offset<length||offset===length&&!forward){
   if(node.nodeType===3)return{node,offset};
   return{node:node.parentNode,offset:Array.prototype.indexOf.call(node.parentNode.childNodes,node)+(offset?1:0)};
  }
  offset-=length;
 }
 return last?.nodeType===3?{node:last,offset:last.length}:{node:element,offset:element.childNodes.length};
}
function captureTarget(doc=root.document){let element=doc.activeElement;while(element?.shadowRoot?.activeElement)element=element.shadowRoot.activeElement;if(!editable(element)||element.getRootNode?.().host?.id==='ext-tts-stt-host')return null;const original=textOf(element),snapshot={element,document:doc,original,documentAlive:true};
 if(typeof element.value==='string'){snapshot.selectionStart=element.selectionStart;snapshot.selectionEnd=element.selectionEnd;}
 else{const selection=(doc.defaultView||root.window)?.getSelection(),range=selection?.rangeCount?selection.getRangeAt(0):null;if(!range||!element.contains(range.startContainer)||!element.contains(range.endContainer))return null;snapshot.originalVisual=visualText(element);snapshot.range=range.cloneRange();snapshot.startNode=range.startContainer;snapshot.endNode=range.endContainer;snapshot.selectionStart=offsetOf(element,range.startContainer,range.startOffset);snapshot.selectionEnd=offsetOf(element,range.endContainer,range.endOffset);}
 return snapshot;
}
function inputEvent(type,text){if(typeof root.InputEvent==='function')return new root.InputEvent(type,{bubbles:true,composed:true,cancelable:type==='beforeinput',inputType:'insertText',data:text});return new root.Event(type,{bubbles:true,cancelable:type==='beforeinput'});}
function replacementRange(previous,next){
 let start=0,end=0;
 while(start<previous.length&&start<next.length&&previous[start]===next[start])start++;
 if(start&&/[\uD800-\uDBFF]/.test(previous[start-1]))start--;
 while(end<previous.length-start&&end<next.length-start&&previous[previous.length-1-end]===next[next.length-1-end])end++;
 if(end&&/[\uDC00-\uDFFF]/.test(previous[previous.length-end]))end--;
 return {start,end:previous.length-end,text:next.slice(start,next.length-end)};
}
function settleEditor(doc,ms){
 if(doc?.visibilityState==='hidden'&&typeof root.MessageChannel==='function'){
  return new Promise(resolve=>{
   const {port1,port2}=new root.MessageChannel();
   port1.onmessage=()=>{port1.close();port2.close();resolve();};
   port2.postMessage(null);
  });
 }
 return new Promise(resolve=>setTimeout(resolve,ms));
}
class Insertion{
 constructor(target,{normalize=text=>String(text||''),settleMs=40}={}){
  const element=target?.element;
  Object.assign(this,{target,normalize,settleMs,applied:'',expected:target?.original??(element?textOf(element):''),
   expectedVisual:target?.originalVisual??(element?visualText(element):''),start:target?.selectionStart,end:target?.selectionEnd,
   invalidReason:null,writing:false,finalized:false,serial:Promise.resolve(),checkpoints:[]});
  this.textControl=typeof element?.value==='string';
  this.onBeforeInput=event=>{
   if(this.writing||!this.textControl)return;
   this.manual={start:element.selectionStart,end:element.selectionEnd,type:event.inputType};
  };
  this.onManual=event=>{
   if(this.writing)return;
   this.externalInputs=(this.externalInputs||0)+1;
   this.lastInputTrusted=event?.isTrusted;
   if(this.textControl)this.rebaseManual();
   else if(!this.rangeMatchesOwned(element))this.invalidate('TARGET_CHANGED');
  };
  element?.addEventListener?.('beforeinput',this.onBeforeInput);
  element?.addEventListener?.('input',this.onManual);
 }
 invalidate(reason='TARGET_DOCUMENT_LOST'){this.invalidReason=reason;}
 dispose(){
  this.target?.element?.removeEventListener?.('beforeinput',this.onBeforeInput);
  this.target?.element?.removeEventListener?.('input',this.onManual);
 }
 apply(rawText,{final=false,isCurrent=()=>true,editorTrace}={}){
  const run=this.serial.then(async()=>{
   if(!isCurrent())return{inserted:false,reason:'SUPERSEDED'};
   if(editorTrace)editorTrace.before=this.editorSnapshot();
   try{return await this.perform(rawText,final,isCurrent);}
   finally{if(editorTrace)editorTrace.after=this.editorSnapshot();}
  });
  this.serial=run.catch(()=>{});
  return run;
 }
 editorSnapshot(){
  try{
   const {element,document:doc,range}=this.target;
   let active=doc?.activeElement;
   while(active?.shadowRoot?.activeElement)active=active.shadowRoot.activeElement;
   const snapshot={
    kind:this.textControl?(element.tagName==='INPUT'?'input':'textarea'):'contenteditable',
    connected:element.isConnected!==false,editable:editable(element),focused:active===element,
    fieldCharacters:textOf(element).length,fieldLineBreaks:(visualText(element).match(/\n/g)||[]).length,ownedCharacters:this.applied.length,hasOwned:!!this.hasOwned,
    writes:this.editorWrites||0,rebinds:this.editorRebinds||0,externalInputs:this.externalInputs||0,
    lastInputTrusted:this.lastInputTrusted,invalidReason:this.invalidReason
   };
   if(this.textControl){
    return {...snapshot,valueMatches:element.value===this.expected,ownedStart:this.start,ownedEnd:this.end,
     ownedMatches:!!this.hasOwned&&element.value.slice(this.start,this.end)===this.applied,
     selectionStart:element.selectionStart,selectionEnd:element.selectionEnd};
   }
   const selection=doc?.defaultView?.getSelection?.(),selectionRange=selection?.rangeCount?selection.getRangeAt(0):null;
   const inside=part=>!!part&&element.contains(part.startContainer)&&element.contains(part.endContainer);
   const rangeAttached=inside(range),selectionInside=inside(selectionRange);
   return {...snapshot,rangeAttached,selectionInside,singleTextNode:rangeAttached&&range.startContainer===range.endContainer&&range.startContainer.nodeType===3,
    ownedStart:rangeAttached?range.startOffset:undefined,ownedEnd:rangeAttached?range.endOffset:undefined,
    ownedMatches:rangeAttached&&this.hasOwned&&range.toString()===this.applied,
    selectionStart:selectionInside?selectionRange.startOffset:undefined,selectionEnd:selectionInside?selectionRange.endOffset:undefined,
    selectionCollapsed:selectionInside?selectionRange.collapsed:undefined};
  }catch{return undefined;}
 }
 rebaseManual(){
  const actual=this.target.element.value,previous=this.expected,selection=this.manual;
  this.manual=null;
  if(actual===previous||this.invalidReason)return;
  if(!selection)return this.invalidate('TARGET_CHANGED');
  let {start,end,type}=selection;
  if(start===end&&actual.length<previous.length){
   const removed=previous.length-actual.length;
   if(type?.endsWith('Backward'))start-=removed;
   else if(type?.endsWith('Forward'))end+=removed;
  }
  const delta=actual.length-previous.length;
  if(start<0||end>previous.length||end+delta<start||actual.slice(0,start)!==previous.slice(0,start)||
     actual.slice(end+delta)!==previous.slice(end))return this.invalidate('TARGET_CHANGED');
  if(end<=this.start){this.start+=delta;this.end+=delta;}
  else if(start<this.end)return this.invalidate('TARGET_CHANGED');
  this.expected=actual;
  this.checkpoints=[];
 }
 checkpoint(){
  this.checkpoints.push({expected:this.expected,applied:this.applied,start:this.start,end:this.end,currentText:this.currentText,hasOwned:this.hasOwned});
  if(this.checkpoints.length>8)this.checkpoints.splice(1,1);
 }
 restoreCheckpoint(actual){
  const index=this.checkpoints.findLastIndex(checkpoint=>checkpoint.expected===actual);
  if(index>=0){
   Object.assign(this,this.checkpoints[index]);
   this.checkpoints.splice(index);
   return true;
  }
  if(!this.hasOwned)return false;
  const prefix=this.expected.slice(0,this.start),suffix=this.expected.slice(this.end);
  if(actual.length<prefix.length+suffix.length||!actual.startsWith(prefix)||!actual.endsWith(suffix))return false;
  const retained=actual.slice(prefix.length,actual.length-suffix.length);
  if(retained.length>=this.applied.length||!this.applied.startsWith(retained))return false;
  Object.assign(this,{expected:actual,applied:retained,end:this.start+retained.length});
  return true;
 }
 async performControl(text,final,element,doc){
  const actual=element.value;
  if(actual!==this.expected&&!this.restoreCheckpoint(actual))return{inserted:false,reason:'TARGET_CHANGED'};
  if(!text&&!this.hasOwned)return{inserted:false,reason:'EMPTY_TEXT'};
  const previous=actual.slice(this.start,this.end);
  this.spacer??=this.start>0&&!/\s$/.test(actual.slice(0,this.start))&&text?' ':'';
  const owned=text?this.spacer+text:'';
  const unchanged=previous===owned&&this.hasOwned;
  if(unchanged&&!final){
   this.currentText=text;
   return{inserted:true,reason:'UNCHANGED',characters:text.length};
  }
  this.writing=true;
  try{
   if(!unchanged){
    const patch=replacementRange(previous,owned),start=this.start+patch.start,end=this.start+patch.end;
    const value=actual.slice(0,start)+patch.text+actual.slice(end);
    if(element.dispatchEvent(inputEvent('beforeinput',patch.text))===false)return{inserted:false,reason:'EDITOR_REJECTED'};
    if(element.value!==actual)return{inserted:false,reason:'TARGET_CHANGED'};
    if(typeof element.setRangeText==='function')element.setRangeText(patch.text,start,end,'preserve');
    else element.value=value;
    this.editorWrites=(this.editorWrites||0)+1;
    this.checkpoint();
    Object.assign(this,{expected:value,applied:owned,end:this.start+owned.length,hasOwned:true});
    element.dispatchEvent(inputEvent('input',patch.text));
   }
   this.currentText=text;
   if(final)element.dispatchEvent(new root.Event('change',{bubbles:true}));
  }finally{this.writing=false;}
  if(element.value===this.expected)await settleEditor(doc,this.settleMs);
  if(this.invalidReason||!editable(element))return{inserted:false,reason:this.invalidReason||'TARGET_REMOVED'};
  if(element.value!==this.expected)return{inserted:false,reason:'EDITOR_REVERTED'};
  if(final)this.finalized=true;
  return{inserted:true,reason:unchanged?'UNCHANGED':'INSERTED',characters:text.length};
 }
 rangeMatchesOwned(element){
  const range=this.target.range,node=range?.startContainer;
  if(!this.hasOwned||!node)return false;
  if(!this.applied)return range.collapsed&&element.contains(node);
  if(node.nodeType===3&&node===range.endContainer&&element.contains(node)&&
     node.data.slice(range.startOffset,range.endOffset)===this.applied)return true;
  if(element.contains(node)&&element.contains(range.endContainer)&&rangeText(range.cloneContents())===this.applied)return true;
  // O editor pode substituir o nó mesmo quando aceita toda a escrita.
  const saved=this.rangeCheckpoint;
  if(!saved||rangeText(element)!==saved.value)return false;
  const anchor=atRangeOffset(element,saved.offset,true),end=atRangeOffset(element,saved.offset+this.applied.length);
  const rebound=range.cloneRange();
  rebound.setStart(anchor.node,anchor.offset);
  rebound.setEnd(end.node,end.offset);
  if(rangeText(rebound.cloneContents())!==this.applied)return false;
  range.setStart(rebound.startContainer,rebound.startOffset);
  range.setEnd(rebound.endContainer,rebound.endOffset);
  this.editorRebinds=(this.editorRebinds||0)+1;
  return true;
 }
 async performRange(text,final,element,doc){
  const range=this.target.range;
  const validRange=()=>this.hasOwned?this.rangeMatchesOwned(element):
   textOf(element)===this.expected&&range.startContainer===this.target.startNode&&range.endContainer===this.target.endNode&&
    element.contains(range.startContainer)&&element.contains(range.endContainer);
  if(!text&&!this.hasOwned)return{inserted:false,reason:'EMPTY_TEXT'};
  if(!validRange())return{inserted:false,reason:'TARGET_CHANGED'};
  this.spacer??=this.start>0&&!/\s$/.test(this.expected.slice(0,this.start))&&text?' ':'';
  const owned=text?this.spacer+text:'';
  if(this.hasOwned&&this.applied===owned){
   if(final)this.finalized=true;
   return{inserted:true,reason:'UNCHANGED',characters:text.length};
  }
  const patch=this.hasOwned?replacementRange(this.applied,owned):{text:owned};
  this.writing=true;
  try{
   if(element.dispatchEvent(inputEvent('beforeinput',patch.text))===false)return{inserted:false,reason:'EDITOR_REJECTED'};
   if(!validRange())return{inserted:false,reason:'TARGET_CHANGED'};
   let node=range.startContainer,start=range.startOffset;
   if(this.hasOwned&&node.nodeType===3&&node===range.endContainer&&!owned.includes('\n')){
    node.replaceData(start+patch.start,patch.end-patch.start,patch.text);
   }else{
    const fragment=doc.createDocumentFragment(),lines=owned.split('\n');
    lines.forEach((line,index)=>{if(index)fragment.append(doc.createElement('br'));fragment.append(doc.createTextNode(line));});
    node=fragment.firstChild;
    const last=fragment.lastChild;
    range.deleteContents();
    range.insertNode(fragment);
    start=0;
    range.setStart(node,0);
    range.setEnd(last,last.length);
   }
   if(!owned.includes('\n')){
    range.setStart(node,start);
    range.setEnd(node,start+owned.length);
   }
   // O Range acompanha o intervalo quando o editor mescla nós de texto adjacentes.
   this.rangeCheckpoint={offset:rangeOffset(element,node,start),value:rangeText(element)};
   this.editorWrites=(this.editorWrites||0)+1;
   this.hasOwned=true;
   this.applied=owned;
   this.currentText=text;
   element.dispatchEvent(inputEvent('input',patch.text));
  }finally{this.writing=false;}
  await settleEditor(doc,this.settleMs);
  if(this.invalidReason||!editable(element)||!this.rangeMatchesOwned(element)){
   return{inserted:false,reason:this.invalidReason||(!editable(element)?'TARGET_REMOVED':'EDITOR_REVERTED')};
  }
  if(final)this.finalized=true;
  return{inserted:true,reason:'INSERTED',characters:text.length};
 }
 async perform(rawText,final,isCurrent){const text=this.normalize(rawText),target=this.target,element=target?.element,doc=target?.document||element?.ownerDocument||root.document;
  if(this.finalized)return{inserted:this.currentText===text,reason:this.currentText===text?'ALREADY_INSERTED':'FINAL_ALREADY_APPLIED'};
  if(this.invalidReason)return{inserted:false,reason:this.invalidReason};
  if(!editable(element))return{inserted:false,reason:'TARGET_REMOVED'};
  if(target?.document&&element.ownerDocument&&element.ownerDocument!==target.document)return{inserted:false,reason:'TARGET_DOCUMENT_LOST'};
  if(this.textControl){
   const result=await this.performControl(text,final,element,doc);
   if(result.reason!=='EDITOR_REVERTED'||this.invalidReason||!editable(element))return result;
   const restored=this.restoreCheckpoint(element.value);
   // Só refaça a revisão final quando o valor do campo ainda corresponde ao job.
   if(final&&restored&&isCurrent())return this.performControl(text,final,element,doc);
   return result;
  }
  if(target.range)return this.performRange(text,final,element,doc);
  if(textOf(element)!==this.expected||visualText(element)!==this.expectedVisual){this.invalidReason='TARGET_CHANGED';return{inserted:false,reason:this.invalidReason};}
  if(this.currentText===text&&this.applied!==''){if(final)this.finalized=true;return{inserted:true,reason:'UNCHANGED'};}
  if(!text&&!this.applied)return{inserted:false,reason:'EMPTY_TEXT'};
  const original=this.expected,start=this.start??target?.selectionStart??0,end=this.applied?start+this.applied.length:(this.end??start),prefix=original.slice(0,start),suffix=original.slice(end);
  if(this.spacer===undefined)this.spacer=prefix&&!/\s$/.test(prefix)&&text?' ':'';const owned=this.spacer+text,value=prefix+owned+suffix;
  let expectedVisual=value,editStart=start,editEnd=end,replacement=owned;if(typeof element.value!=='string'){const visible=visualText(element),from=visualOffset(original,visible,start),to=visualOffset(original,visible,end);if(from===null||to===null)return{inserted:false,reason:'TARGET_SELECTION_LOST'};expectedVisual=visible.slice(0,from)+owned+visible.slice(to);
   // Edite somente a diferença pertencente ao ditado. Recriar parágrafos já iguais com
   // execCommand pode consumir o espaço do sufixo e desnecessariamente alterar marcação.
   if(this.applied){const previous=visible.slice(from,to);let commonStart=0,commonEnd=0;while(commonStart<previous.length&&commonStart<owned.length&&previous[commonStart]===owned[commonStart])commonStart++;if(commonStart&&/[\uD800-\uDBFF]/.test(previous[commonStart-1]))commonStart--;while(commonEnd<previous.length-commonStart&&commonEnd<owned.length-commonStart&&previous[previous.length-1-commonEnd]===owned[owned.length-1-commonEnd])commonEnd++;if(commonEnd&&/[\uDC00-\uDFFF]/.test(previous[previous.length-commonEnd]))commonEnd--;const removed=previous.slice(commonStart,previous.length-commonEnd),added=owned.slice(commonStart,owned.length-commonEnd);if(!removed.includes('\n')){const a=rawOffset(original,visible,from+commonStart),b=rawOffset(original,visible,to-commonEnd);if(a!==null&&b!==null){editStart=a;editEnd=b;replacement=added;}}}
  }
  const previousFocus=doc.activeElement,previousCursor=previousFocus&&previousFocus!==element&&typeof previousFocus.selectionStart==='number'?{start:previousFocus.selectionStart,end:previousFocus.selectionEnd}:null;
  const selectionBefore=(doc.defaultView||root.window)?.getSelection?.(),previousRange=previousFocus!==element&&selectionBefore?.rangeCount?selectionBefore.getRangeAt(0).cloneRange():null;
  this.writing=true;
  try{
   element.focus?.({preventScroll:true});
   if(typeof element.value==='string'){element.setSelectionRange?.(start,end);element.selectionStart=start;element.selectionEnd=end;}
   else{const selection=(doc.defaultView||root.window)?.getSelection(),a=atOffset(element,editStart,true),b=editStart===editEnd?a:atOffset(element,editEnd),range=doc.createRange();range.setStart(a.node,a.offset);range.setEnd(b.node,b.offset);selection?.removeAllRanges();selection?.addRange(range);}
   const before=inputEvent('beforeinput',replacement);if(element.dispatchEvent(before)===false)return{inserted:false,reason:'EDITOR_REJECTED'};
   let command=false;if(typeof doc.execCommand==='function')command=doc.execCommand('insertText',false,replacement)===true;
   if(!command&&textOf(element)===original){
    if(typeof element.value==='string'){const prototype=element.tagName==='TEXTAREA'?root.HTMLTextAreaElement?.prototype:root.HTMLInputElement?.prototype;let setter=Object.getOwnPropertyDescriptor(prototype||{},'value')?.set;if(!setter&&root.HTMLTextAreaElement&&element instanceof root.HTMLTextAreaElement)setter=Object.getOwnPropertyDescriptor(root.HTMLTextAreaElement.prototype,'value')?.set;if(setter)setter.call(element,value);else element.value=value;}
    else{const selection=(doc.defaultView||root.window)?.getSelection(),range=selection?.rangeCount?selection.getRangeAt(0):null;if(!range||!element.contains(range.startContainer)||!element.contains(range.endContainer))return{inserted:false,reason:'TARGET_SELECTION_LOST'};range.deleteContents();const node=doc.createTextNode(replacement);range.insertNode(node);range.setStartAfter(node);range.collapse(true);selection.removeAllRanges();selection.addRange(range);}
    element.dispatchEvent(inputEvent('input',replacement));
   }
   if(typeof element.value==='string'){element.selectionStart=element.selectionEnd=start+owned.length;element.dispatchEvent(new root.Event('change',{bubbles:true}));}
  }finally{this.writing=false;if(previousFocus&&previousFocus!==element&&previousFocus.isConnected!==false){previousFocus.focus?.({preventScroll:true});if(previousCursor){previousFocus.selectionStart=previousCursor.start;previousFocus.selectionEnd=previousCursor.end;}else if(previousRange){const selection=(doc.defaultView||root.window)?.getSelection?.();selection?.removeAllRanges();selection?.addRange(previousRange);}}}
  // Frameworks may revert a DOM mutation in their next render. Check both immediate and deferred value.
  const persisted=()=>typeof element.value==='string'?textOf(element)===value:visualText(element)===expectedVisual;
  if(!persisted()){this.invalidReason='EDITOR_REVERTED';return{inserted:false,reason:this.invalidReason};}
  await new Promise(resolve=>setTimeout(resolve,this.settleMs));
  if(this.invalidReason||!editable(element)||!persisted()){this.invalidReason=this.invalidReason||(!editable(element)?'TARGET_REMOVED':'EDITOR_REVERTED');return{inserted:false,reason:this.invalidReason};}
  const actual=textOf(element);if(!actual.startsWith(prefix)||!actual.endsWith(suffix)){this.invalidReason='EDITOR_REVERTED';return{inserted:false,reason:this.invalidReason};}
  this.expected=actual;this.expectedVisual=visualText(element);this.applied=actual.slice(start,actual.length-suffix.length);this.currentText=text;this.end=start+this.applied.length;if(final)this.finalized=true;return{inserted:true,reason:'INSERTED',characters:text.length};
 }
}
// Um destino lógico e vários intervalos de escrita ao longo da mesma captura.
// O transcript completo pertence ao card. Texto enviado/editado deixa de pertencer ao escritor.
class SessionInsertion{
 constructor(target,options={}){
  this.target=target;this.options=options;this.doc=target?.document||target?.element?.ownerDocument;
  this.writer=new Insertion(target,options);this.serial=Promise.resolve();this.epoch=0;
  this.seen='';this.meta={};this.sealed='';this.consumedSequence=0;this.removers=[];
  const element=target?.element;
  const identity=['id','name','data-testid','aria-label'].filter(key=>element?.getAttribute?.(key));
  this.signature=element?{tag:element.tagName,attributes:[...(identity.length?identity:['class']),'role','type'].map(key=>[key,this.attribute(element,key)])}:null;
  this.anchors=[];
  for(let parent=element?.parentElement,depth=0;parent&&parent!==this.doc?.body&&depth<5;parent=parent.parentElement,depth++)this.anchors.push(parent);
  if(!this.anchors.length&&identity.length&&this.doc?.body)this.anchors.push(this.doc.body);
  this.bindManual(element);
  if(this.doc?.nodeType===9){
   const listen=(type,fn)=>{this.doc.addEventListener(type,fn,true);this.removers.push(()=>this.doc.removeEventListener(type,fn,true));};
   listen('keydown',event=>{
    const field=this.target.element;
    if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&(event.target===field||field.contains(event.target)))this.armSend();
   });
   listen('submit',event=>{if(event.target===this.form())this.armSend();});
   listen('beforeinput',event=>{const field=this.candidate();if(field&&(event.target===field||field.contains(event.target)))this.refresh();});
   listen('click',event=>{
    const control=event.target.closest?.('button,input[type="submit"],[role="button"]');
    const scope=this.form()||this.anchors.find(node=>node.isConnected&&node.contains(control));
    if(!control||!scope?.contains(control))return;
    const label=[control.getAttribute('aria-label'),control.getAttribute('title'),control.textContent].filter(Boolean).join(' ').trim();
    this.armSend(control.form===this.form()&&control.type==='submit'||/^(?:send|enviar|submit)(?:\s|$)/i.test(label)?'send':'edit');
   });
   if(typeof root.MutationObserver==='function'){
    this.observer=new root.MutationObserver(()=>{if(!this.disposed&&!this.invalidReason)this.refresh();});
    const anchor=this.anchors.at(-1)||element?.parentElement;
    if(anchor)this.observer.observe(anchor,{subtree:true,childList:true,characterData:true});
   }
  }
  this.lastDraft=this.read(element);
 }
 get settleMs(){return this.writer.settleMs;}
 set settleMs(value){this.options.settleMs=value;this.writer.settleMs=value;}
 attribute(element,key){const value=element.getAttribute?.(key)||'';return key==='class'?value.split(/\s+/).filter(token=>token&&!['ProseMirror-focused','ProseMirror-hideselection'].includes(token)).join(' '):value;}
 form(){return this.target.element?.closest?.('form')||null;}
 read(element=this.target.element){return element?(typeof element.value==='string'?element.value:rangeText(element)):'';}
 clearPending(){this.pending=null;clearTimeout(this.poll);this.poll=null;}
 armSend(kind='send'){
  if(this.disposed||this.invalidReason||!this.read().trim())return;
  this.clearPending();
  this.pending={element:this.target.element,value:this.read(),kind};
  // A ação precisa efetivamente esvaziar/recriar o editor. Enter isolado não é envio.
  Promise.resolve().then(()=>this.refresh());
  let checks=0;
  const poll=()=>{if(!this.pending||this.disposed)return;this.refresh();if(this.pending&&++checks<100)this.poll=setTimeout(poll,100);};
  this.poll=setTimeout(poll,100);
 }
 bindManual(element){
  this.unbindManual?.();
  const before=event=>{
   if(this.writer.writing)return;
   // Edição normal, inclusive Enter de parágrafo e exclusão manual, não confirma envio.
   this.clearPending();
   const writer=this.writer,selected=this.doc?.defaultView?.getSelection?.();
   this.manualAtEdge=writer.hasOwned&&(writer.textControl?element.selectionStart===writer.end:
    selected?.rangeCount&&element.contains(selected.getRangeAt(0).startContainer)&&rangeOffset(element,selected.getRangeAt(0).startContainer,selected.getRangeAt(0).startOffset)===writer.rangeCheckpoint?.offset+writer.applied.length);
  };
  const input=()=>{
   if(this.writer.writing||this.disposed||this.invalidReason)return;
   this.refresh();
   this.clearPending();
   if(this.manualAtEdge||this.writer.invalidReason||!this.writer.textControl&&!this.writer.rangeMatchesOwned(element))this.protectManual();
   this.manualAtEdge=false;
   this.lastDraft=this.read();
  };
  element?.addEventListener?.('beforeinput',before);
  element?.addEventListener?.('input',input);
  this.unbindManual=()=>{element?.removeEventListener?.('beforeinput',before);element?.removeEventListener?.('input',input);};
 }
 pointTarget(element,{start,end=start,caret=false}={}){
  const doc=this.doc,original=textOf(element);
  if(typeof element.value==='string'){
   start??=caret&&typeof element.selectionEnd==='number'?element.selectionEnd:element.value.length;
   return{element,document:doc,original,selectionStart:start,selectionEnd:end??start};
  }
  const selection=doc.defaultView?.getSelection?.(),selected=selection?.rangeCount?selection.getRangeAt(0):null;
  let range;
  if(caret&&selected&&element.contains(selected.endContainer)){range=selected.cloneRange();range.collapse(false);}
  else{const a=atRangeOffset(element,start??rangeText(element).length,true),b=atRangeOffset(element,end??start??rangeText(element).length);range=doc.createRange();range.setStart(a.node,a.offset);range.setEnd(b.node,b.offset);}
  return{element,document:doc,original,originalVisual:visualText(element),range,startNode:range.startContainer,endNode:range.endContainer,
   selectionStart:rangeOffset(element,range.startContainer,range.startOffset),selectionEnd:rangeOffset(element,range.endContainer,range.endOffset)};
 }
 replaceWriter(target){
  this.epoch++;this.writer.invalidate('SUPERSEDED');this.writer.dispose();
  Object.assign(this.target,target);
  this.writer=new Insertion(target,this.options);
  this.bindManual(target.element);
 }
 protectManual(){
  const seal=!this.manualProtected||this.writer.hasOwned;
  if(seal){
   this.sealed=this.seen;
   this.manualSequence=Number.isSafeInteger(this.meta.sequence)?this.meta.sequence:0;
   const consume=value=>{if(Number.isSafeInteger(value)&&value>0)this.manualCutSequence=Math.max(this.manualCutSequence||0,value);};
   const cut=this.options.onManual?.();
   if(cut?.then)this.cutPending=Promise.resolve(cut).then(consume,()=>{this.boundaryError=true;});
   else consume(cut);
  }
  this.manualProtected=true;
  this.replaceWriter(this.pointTarget(this.target.element,{caret:true}));
 }

 candidate(){
  if(this.target.element?.isConnected!==false)return this.target.element;
  const {tag,attributes}=this.signature||{};
  if(!attributes?.some(([,value])=>value))return null;
  for(const anchor of this.anchors){
   if(!anchor.isConnected)continue;
   const matches=Array.from(anchor.querySelectorAll('input,textarea,[contenteditable="true"],[contenteditable=""],[contenteditable="plaintext-only"]')).filter(element=>
    editable(element)&&element.tagName===tag&&attributes.every(([key,value])=>this.attribute(element,key)===value));
   if(matches.length===1)return matches[0];
   if(matches.length>1)return null;
  }
  return null;
 }
 refresh(){
  if(this.disposed||this.invalidReason)return;
  const previous=this.target.element,element=this.candidate();
  if(!element)return;
  const value=this.read(element);
  if(this.pending&&this.pending.value.trim()&&!value.trim()){
   // Limpeza observada após a ação: não inicia captura nem envia mensagens por conta própria.
   const kind=this.pending.kind;
   this.clearPending();
   if(kind==='edit'){this.replaceWriter(this.pointTarget(element,{start:0}));this.protectManual();this.lastDraft=value;return;}
   this.sealed=this.seen;this.manualProtected=false;this.manualSequence=0;this.manualCutSequence=0;
   const sequence=this.options.onSend?.();
   const consume=value=>{if(Number.isSafeInteger(value)&&value>0)this.consumedSequence=Math.max(this.consumedSequence,value);};
   if(sequence?.then){
    this.cutPending=Promise.resolve(sequence).then(consume,()=>{this.boundaryError=true;});
   }else consume(sequence);
   if(Number.isSafeInteger(this.meta.sequence))consume(this.meta.sequence);
   this.replaceWriter(this.pointTarget(element,{start:0}));
   this.lastDraft=value;this.sentSegments=(this.sentSegments||0)+1;return;
  }
  if(element!==previous){
   if(value!==this.lastDraft){
    // Mesmo editor lógico, rascunho diferente: protege tudo e retoma só a fala nova.
    this.replaceWriter(this.pointTarget(element));this.protectManual();this.lastDraft=value;return;
   }
   const old=this.writer;
   const start=old.textControl?old.start:old.rangeCheckpoint?.offset??this.target.selectionStart;
   const end=old.hasOwned?start+old.applied.length:this.target.selectionEnd;
   const target=this.pointTarget(element,{start,end});
   this.replaceWriter(target);
   if(old.hasOwned){
    Object.assign(this.writer,{hasOwned:true,applied:old.applied,currentText:old.currentText,spacer:old.spacer,expected:old.expected,start,end});
    if(!old.textControl)this.writer.rangeCheckpoint={offset:start,value};
   }
  }
 }
 invalidate(reason='TARGET_DOCUMENT_LOST'){this.invalidReason=reason;this.writer.invalidate(reason);this.clearPending();}
 dispose(){this.disposed=true;this.epoch++;this.writer.invalidate('CANCELLED');this.clearPending();this.observer?.disconnect();this.unbindManual?.();for(const remove of this.removers)remove();this.writer.dispose();}
 editorSnapshot(){return this.writer.editorSnapshot();}
 apply(rawText,options={}){
  const run=this.serial.then(()=>this.perform(String(rawText||''),options));
  this.serial=run.catch(()=>{});return run;
 }
 async perform(text,options){
  const {final=false,isCurrent=()=>true}=options;
  if(!isCurrent())return{inserted:false,reason:'SUPERSEDED'};
  if(this.invalidReason||this.disposed)return{inserted:false,reason:this.invalidReason||'CANCELLED'};
  this.refresh();
  if(this.cutPending){const pending=this.cutPending;await pending;if(this.cutPending===pending)this.cutPending=null;}
  if(!isCurrent()||this.disposed||this.invalidReason)return{inserted:false,reason:this.invalidReason||'SUPERSEDED'};
  if(this.boundaryError)return{inserted:false,reason:'AUDIO_BOUNDARY_UNCONFIRMED'};
  if(!editable(this.target.element))return{inserted:false,reason:'TARGET_REMOVED'};
  let offset=0;
  if(this.consumedSequence){
   const boundaries=options.textBoundaries;
   if(Array.isArray(boundaries)&&boundaries.length){
    const consumed=boundaries.filter(([sequence])=>sequence<=this.consumedSequence).at(-1);
    if(boundaries.at(-1)[0]<this.consumedSequence){this.seen=text;this.meta=options;return{inserted:true,reason:'SEGMENT_SENT',characters:0};}
    offset=consumed?.[1]||0;
   }else if(this.sealed&&text.startsWith(this.sealed))offset=this.sealed.length;
   else{this.seen=text;this.meta=options;return{inserted:true,reason:'SEGMENT_SENT',characters:0};}
  }
  if(this.manualProtected){
   if(this.manualCutSequence){
    const boundaries=options.textBoundaries;
    if(!boundaries?.length||boundaries.at(-1)[0]<this.manualCutSequence){this.seen=text;this.meta=options;return{inserted:false,reason:'MANUAL_EDIT_PRESERVED'};}
    offset=Math.max(offset,boundaries.filter(([sequence])=>sequence<=this.manualCutSequence).at(-1)?.[1]||0);
   }else if(text.startsWith(this.sealed))offset=Math.max(offset,this.sealed.length);
   else{
    const boundary=options.textBoundaries?.find(([sequence])=>sequence===this.manualSequence);
    if(!boundary){this.seen=text;this.meta=options;return{inserted:false,reason:'MANUAL_EDIT_PRESERVED'};}
    offset=Math.max(offset,boundary[1]);this.sealed=text.slice(0,offset);
   }
  }
  const epoch=this.epoch,fragment=text.slice(offset).trimStart();
  this.seen=text;this.meta=options;
  if(!fragment&&!this.writer.hasOwned)return{inserted:!this.manualProtected,reason:this.manualProtected?'MANUAL_EDIT_PRESERVED':this.consumedSequence?'SEGMENT_SENT':'EMPTY_TEXT',characters:0};
  const result=await this.writer.apply(fragment,{...options,isCurrent:()=>epoch===this.epoch&&isCurrent()});
  if(this.disposed||this.invalidReason)return{inserted:false,reason:this.invalidReason||'CANCELLED'};
  if(!isCurrent())return{inserted:false,reason:'SUPERSEDED'};
  if(epoch!==this.epoch)return{inserted:!this.manualProtected,reason:this.manualProtected?'MANUAL_EDIT_PRESERVED':'SEGMENT_SENT',characters:0};
  this.lastDraft=this.read();
  if(result.reason==='TARGET_CHANGED'&&!this.writer.invalidReason){
   // Uma edição programática sem input é preservada, nunca confundida com rollback/envio.
   this.protectManual();return{inserted:false,reason:'MANUAL_EDIT_PRESERVED'};
  }
  return result;
 }
}

return{AudioQueue,ACK_TIMEOUT_MS,timeout,watchCapture,captureTarget,Insertion,SessionInsertion,textOf};
});
