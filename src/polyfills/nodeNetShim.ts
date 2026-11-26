const IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
const IPV6_RE = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;

export function isIPv4(input: string): boolean {
  return typeof input === 'string' && IPV4_RE.test(input);
}

export function isIPv6(input: string): boolean {
  return typeof input === 'string' && IPV6_RE.test(input);
}

export function isIP(input: string): 0 | 4 | 6 {
  if (isIPv4(input)) return 4;
  if (isIPv6(input)) return 6;
  return 0;
}

export default { isIP, isIPv4, isIPv6 };
