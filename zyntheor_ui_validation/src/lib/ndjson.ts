/**
 * Consume a newline-delimited JSON response with incremental UTF-8 decoding.
 * Invalid or truncated records fail the stream instead of being silently dropped.
 */
export async function consumeNdjsonStream<T>(
  response: Response,
  onEvent: (event: T) => void | Promise<void>,
): Promise<void> {
  if (!response.body) {
    throw new Error('NDJSON_STREAM_UNAVAILABLE');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '';
  let lineNumber = 0;

  const consumeLine = async (rawLine: string) => {
    lineNumber += 1;
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (!line.trim()) return;

    let event: T;
    try {
      event = JSON.parse(line) as T;
    } catch (error) {
      throw new Error(`INVALID_NDJSON_LINE:${lineNumber}`, { cause: error });
    }
    await onEvent(event);
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        await consumeLine(line);
      }
    }

    if (buffer.length > 0) {
      await consumeLine(buffer);
    }
  } catch (error) {
    try {
      await reader.cancel(error);
    } catch {
      // Preserve the original stream or event-processing error.
    }
    throw error;
  } finally {
    reader.releaseLock();
  }
}
