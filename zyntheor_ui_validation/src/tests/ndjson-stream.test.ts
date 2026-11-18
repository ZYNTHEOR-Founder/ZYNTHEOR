import assert from 'node:assert/strict';
import { consumeNdjsonStream } from '../lib/ndjson.ts';

function responseFromChunks(chunks: Uint8Array[]): Response {
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  }));
}

async function main() {
  const wireText = '{"type":"chunk","text":"สวัสดี"}\r\n\n{"type":"done"}';
  const bytes = new TextEncoder().encode(wireText);
  const thaiLeadByte = bytes.findIndex((byte) => byte === 0xe0);
  assert.ok(thaiLeadByte >= 0);

  const received: Array<{ type: string; text?: string }> = [];
  await consumeNdjsonStream<{ type: string; text?: string }>(responseFromChunks([
    bytes.slice(0, thaiLeadByte + 1),
    bytes.slice(thaiLeadByte + 1, thaiLeadByte + 4),
    bytes.slice(thaiLeadByte + 4),
  ]), async (event) => {
    await Promise.resolve();
    received.push(event);
  });

  assert.deepEqual(received, [
    { type: 'chunk', text: 'สวัสดี' },
    { type: 'done' },
  ]);
  console.log('PASS parses UTF-8 records across chunk boundaries, CRLF, blank lines, and final lines without a newline');

  const malformedResponse = responseFromChunks([
    new TextEncoder().encode('{"type":"step"}\nnot-json\n'),
  ]);
  await assert.rejects(
    consumeNdjsonStream(malformedResponse, () => undefined),
    /INVALID_NDJSON_LINE:2/,
  );
  console.log('PASS rejects malformed records with their line number');

  await assert.rejects(
    consumeNdjsonStream(new Response(null), () => undefined),
    /NDJSON_STREAM_UNAVAILABLE/,
  );
  console.log('PASS reports a missing response stream');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
