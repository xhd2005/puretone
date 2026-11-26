import { describe, expect, it } from 'vitest';
import pako from 'pako';
import { Buffer } from 'buffer';
import { decodeKrcBase64, parseKrcText, parseLrcText } from '@/services/playback/krcParser';

const KRC_XOR_KEY = [64, 71, 97, 119, 94, 50, 116, 71, 81, 54, 49, 45, 206, 210, 110, 105];

function encodeFakeKrc(plainKrc: string): string {
  const deflated = pako.deflate(Buffer.from(plainKrc, 'utf8'));
  const out = new Uint8Array(4 + deflated.length);
  out[0] = 0x6b; // k
  out[1] = 0x72; // r
  out[2] = 0x63; // c
  out[3] = 0x31; // 1
  for (let i = 0; i < deflated.length; i += 1) {
    out[i + 4] = deflated[i] ^ KRC_XOR_KEY[i % KRC_XOR_KEY.length];
  }
  return Buffer.from(out).toString('base64');
}

describe('KRC & LRC word-by-word bilingual lyric parser', () => {
  it('decrypts XOR+zlib KRC payload and parses word timings + bilingual translation', () => {
    const langPayload = Buffer.from(
      JSON.stringify({
        content: [
          {
            type: 1,
            lyricContent: [['你好', '世界'], ['晚安', '星光']],
          },
        ],
      }),
      'utf8',
    ).toString('base64');

    const krcRaw = [
      `[language:${langPayload}]`,
      '[1000,2500]<0,800,0>Hello <800,1200,0>World',
      '[4000,3000]<0,1000,0>Good <1000,1500,0>Night',
    ].join('\n');

    const b64 = encodeFakeKrc(krcRaw);
    const decoded = decodeKrcBase64(b64);
    const parsed = parseKrcText(decoded);

    expect(parsed.source).toBe('kugou-krc');
    expect(parsed.hasWordTiming).toBe(true);
    expect(parsed.hasTranslation).toBe(true);
    expect(parsed.lines).toHaveLength(2);

    expect(parsed.lines[0].startMs).toBe(1000);
    expect(parsed.lines[0].text).toBe('Hello World');
    expect(parsed.lines[0].translation).toBe('你好世界');
    expect(parsed.lines[0].words).toEqual([
      { startMs: 1000, durationMs: 800, text: 'Hello ' },
      { startMs: 1800, durationMs: 1200, text: 'World' },
    ]);

    expect(parsed.lines[1].translation).toBe('晚安星光');
  });

  it('merges separate original and translation LRC tracks by timestamp', () => {
    const orig = '[00:12.50]Always with me\n[00:18.00]Under the sky';
    const trans = '[00:12.50]永远与我同在\n[00:18.00]在这片天空下';
    const parsed = parseLrcText(orig, trans, 'netease');

    expect(parsed.hasTranslation).toBe(true);
    expect(parsed.lines).toHaveLength(2);
    expect(parsed.lines[0].startMs).toBe(12500);
    expect(parsed.lines[0].text).toBe('Always with me');
    expect(parsed.lines[0].translation).toBe('永远与我同在');
  });
});
