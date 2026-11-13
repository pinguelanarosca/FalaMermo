(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.DualVad=api;})(globalThis,()=>{
'use strict';
class TemporalAgreement {
 constructor(){this.silero=[];this.ten=[];this.confirmations=0;this.rejections=0;}
 push(silero,ten){this.silero.push(...silero);this.ten.push(...ten);const matches=[];
  for(const s of this.silero)for(const t of this.ten)if(!s.confirmed&&s.probability>=.5&&t.probability>=.5&&Math.max(s.start,t.start)<Math.min(s.end,t.end)){s.confirmed=true;matches.push({start:Math.max(s.start,t.start),end:Math.min(s.end,t.end),silero:s.probability,ten:t.probability});this.confirmations++;}
  const end=Math.max(0,...silero.map(f=>f.end),...ten.map(f=>f.end));
  this.silero=this.silero.filter(f=>f.end>end-1024);this.ten=this.ten.filter(f=>f.end>end-1024);
  if(!matches.length)this.rejections++;
  return matches;
 }
}
class TenCapture {
 constructor(module){this.module=module;this.pending=new Int16Array(256);this.count=0;this.samples=0;this.handle=module._malloc(4);this.input=module._malloc(512);this.probability=module._malloc(4);this.flag=module._malloc(4);module.HEAP32[this.handle>>2]=0;if(module._ten_vad_create(this.handle,256,.5)!==0){this.close();throw Error('TEN create falhou.');}}
 infer(count){const m=this.module;if(count<256)this.pending.fill(0,count);m.HEAP16.set(this.pending,this.input>>1);if(m._ten_vad_process(m.HEAP32[this.handle>>2],this.input,256,this.probability,this.flag)!==0)throw Error('TEN process falhou.');const end=this.samples,start=end-count;this.count=0;return{start,end,probability:m.HEAPF32[this.probability>>2]};}
 push(bytes,final=false){const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),frames=[];for(let i=0;i<bytes.length;i+=2){this.pending[this.count++]=view.getInt16(i,true);this.samples++;if(this.count===256)frames.push(this.infer(256));}if(final&&this.count)frames.push(this.infer(this.count));return frames;}
 close(){if(this.closed)return;this.closed=true;const m=this.module;if(m.HEAP32[this.handle>>2])m._ten_vad_destroy(this.handle);for(const ptr of [this.handle,this.input,this.probability,this.flag])m._free(ptr);}
}
return{TemporalAgreement,TenCapture};
});
