export type AllowlistEntry = {
  id: string;
  host: string;
  allowSubdomains: boolean;
  schemes: Array<'https' | 'http'>;
  enabled: boolean;
  label?: string;
};

export type AllowlistFile = {
  version: number;
  entries: AllowlistEntry[];
};

export type MirrorRecord = {
  id: string;
  slug: string;
  targetOrigin: string;
  createdAt: string;
  updatedAt: string;
  lastPath?: string | null;
  disabled: boolean;
};

export type MirrorEventLevel = 'info' | 'warn' | 'error';
export type MirrorEventKind =
  | 'resolve'
  | 'resolve-fail'
  | 'proxy-error'
  | 'ssrf-blocked'
  | 'cache-hit'
  | 'cache-miss'
  | 'cache-purge'
  | 'admin-action'
  | 'upstream-timeout';

export type MirrorEvent = {
  id: string;
  at: string;
  level: MirrorEventLevel;
  kind: MirrorEventKind;
  slug?: string | null;
  message: string;
  meta?: Record<string, unknown>;
};

export type MirrorSummary = {
  ok: boolean;
  serviceDisabled: boolean;
  uptimeSec: number;
  version: string;
  authMode: 'basic-auth';
  allowlist: {
    count: number;
    enabledCount: number;
    entries: AllowlistEntry[];
  };
  cache: {
    ttlSeconds: number;
    maxBytes: number;
    usedBytes: number;
    entries: number;
  };
  mirrors: {
    total: number;
    recent: MirrorRecord[];
  };
  recentEvents: MirrorEvent[];
  security: {
    methods: string[];
    noindex: boolean;
    ssrfGuard: boolean;
    localBindExpected: string;
  };
};

export type CachedResponse = {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
  contentType: string;
  cachedAt: number;
};
