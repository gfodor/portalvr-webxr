/**
 * Lightweight utilities adapted from webrtc-tests/src/utils.js with TypeScript typing.
 * No external deps; nanoid implemented locally.
 */

export function nanoid(len = 10): string {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  let out = '';
  for (let i = 0; i < len; i++) {
    out += alphabet[arr[i] % alphabet.length];
  }
  return out;
}

export function nowIso(): string {
  return new Date().toISOString().replace('T', ' ').replace('Z', '');
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export interface ParsedCandidate {
  foundation?: string;
  component?: string | number;
  protocol?: string;
  priority?: number;
  ip?: string;
  address?: string;
  port?: number;
  type?: string;
  tcpType?: string;
  raddr?: string;
  rport?: number;
}

/**
 * Parse an "a=candidate:" line to a structured object (best-effort).
 */
export function parseCandidateLine(line: string | null | undefined): ParsedCandidate | null {
  if (!line) return null;
  const normalized = line.trim().replace(/^a=/, '');
  const body = normalized.startsWith('candidate:') ? normalized.slice(10) : normalized;
  const parts = body.trim().split(/\s+/);
  if (parts.length < 6) return null;

  const [foundation, component, protocol, priorityStr, address, portStr, ...rest] = parts;
  const result: ParsedCandidate = {
    foundation,
    component,
    protocol,
    priority: Number(priorityStr),
    ip: address,
    port: Number(portStr),
  };
  if (!Number.isFinite(result.priority)) delete result.priority;
  if (!Number.isFinite(result.port)) delete result.port;

  const pickToken = (label: string): string | undefined => {
    const idx = rest.indexOf(label);
    return idx !== -1 && rest[idx + 1] ? rest[idx + 1] : undefined;
  };

  const type = pickToken('typ');
  if (type) result.type = type;
  const tcpType = pickToken('tcptype');
  if (tcpType) result.tcpType = tcpType;
  const raddr = pickToken('raddr');
  if (raddr) result.raddr = raddr;
  const rport = pickToken('rport');
  if (rport) {
    const num = Number(rport);
    (result as any).rport = Number.isFinite(num) ? num : rport;
  }
  return result;
}

export async function gatherSelectedPair(
  pc: RTCPeerConnection,
): Promise<{ selectedPair?: any; local?: any; remote?: any }> {
  const stats: RTCStatsReport = await pc.getStats();
  let selectedPair: any = undefined;
  let local: any = undefined;
  let remote: any = undefined;

  stats.forEach((report: any) => {
    if (report.type === 'transport' && report.selectedCandidatePairId) {
      const pair = (stats as any).get(report.selectedCandidatePairId);
      if (pair) {
        selectedPair = pair;
        local = (stats as any).get(pair.localCandidateId);
        remote = (stats as any).get(pair.remoteCandidateId);
      }
    }
    if (report.type === 'candidate-pair' && report.selected) {
      selectedPair = report;
      local = (stats as any).get(report.localCandidateId);
      remote = (stats as any).get(report.remoteCandidateId);
    }
  });

  return { selectedPair, local, remote };
}