class GeminiPcmProcessor extends AudioWorkletProcessor{
 constructor(){
  super();this.queue=[];this.index=0;this.cursor=0;this.totalFrames=0;this.rate=1;this.pitch=1;this.paused=false;this.started=false;this.lastReport=0;
  this.sampleRate=typeof sampleRate==='number'?sampleRate:24000;
  this.retainedFrames=Math.min(this.sampleRate*60,3*1024*1024);
  this.port.onmessage=({data})=>{
   if(data.type==='enqueue'){const frames=new Float32Array(data.buffer);if(frames.length){this.queue.push({frames,blockId:data.blockId,start:this.totalFrames,end:this.totalFrames+frames.length,drained:false});this.totalFrames+=frames.length;}else this.port.postMessage({type:'drain'});}
   if(data.type==='flush'){this.queue=[];this.index=0;this.cursor=0;this.totalFrames=0;this.started=false;}
   if(data.type==='pause')this.paused=data.value;
   if(data.type==='rate'&&Number.isFinite(data.value))this.rate=Math.max(.5,Math.min(2,data.value));
   if(data.type==='pitch'&&Number.isFinite(data.value))this.pitch=Math.max(.2,Math.min(3,data.value));
   if(data.type==='seek'&&Number.isFinite(data.deltaSeconds)){
    this.cursor=Math.max(this.queue[0]?.start||0,Math.min(this.totalFrames,this.cursor+data.deltaSeconds*this.sampleRate));
    this.index=this.queue.findIndex(segment=>segment.end>this.cursor);if(this.index<0)this.index=this.queue.length;
    this.drainThrough(this.cursor);this.report(true);
   }
   // ACK identifies the command actually applied, not merely a delivered message.
   if(Number.isInteger(data.controlSeq)&&['pause','seek'].includes(data.type))this.port.postMessage({type:'control-ack',controlSeq:data.controlSeq,command:data.type,paused:this.paused,frame:this.cursor,totalFrames:this.totalFrames,availableStart:this.queue[0]?.start||0});
  };
 }
 drainThrough(cursor){for(const segment of this.queue){if(segment.end>cursor)break;if(!segment.drained){segment.drained=true;this.port.postMessage({type:'drain'});}}}
 report(force=false){
  if(!force&&this.cursor-this.lastReport<this.sampleRate/4&&this.cursor<this.totalFrames)return;
  this.lastReport=this.cursor;
  // Retain consumed PCM only; future PCM follows the original streaming queue.
  while(this.index>0&&this.queue[0].end<=this.cursor-this.retainedFrames){this.queue.shift();this.index--;}
  this.port.postMessage({type:'position',frame:this.cursor,totalFrames:this.totalFrames,availableStart:this.queue[0]?.start||0});
 }
 process(_inputs,outputs){
  const out=outputs[0]?.[0];if(!out)return true;out.fill(0);if(this.paused)return true;
  let written=0;
  while(written<out.length&&this.index<this.queue.length){
   const segment=this.queue[this.index];
   if(this.cursor>=segment.end){if(!segment.drained){segment.drained=true;this.port.postMessage({type:'drain'});}this.index++;continue;}
   const offset=this.cursor-segment.start,a=Math.floor(offset),b=Math.min(segment.frames.length-1,a+1),t=offset-a;
   out[written++]=segment.frames[a]*(1-t)+segment.frames[b]*t;
   if(!this.started){this.started=true;this.port.postMessage({type:'first-played',blockId:segment.blockId,frames:1});}
   this.cursor=Math.min(this.totalFrames,this.cursor+this.rate*this.pitch);
   if(this.cursor>=segment.end){if(!segment.drained){segment.drained=true;this.port.postMessage({type:'drain'});}this.index++;}
  }
  if(written)this.report();return true;
 }
}
registerProcessor('gemini-pcm-player',GeminiPcmProcessor);
