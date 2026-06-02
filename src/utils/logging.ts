import pino, { type DestinationStream } from 'pino';

const CONTENT_KEYS = new Set(['content', 'content_text', 'normalized_text', 'text', 'message', 'raw_json', 'raw']);
function redactMessageContent(_value: unknown): unknown { return '[redacted]'; }

export function createLogger(stream?: DestinationStream) {
  return pino({
    level: 'info',
    base: undefined,
    timestamp: false,
    serializers: Object.fromEntries([...CONTENT_KEYS].map((k) => [k, redactMessageContent]))
  }, stream);
}
