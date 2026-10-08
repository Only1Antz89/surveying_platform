import { createHash } from "node:crypto";
import { describe,expect,it,vi } from "vitest";
import { boundedStorageOperation,ownsDocumentOriginal,verifyDocumentOriginal } from "./document-original-verification";
const bytes=new TextEncoder().encode("reviewed original");
const checksum=createHash("sha256").update(bytes).digest("hex");
const stream=()=>new Blob([bytes]).stream();
describe("original removal verification",()=>{
  it("requires the exact tenant/document original path",()=>{
    expect(ownsDocumentOriginal("organisations/a/documents/b/original","a","b")).toBe(true);
    for(const path of ["organisations/x/documents/b/original","organisations/a/documents/c/original","organisations/a/documents/b/../original","https://example.test/blob"])expect(ownsDocumentOriginal(path,"a","b")).toBe(false);
  });
  it("verifies exact bytes",async()=>{expect(await verifyDocumentOriginal(stream(),bytes.length,checksum)).toBe(true);});
  it("rejects changed and oversized originals",async()=>{
    await expect(verifyDocumentOriginal(stream(),bytes.length,"a".repeat(64))).rejects.toThrow("checksum");
    await expect(verifyDocumentOriginal(stream(),bytes.length-1,checksum)).rejects.toThrow("size");
    await expect(verifyDocumentOriginal(stream(),bytes.length+1,checksum)).rejects.toThrow("size");
  });
  it("rejects unverifiable metadata",async()=>{await expect(verifyDocumentOriginal(stream(),bytes.length,"legacy")).rejects.toThrow("metadata");});
  it("bounds a stalled stream without approving removal",async()=>{
    vi.useFakeTimers();try {
      const pending=verifyDocumentOriginal(new ReadableStream({pull:()=>new Promise(()=>{})}),1,"a".repeat(64));
      const rejection=expect(pending).rejects.toThrow("timed out");
      await vi.advanceTimersByTimeAsync(10001);await rejection;
    }finally{vi.useRealTimers();}
  });
  it("bounds uncertain provider operations",async()=>{
    vi.useFakeTimers();try {
      const pending=boundedStorageOperation(new Promise(()=>{}));
      const rejection=expect(pending).rejects.toThrow("reconciliation");
      await vi.advanceTimersByTimeAsync(10001);await rejection;
    }finally{vi.useRealTimers();}
  });

  it("cleans up results arriving after a storage timeout",async()=>{
    vi.useFakeTimers();try {
      let resolve!:(value:string)=>void;
      const cleanup=vi.fn();
      const operation=new Promise<string>(done=>{resolve=done;});
      const pending=boundedStorageOperation(operation,cleanup);
      const rejection=expect(pending).rejects.toThrow("timed out");
      await vi.advanceTimersByTimeAsync(10001);await rejection;
      resolve("late stream");await Promise.resolve();
      expect(cleanup).toHaveBeenCalledExactlyOnceWith("late stream");
    }finally{vi.useRealTimers();}
  });

});
