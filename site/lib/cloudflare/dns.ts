// Cloudflare DNS client — typed wrapper around the bits we actually use.
// Docs: https://developers.cloudflare.com/api/operations/dns-records-for-a-zone-create-dns-record

const CF_BASE = "https://api.cloudflare.com/client/v4";

interface CfEnv {
  token: string;
  zoneId: string;
}

function env(): CfEnv {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  if (!token || !zoneId) {
    throw new Error("cloudflare-env-missing: set CLOUDFLARE_API_TOKEN + CLOUDFLARE_ZONE_ID");
  }
  return { token, zoneId };
}

interface CfResponse<T> {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  messages: unknown[];
  result: T;
}

async function cf<T>(path: string, init?: RequestInit): Promise<T> {
  const { token } = env();
  const res = await fetch(`${CF_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const body = (await res.json()) as CfResponse<T>;
  if (!body.success) {
    const msg = body.errors?.map((e) => `[${e.code}] ${e.message}`).join("; ") ?? `HTTP ${res.status}`;
    throw new Error(`cloudflare-api-error: ${msg}`);
  }
  return body.result;
}

export interface DnsRecord {
  id: string;
  name: string;
  type: "A" | "AAAA";
  content: string;
  proxied: boolean;
  ttl: number;
}

export interface CreateRecordArgs {
  // Full record name, e.g. "swift-otter-4f3.box.voidbunny.xyz".
  name: string;
  ip: string;
  type?: "A" | "AAAA";   // default A
  ttl?: number;          // default 300
  comment?: string;
}

export async function createDnsRecord(args: CreateRecordArgs): Promise<DnsRecord> {
  const { zoneId } = env();
  return cf<DnsRecord>(`/zones/${zoneId}/dns_records`, {
    method: "POST",
    body: JSON.stringify({
      type: args.type ?? "A",
      name: args.name,
      content: args.ip,
      ttl: args.ttl ?? 300,
      proxied: false,                       // DNS-only, never proxied — users own their TLS
      comment: args.comment ?? "voidbunny-subdomain",
    }),
  });
}

export async function deleteDnsRecord(recordId: string): Promise<void> {
  const { zoneId } = env();
  await cf<{ id: string }>(`/zones/${zoneId}/dns_records/${recordId}`, { method: "DELETE" });
}

export async function updateDnsRecordIp(recordId: string, ip: string): Promise<DnsRecord> {
  const { zoneId } = env();
  return cf<DnsRecord>(`/zones/${zoneId}/dns_records/${recordId}`, {
    method: "PATCH",
    body: JSON.stringify({ content: ip }),
  });
}
