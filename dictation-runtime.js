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
function editable(element){return Boolean(element&&element.isConnected!==false&&!element.disabled&&!element.readOnly&&(element.isContentEditable||typeof element.value==='string'&&typeof element.selectionStart==='number'));}
// Chromium preserva espaços visuais do contenteditable usando NBSP ao editar. Não é reversão do editor.
function textOf(element){return typeof element.value==='string'?element.value:(element.textContent||'').replace(/\u00a0/g,' ');}
function visualText(element){return typeof element.value==='string'?element.value:(typeof element.innerText==='string'?element.innerText:element.textContent||'').replace(/\u00a0/g,' ');}
function visualOffset(raw,visible,offset){let cursor=0;for(let i=0;i<offset;i++){while(visible[cursor]==='\n'&&raw[i]!=='\n')cursor++;if(raw[i]!==visible[cursor])return null;cursor++;}return cursor;}
function rawOffset(raw,visible,offset){let cursor=0;for(let i=0;i<=raw.length;i++){while(cursor<offset&&visible[cursor]==='\n'&&raw[i]!=='\n')cursor++;if(cursor===offset)return i;if(i===raw.length||raw[i]!==visible[cursor])return null;cursor++;}return null;}
function offsetOf(element,node,offset){const doc=element.ownerDocument||root.document,range=doc.createRange();range.selectNodeContents(element);range.setEnd(node,offset);return range.toString().length;}
function atOffset(element,offset,forward=false){const doc=element.ownerDocument||root.document,walker=doc.createTreeWalker(element,4);let node,last;while((node=walker.nextNode())){last=node;if(offset<node.textContent.length||offset===node.textContent.length&&!forward)return{node,offset};offset-=node.textContent.length;}return last?{node:last,offset:last.textContent.length}:{node:element,offset:element.childNodes?.length||0};}
function captureTarget(doc=root.document){let element=doc.activeElement;while(element?.shadowRoot?.activeElement)element=element.shadowRoot.activeElement;if(!editable(element)||element.getRootNode?.().host?.id==='ext-tts-stt-host')return null;const original=textOf(element),snapshot={element,document:doc,original,documentAlive:true};
 if(typeof element.value==='string'){snapshot.selectionStart=element.selectionStart;snapshot.selectionEnd=element.selectionEnd;}
 else{const selection=(doc.defaultView||root.window)?.getSelection(),range=selection?.rangeCount?selection.getRangeAt(0):null;if(!range||!element.contains(range.startContainer)||!element.contains(range.endContainer))return null;snapshot.originalVisual=visualText(element);snapshot.range=range.cloneRange();snapshot.selectionStart=offsetOf(element,range.startContainer,range.startOffset);snapshot.selectionEnd=offsetOf(element,range.endContainer,range.endOffset);}
 return snapshot;
}
function inputEvent(type,text){if(typeof root.InputEvent==='function')return new root.InputEvent(type,{bubbles:true,composed:true,cancelable:type==='beforeinput',inputType:'insertText',data:text});return new root.Event(type,{bubbles:true,cancelable:type==='beforeinput'});}
class Insertion{
 constructor(target,{normalize=text=>String(text||''),settleMs=40}={}){this.target=target;this.normalize=normalize;this.settleMs=settleMs;this.applied='';this.expected=target?.original??(target?.element?textOf(target.element):'');this.expectedVisual=target?.originalVisual??(target?.element?visualText(target.element):'');this.start=target?.selectionStart;this.end=target?.selectionEnd;this.invalidReason=null;this.writing=false;this.finalized=false;this.serial=Promise.resolve();this.onManual=()=>{if(!this.writing)this.invalidReason='TARGET_CHANGED';};target?.element?.addEventListener?.('input',this.onManual);}
 invalidate(reason='TARGET_DOCUMENT_LOST'){this.invalidReason=reason;}
 dispose(){this.target?.element?.removeEventListener?.('input',this.onManual);}
 apply(rawText,{final=false}={}){const run=this.serial.then(()=>this.perform(rawText,final));this.serial=run.catch(()=>{});return run;}
 async perform(rawText,final){const text=this.normalize(rawText),target=this.target,element=target?.element,doc=target?.document||element?.ownerDocument||root.document;
  if(this.finalized)return{inserted:this.currentText===text,reason:this.currentText===text?'ALREADY_INSERTED':'FINAL_ALREADY_APPLIED'};
  if(this.invalidReason)return{inserted:false,reason:this.invalidReason};
  if(!editable(element))return{inserted:false,reason:'TARGET_REMOVED'};
  if(target?.document&&element.ownerDocument&&element.ownerDocument!==target.document)return{inserted:false,reason:'TARGET_DOCUMENT_LOST'};
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
return{AudioQueue,ACK_TIMEOUT_MS,timeout,captureTarget,Insertion,textOf};
});
