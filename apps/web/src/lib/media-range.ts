/** Single byte ranges for private video playback. Multi-range requests are rejected. */
export function mediaByteRange(header: string, size: number) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || !Number.isSafeInteger(size) || size < 1 || (!match[1] && !match[2])) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= size || (!match[1] && Number(match[2]) === 0)) return null;
  return { start, end };
}

/** Stream only the requested interval without buffering the entire video. */
export function rangedMediaStream(source: ReadableStream<Uint8Array>, start: number, end: number) {
  const reader = source.getReader();
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) { controller.error(new Error("Video original ended before the requested range.")); return; }
          const previous = offset; offset += value.length;
          if (offset <= start) continue;
          const part = value.subarray(Math.max(0, start - previous), Math.min(value.length, end + 1 - previous));
          if (part.length) controller.enqueue(part);
          if (offset > end) { controller.close(); await reader.cancel(); }
          return;
        }
      } catch (error) { controller.error(error); }
    },
    cancel(reason) { return reader.cancel(reason); },
  });
}
