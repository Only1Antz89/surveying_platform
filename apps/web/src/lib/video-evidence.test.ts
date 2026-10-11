import { describe, expect, it } from "vitest";
import { validVideoHeader } from "./video-evidence";
import { mediaByteRange, rangedMediaStream } from "./media-range";

describe("private video evidence", () => {
  it("rejects mislabeled files and recognises supported container headers", () => {
    expect(validVideoHeader("video/mp4", new Uint8Array([0,0,0,24,102,116,121,112,105,115,111,109]))).toBe(true);
    expect(validVideoHeader("video/webm", new Uint8Array([0x1a,0x45,0xdf,0xa3]))).toBe(true);
    expect(validVideoHeader("video/mp4", new TextEncoder().encode("<html>hello</html>"))).toBe(false);
    expect(validVideoHeader("video/webm", new Uint8Array([0x1a,0x45]))).toBe(false);
  });
  it("handles bounded, open and suffix ranges and rejects invalid requests", () => {
    expect(mediaByteRange("bytes=2-8",6)).toEqual({start:2,end:5});
    expect(mediaByteRange("bytes=2-",6)).toEqual({start:2,end:5});
    expect(mediaByteRange("bytes=-2",6)).toEqual({start:4,end:5});
    for(const header of ["bytes=-0","bytes=6-","bytes=4-2","bytes=0-1,3-4","bytes=-","items=0-2"]) expect(mediaByteRange(header,6)).toBeNull();
  });
  it("streams ranges across chunks and cancels the remainder", async () => {
    let cancelled=false;
    const source=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new Uint8Array([0,1,2]));controller.enqueue(new Uint8Array([3,4,5]));controller.enqueue(new Uint8Array([6,7,8]));},cancel(){cancelled=true;}});
    const bytes=new Uint8Array(await new Response(rangedMediaStream(source,2,5)).arrayBuffer());
    expect([...bytes]).toEqual([2,3,4,5]);expect(cancelled).toBe(true);
  });
  it("fails on a truncated stored original", async () => {
    const source=new Blob([new Uint8Array([1,2])]).stream();
    await expect(new Response(rangedMediaStream(source,1,5)).arrayBuffer()).rejects.toThrow("ended before");
  });
});
