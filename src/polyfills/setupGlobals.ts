import { Buffer } from 'buffer';

const g = globalThis as Record<string, unknown>;

if (typeof g.Buffer === 'undefined') {
  g.Buffer = Buffer;
}

if (typeof g.process === 'undefined') {
  g.process = {
    env: {
      platform: 'lite',
      KUGOU_API_DEV: 'PureTone',
    },
    argv: [],
    platform: 'android',
  };
} else {
  const proc = g.process as { env?: Record<string, string>; argv?: string[] };
  proc.env = {
    platform: 'lite',
    KUGOU_API_DEV: 'EchoMusic',
    ...(proc.env || {}),
  };
  if (!Array.isArray(proc.argv)) proc.argv = [];
}

if (typeof g.global === 'undefined') {
  g.global = globalThis;
}
