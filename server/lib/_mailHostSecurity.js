import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

const BLOCKED_HOST_SUFFIXES = [
  ".internal",
  ".lan",
  ".local",
  ".localhost",
  ".home",
  ".arpa"
];

const BLOCKED_IPV4_RANGES = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4]
].map(([address, prefix]) => [ipv4Number(address), prefix]);

export function normalizePublicMailHostname(value) {
  const host = String(value || "").trim().toLowerCase().replace(/\.$/, "");
  if (!host || host.length > 253 || isIP(host)) {
    throw new Error("Host mail non valido.");
  }
  if (host === "localhost" || BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    throw new Error("Host mail non consentito.");
  }

  const labels = host.split(".");
  if (
    labels.length < 2
    || labels.some((label) => !label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))
  ) {
    throw new Error("Host mail non valido.");
  }
  return host;
}

export async function resolvePublicMailHost(value, resolver = dnsLookup) {
  const hostname = normalizePublicMailHostname(value);
  const addresses = await resolver(hostname, { all: true, verbatim: true });
  if (!Array.isArray(addresses) || !addresses.length) {
    throw new Error("Host mail non risolvibile.");
  }

  for (const item of addresses) {
    if (!item?.address || isNonPublicIpAddress(item.address)) {
      throw new Error("Host mail non consentito.");
    }
  }

  const selected = addresses.find((item) => item.family === 4) || addresses[0];
  return { hostname, address: selected.address };
}

export function isNonPublicIpAddress(value) {
  const address = String(value || "").trim().toLowerCase();
  const family = isIP(address);
  if (family === 4) {
    const numeric = ipv4Number(address);
    return BLOCKED_IPV4_RANGES.some(([base, prefix]) => samePrefix(numeric, base, prefix));
  }
  if (family !== 6) return true;

  if (address === "::" || address === "::1") return true;
  if (/^f[cd][0-9a-f]{2}:/i.test(address)) return true;
  if (/^fe[89ab][0-9a-f]:/i.test(address)) return true;
  if (/^ff[0-9a-f]{2}:/i.test(address)) return true;
  if (/^2001:db8:/i.test(address)) return true;
  // Fail closed for IPv4-embedding transition ranges: otherwise a private
  // IPv4 target can be disguised as a syntactically public IPv6 address.
  if (/^::ffff:/i.test(address)) return true;
  if (/^64:ff9b(?::|$)/i.test(address) || /^64:ff9b:1(?::|$)/i.test(address)) return true;
  if (/^2001:0000:/i.test(address) || /^2002:/i.test(address)) return true;
  return false;
}

function ipv4Number(value) {
  const parts = String(value).split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return Number.NaN;
  }
  return (((parts[0] * 256 + parts[1]) * 256 + parts[2]) * 256 + parts[3]) >>> 0;
}

function samePrefix(value, base, prefix) {
  if (!Number.isFinite(value) || !Number.isFinite(base)) return true;
  if (prefix === 0) return true;
  const divisor = 2 ** (32 - prefix);
  return Math.floor(value / divisor) === Math.floor(base / divisor);
}
