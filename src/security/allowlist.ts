import fs from 'node:fs';
import path from 'node:path';
import type { AllowlistEntry, AllowlistFile } from '../types.js';

function normalizeHost(host: string) {
  return host.trim().toLowerCase().replace(/^\.+|\.+$/g, '');
}

export class AllowlistStore {
  private filePath: string;
  private state: AllowlistFile = { version: 1, entries: [] };

  constructor(filePath: string) {
    this.filePath = filePath;
    this.reload();
  }

  reload() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    if (!fs.existsSync(this.filePath)) {
      this.state = { version: 1, entries: [] };
      fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2));
      return;
    }
    const raw = fs.readFileSync(this.filePath, 'utf8');
    const parsed = JSON.parse(raw) as AllowlistFile;
    this.state = {
      version: parsed.version ?? 1,
      entries: (parsed.entries ?? []).map((entry) => ({
        ...entry,
        host: normalizeHost(entry.host),
        schemes: (entry.schemes ?? ['https']).filter((s): s is 'https' | 'http' => s === 'https' || s === 'http'),
        enabled: entry.enabled !== false,
        allowSubdomains: Boolean(entry.allowSubdomains)
      }))
    };
  }

  save() {
    fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2));
  }

  list() {
    return [...this.state.entries];
  }

  getById(id: string) {
    return this.state.entries.find((entry) => entry.id === id) ?? null;
  }

  upsert(entry: AllowlistEntry) {
    const normalized: AllowlistEntry = {
      ...entry,
      host: normalizeHost(entry.host),
      schemes: entry.schemes.length ? entry.schemes : ['https']
    };
    const index = this.state.entries.findIndex((item) => item.id === normalized.id);
    if (index >= 0) this.state.entries[index] = normalized;
    else this.state.entries.push(normalized);
    this.save();
    return normalized;
  }

  patch(id: string, patch: Partial<Omit<AllowlistEntry, 'id'>>) {
    const current = this.getById(id);
    if (!current) return null;
    const next: AllowlistEntry = {
      ...current,
      ...patch,
      host: patch.host ? normalizeHost(patch.host) : current.host,
      schemes: patch.schemes && patch.schemes.length ? patch.schemes : current.schemes
    };
    return this.upsert(next);
  }

  remove(id: string) {
    const before = this.state.entries.length;
    this.state.entries = this.state.entries.filter((entry) => entry.id !== id);
    if (this.state.entries.length !== before) {
      this.save();
      return true;
    }
    return false;
  }

  match(url: URL) {
    const host = normalizeHost(url.hostname);
    const scheme = url.protocol.replace(':', '') as 'https' | 'http';
    for (const entry of this.state.entries) {
      if (!entry.enabled) continue;
      if (!entry.schemes.includes(scheme)) continue;
      if (entry.host === host) return entry;
      if (entry.allowSubdomains && host.endsWith(`.${entry.host}`)) return entry;
    }
    return null;
  }

  isAllowed(url: URL) {
    return Boolean(this.match(url));
  }

  enabledCount() {
    return this.state.entries.filter((entry) => entry.enabled).length;
  }
}
