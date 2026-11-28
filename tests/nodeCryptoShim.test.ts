import { describe, expect, it } from 'vitest';
import nodeCrypto from 'node:crypto';
import { Buffer } from 'buffer';
import cryptoShim from '@/polyfills/nodeCryptoShim';
import zlibShim from '@/polyfills/nodeZlibShim';
import netShim from '@/polyfills/nodeNetShim';

describe('Node browser shims parity for KuGouMusicApi', () => {
  it('matches Node native MD5 hex output for strings and Buffers', () => {
    const input = 'kugou_lite_signature_test_2026_中文';
    const expected = nodeCrypto.createHash('md5').update(input).digest('hex');
    const actual = cryptoShim.createHash('md5').update(input).digest('hex');
    expect(actual).toBe(expected);

    const buf = Buffer.from([1, 2, 3, 250, 255, 0, 42]);
    expect(cryptoShim.createHash('md5').update(buf).digest('hex')).toBe(
      nodeCrypto.createHash('md5').update(buf).digest('hex'),
    );
  });

  it('matches Node native AES-256-CBC encryption and decryption byte-for-byte', () => {
    const key = Buffer.from('0123456789abcdef0123456789abcdef', 'utf8'); // 32 bytes
    const iv = Buffer.from('abcdef0123456789', 'utf8'); // 16 bytes
    const plain = Buffer.from('{"cookie":"abc","clienttime":1700000000,"serverstr":"xyz"}', 'utf8');

    const nodeCipher = nodeCrypto.createCipheriv('aes-256-cbc', key, iv);
    const expectedEnc = Buffer.concat([nodeCipher.update(plain), nodeCipher.final()]);

    const shimCipher = cryptoShim.createCipheriv('aes-256-cbc', key, iv);
    const actualEnc = Buffer.concat([shimCipher.update(plain), shimCipher.final()]);
    expect(actualEnc.toString('hex')).toBe(expectedEnc.toString('hex'));

    const shimDecipher = cryptoShim.createDecipheriv('aes-256-cbc', key, iv);
    const decrypted = Buffer.concat([shimDecipher.update(expectedEnc), shimDecipher.final()]);
    expect(decrypted.toString('utf8')).toBe(plain.toString('utf8'));
  });

  it('encrypts with RSA PKCS1 compatible with Node privateDecrypt', () => {
    const { publicKey, privateKey } = nodeCrypto.generateKeyPairSync('rsa', {
      modulusLength: 1024,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const secret = 'uuid1234\tfield2hex\t1700000000000\tdev001';
    const encrypted = cryptoShim.publicEncrypt(
      { key: publicKey, padding: cryptoShim.constants.RSA_PKCS1_PADDING },
      Buffer.from(secret, 'utf8'),
    );
    const decrypted = nodeCrypto.privateDecrypt(
      { key: privateKey, padding: nodeCrypto.constants.RSA_PKCS1_PADDING },
      encrypted,
    );
    expect(decrypted.toString('utf8')).toBe(secret);
  });

  it('matches Node native createPublicKey + RSA_NO_PADDING encryption byte-for-byte for /team/* routes', () => {
    const { publicKey } = nodeCrypto.generateKeyPairSync('rsa', {
      modulusLength: 1024,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const prefix = 'moc.uoguk.59::';
    const input = Buffer.from(`${prefix}demo_token_2026_melune_team`, 'utf8');
    const padded = Buffer.alloc(128);
    input.copy(padded);

    const nodeKey = nodeCrypto.createPublicKey(publicKey);
    const expectedHex = nodeCrypto
      .publicEncrypt({ key: nodeKey, padding: nodeCrypto.constants.RSA_NO_PADDING }, padded)
      .toString('hex');

    const shimKey = cryptoShim.createPublicKey(publicKey);
    const actualHex = cryptoShim
      .publicEncrypt({ key: shimKey, padding: cryptoShim.constants.RSA_NO_PADDING }, padded)
      .toString('hex');

    expect(actualHex).toBe(expectedHex);
    expect(actualHex).toHaveLength(256);
  });

  it('deflates and inflates payloads identically via pako zlib shim', () => {
    const sample = Buffer.from('type_id=4&action=play&mixsongid=666075191&state=完整播放', 'utf8');
    const compressed = zlibShim.deflateSync(sample);
    const restored = zlibShim.inflateSync(compressed);
    expect(restored.toString('utf8')).toBe(sample.toString('utf8'));
  });

  it('validates IPv4/IPv6 addresses via net shim', () => {
    expect(netShim.isIP('0.0.0.0')).toBe(4);
    expect(netShim.isIP('192.168.1.10')).toBe(4);
    expect(netShim.isIP('::1')).toBe(6);
    expect(netShim.isIP('not-an-ip')).toBe(0);
  });
});
