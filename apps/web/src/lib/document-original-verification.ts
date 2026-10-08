import { createHash } from "node:crypto";

export function ownsDocumentOriginal(path:string,organisationId:string,documentId:string) {
  return path === `organisations/${organisationId}/documents/${documentId}/original`;
}

export async function verifyDocumentOriginal(stream:ReadableStream<Uint8Array>,expectedSize:number,expectedChecksum:string) {
  const reader=stream.getReader();const hash=createHash("sha256");let size=0;
  let timer:ReturnType<typeof setTimeout>|undefined;
  const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{void reader.cancel().catch(()=>undefined);reject(new Error("Original verification timed out."));},10000);});
  try {
    return await Promise.race([(async()=>{
      if(!Number.isSafeInteger(expectedSize)||expectedSize<0||expectedSize>100*1024*1024||!/^[a-f0-9]{64}$/i.test(expectedChecksum))throw new Error("Original metadata cannot be verified.");
      while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>expectedSize)throw new Error("Original size does not match the reviewed document.");hash.update(chunk.value);}
      if(size!==expectedSize||hash.digest("hex")!==expectedChecksum.toLowerCase())throw new Error("Original checksum or size does not match the reviewed document.");
      return true;
    })(),timeout]);
  }finally{if(timer)clearTimeout(timer);void reader.cancel().catch(()=>undefined);reader.releaseLock();}
}

export async function boundedStorageOperation<T>(operation:Promise<T>,onLateResult?:(value:T)=>void) {
  let timer:ReturnType<typeof setTimeout>|undefined;let timedOut=false;
  const observed=operation.then(value=>{if(timedOut)onLateResult?.(value);return value;});
  try {return await Promise.race([observed,new Promise<never>((_,reject)=>{timer=setTimeout(()=>{timedOut=true;reject(new Error("Storage operation timed out; its result requires reconciliation."));},10000);})]);}
  finally{if(timer)clearTimeout(timer);}
}
