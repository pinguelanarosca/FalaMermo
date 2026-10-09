class GeminiMicCapture extends AudioWorkletProcessor{
 constructor(){super();this.buffer=new Float32Array(Math.max(1024,Math.round(sampleRate/10)));this.used=0;this.port.onmessage=event=>{if(event.data?.type!=='flush')return;if(this.used){const tail=this.buffer.slice(0,this.used);this.port.postMessage(tail.buffer,[tail.buffer]);this.used=0;}this.port.postMessage({type:'flushed'});};}
 process(inputs){const input=inputs[0]?.[0];if(!input)return true;let offset=0;while(offset<input.length){const size=Math.min(input.length-offset,this.buffer.length-this.used);this.buffer.set(input.subarray(offset,offset+size),this.used);this.used+=size;offset+=size;if(this.used===this.buffer.length){const chunk=this.buffer;this.port.postMessage(chunk.buffer,[chunk.buffer]);this.buffer=new Float32Array(Math.max(1024,Math.round(sampleRate/10)));this.used=0;}}return true;}
}
registerProcessor('gemini-mic-capture',GeminiMicCapture);
