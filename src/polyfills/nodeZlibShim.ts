import pako from 'pako';
import { Buffer } from 'buffer';

function toUint8(input: Uint8Array | Buffer | string): Uint8Array {
  if (typeof input === 'string') return Buffer.from(input, 'utf8');
  return input instanceof Uint8Array ? input : new Uint8Array(input);
}

export function gzipSync(input: Uint8Array | Buffer | string): Buffer {
  return Buffer.from(pako.gzip(toUint8(input)));
}

export function gunzipSync(input: Uint8Array | Buffer | string): Buffer {
  return Buffer.from(pako.ungzip(toUint8(input)));
}

export function deflateSync(input: Uint8Array | Buffer | string): Buffer {
  return Buffer.from(pako.deflate(toUint8(input)));
}

export function inflateSync(input: Uint8Array | Buffer | string): Buffer {
  return Buffer.from(pako.inflate(toUint8(input)));
}

export function deflateRawSync(input: Uint8Array | Buffer | string): Buffer {
  return Buffer.from(pako.deflateRaw(toUint8(input)));
}

export function inflateRawSync(input: Uint8Array | Buffer | string): Buffer {
  return Buffer.from(pako.inflateRaw(toUint8(input)));
}

export default {
  gzipSync,
  gunzipSync,
  deflateSync,
  inflateSync,
  deflateRawSync,
  inflateRawSync,
};
