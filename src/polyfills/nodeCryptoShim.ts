import forge from 'node-forge';
import { Buffer } from 'buffer';

export const constants = {
  RSA_PKCS1_PADDING: 1,
  RSA_NO_PADDING: 3,
  RSA_PKCS1_OAEP_PADDING: 4,
};

function toBinaryString(data: Uint8Array | Buffer | string): string {
  if (typeof data === 'string') {
    const buf = Buffer.from(data, 'utf8');
    let out = '';
    for (let i = 0; i < buf.length; i += 1) out += String.fromCharCode(buf[i]);
    return out;
  }
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) out += String.fromCharCode(bytes[i]);
  return out;
}

function binaryStringToBuffer(bin: string): Buffer {
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i) & 0xff;
  return Buffer.from(bytes);
}

export function createHash(algorithm: string) {
  const algo = algorithm.toLowerCase();
  const md =
    algo === 'sha256'
      ? forge.md.sha256.create()
      : algo === 'sha1'
        ? forge.md.sha1.create()
        : forge.md.md5.create();

  return {
    update(data: Uint8Array | Buffer | string) {
      md.update(toBinaryString(data), 'raw');
      return this;
    },
    digest(encoding?: 'hex' | 'base64'): string | Buffer {
      if (encoding === 'hex') return md.digest().toHex();
      const raw = binaryStringToBuffer(md.digest().getBytes());
      if (encoding === 'base64') return raw.toString('base64');
      return raw;
    },
  };
}

export function randomBytes(size: number): Buffer {
  const bytes = new Uint8Array(size);
  if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < size; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Buffer.from(bytes);
}

export function randomUUID(): string {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  const b = randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = b.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function publicEncrypt(
  keyOrOptions: string | { key: string; padding?: number },
  buffer: Uint8Array | Buffer | string,
): Buffer {
  const pem = typeof keyOrOptions === 'string' ? keyOrOptions : keyOrOptions.key;
  const padding = typeof keyOrOptions === 'string' ? constants.RSA_PKCS1_PADDING : keyOrOptions.padding;
  const pubKey = forge.pki.publicKeyFromPem(pem);
  const plainBin = toBinaryString(buffer);
  const scheme = padding === constants.RSA_PKCS1_OAEP_PADDING ? 'RSA-OAEP' : 'RSAES-PKCS1-V1_5';
  const encrypted = pubKey.encrypt(plainBin, scheme);
  return binaryStringToBuffer(encrypted);
}

export function createCipheriv(
  algorithm: string,
  key: Uint8Array | Buffer | string,
  iv: Uint8Array | Buffer | string,
) {
  const mode = algorithm.toLowerCase().includes('ecb') ? 'AES-ECB' : 'AES-CBC';
  const cipher = forge.cipher.createCipher(mode, toBinaryString(key));
  cipher.start({ iv: toBinaryString(iv) });
  return {
    update(data: Uint8Array | Buffer | string): Buffer {
      cipher.update(forge.util.createBuffer(toBinaryString(data), 'raw'));
      return Buffer.alloc(0);
    },
    final(): Buffer {
      cipher.finish();
      return binaryStringToBuffer(cipher.output.getBytes());
    },
  };
}

export function createDecipheriv(
  algorithm: string,
  key: Uint8Array | Buffer | string,
  iv: Uint8Array | Buffer | string,
) {
  const mode = algorithm.toLowerCase().includes('ecb') ? 'AES-ECB' : 'AES-CBC';
  const decipher = forge.cipher.createDecipher(mode, toBinaryString(key));
  decipher.start({ iv: toBinaryString(iv) });
  return {
    update(data: Uint8Array | Buffer | string): Buffer {
      decipher.update(forge.util.createBuffer(toBinaryString(data), 'raw'));
      return Buffer.alloc(0);
    },
    final(): Buffer {
      const ok = decipher.finish();
      if (!ok) throw new Error('AES decryption failed');
      return binaryStringToBuffer(decipher.output.getBytes());
    },
  };
}

export default {
  constants,
  createHash,
  randomBytes,
  randomUUID,
  publicEncrypt,
  createCipheriv,
  createDecipheriv,
};
