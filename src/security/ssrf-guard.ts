import dns from 'node:dns/promises';
import net from 'node:net';

const IPV4_PRIVATE_RANGES: Array<[number, number]> = [
  [ipToInt('0.0.0.0'), ipToInt('0.255.255.255')],
  [ipToInt('10.0.0.0'), ipToInt('10.255.255.255')],
  [ipToInt('100.64.0.0'), ipToInt('100.127.255.255')],
  [ipToInt('127.0.0.0'), ipToInt('127.255.255.255')],
  [ipToInt('169.254.0.0'), ipToInt('169.254.255.255')],
  [ipToInt('172.16.0.0'), ipToInt('172.31.255.255')],
  [ipToInt('192.0.0.0'), ipToInt('192.0.0.255')],
  [ipToInt('192.0.2.0'), ipToInt('192.0.2.255')],
  [ipToInt('192.168.0.0'), ipToInt('192.168.255.255')],
  [ipToInt('198.18.0.0'), ipToInt('198.19.255.255')],
  [ipToInt('198.51.100.0'), ipToInt('198.51.100.255')],
  [ipToInt('203.0.113.0'), ipToInt('203.0.113.255')],
  [ipToInt('224.0.0.0'), ipToInt('255.255.255.255')]
];

function ipToInt(ip: string): number {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

function isPrivateIpv4(ip: string): boolean {
  const value = ipToInt(ip);
  return IPV4_PRIVATE_RANGES.some(([start, end]) => value >= start && value <= end);
}

function isBlockedIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  return (
    normalized === '::1' ||
    normalized === '::' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe80:') ||
    normalized.startsWith('::ffff:127.') ||
    normalized.startsWith('::ffff:10.') ||
    normalized.startsWith('::ffff:192.168.') ||
    normalized.startsWith('::ffff:172.16.') ||
    normalized.startsWith('::ffff:172.17.') ||
    normalized.startsWith('::ffff:172.18.') ||
    normalized.startsWith('::ffff:172.19.') ||
    normalized.startsWith('::ffff:172.2') ||
    normalized.startsWith('::ffff:169.254.')
  );
}

export function assertSafeHostname(hostname: string) {
  const host = hostname.trim().toLowerCase();
  if (!host) throw new Error('empty_hostname');
  if (host === 'localhost' || host.endsWith('.localhost')) throw new Error('ssrf_blocked');
  if (host === 'metadata.google.internal') throw new Error('ssrf_blocked');
  if (host === '169.254.169.254') throw new Error('ssrf_blocked');
  if (net.isIP(host)) {
    assertSafeIp(host);
  }
}

export function assertSafeIp(ip: string) {
  const family = net.isIP(ip);
  if (!family) throw new Error('invalid_ip');
  if (family === 4 && isPrivateIpv4(ip)) throw new Error('ssrf_blocked');
  if (family === 6 && isBlockedIpv6(ip)) throw new Error('ssrf_blocked');
}

export async function assertSafeResolvedHost(hostname: string) {
  assertSafeHostname(hostname);
  const answers = await dns.lookup(hostname, { all: true, verbatim: true });
  if (!answers.length) throw new Error('dns_resolution_failed');
  for (const answer of answers) {
    assertSafeIp(answer.address);
  }
}

export async function assertSafeUrl(url: URL, allowHttp = false) {
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('invalid_scheme');
  if (url.protocol === 'http:' && !allowHttp) throw new Error('invalid_scheme');
  if (url.username || url.password) throw new Error('credentials_not_allowed');
  await assertSafeResolvedHost(url.hostname);
}
