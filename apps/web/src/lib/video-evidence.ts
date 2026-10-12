/** Basic container check; no automated video interpretation or codec claim. */
export function validVideoHeader(type:string,bytes:Uint8Array) {
  if(type==="video/mp4")return bytes.length>=12 && new TextDecoder().decode(bytes.slice(4,8))==="ftyp";
  if(type==="video/webm")return bytes.length>=4 && [0x1a,0x45,0xdf,0xa3].every((value,index)=>bytes[index]===value);
  return false;
}
