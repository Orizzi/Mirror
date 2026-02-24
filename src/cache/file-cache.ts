import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { CachedResponse } from '../types.js';

function safeSlug(slug: string) {
  return slug.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'default';
}

type CacheEntryMeta = {
  cacheKey: string;
  slug: string;
  cachedAt: number;
  contentType: string;
  status: number;
  headers: Record<string, string>;
  bodyFile: string;
  size: number;
};

export class FileCache {
  constructor(
    private dir: string,
    private ttlSeconds: number,
    private maxBytes: number
  ) {
    fs.mkdirSync(this.dir, { recursive: true });
  }

  key(method: string, url: string) {
    return crypto.createHash('sha256').update(`${method}:${url}`).digest('hex');
  }

  private metaPath(slug: string, cacheKey: string) {
    return path.join(this.dir, `${safeSlug(slug)}_${cacheKey}.json`);
  }

  private bodyPath(slug: string, cacheKey: string) {
    return path.join(this.dir, `${safeSlug(slug)}_${cacheKey}.bin`);
  }

  get(slug: string, cacheKey: string): CachedResponse | null {
    const metaFile = this.metaPath(slug, cacheKey);
    if (!fs.existsSync(metaFile)) return null;
    try {
      const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')) as CacheEntryMeta;
      if ((Date.now() - meta.cachedAt) / 1000 > this.ttlSeconds) {
        this.removePair(metaFile, path.join(this.dir, meta.bodyFile));
        return null;
      }
      const bodyPath = path.join(this.dir, meta.bodyFile);
      if (!fs.existsSync(bodyPath)) {
        fs.rmSync(metaFile, { force: true });
        return null;
      }
      const body = fs.readFileSync(bodyPath);
      return {
        status: meta.status,
        headers: meta.headers,
        body,
        contentType: meta.contentType,
        cachedAt: meta.cachedAt
      };
    } catch {
      fs.rmSync(metaFile, { force: true });
      return null;
    }
  }

  set(slug: string, cacheKey: string, response: CachedResponse) {
    const bodyFile = `${safeSlug(slug)}_${cacheKey}.bin`;
    const metaFile = this.metaPath(slug, cacheKey);
    const bodyPath = path.join(this.dir, bodyFile);
    const size = response.body.byteLength;
    if (size > this.maxBytes / 2) return; // refuse oversized entries
    fs.writeFileSync(bodyPath, response.body);
    const meta: CacheEntryMeta = {
      cacheKey,
      slug,
      cachedAt: Date.now(),
      contentType: response.contentType,
      status: response.status,
      headers: response.headers,
      bodyFile,
      size
    };
    fs.writeFileSync(metaFile, JSON.stringify(meta));
    this.prune();
  }

  purgeAll() {
    let removed = 0;
    for (const file of fs.readdirSync(this.dir)) {
      fs.rmSync(path.join(this.dir, file), { force: true });
      removed += 1;
    }
    return removed;
  }

  purgeBySlug(slug: string) {
    const prefix = `${safeSlug(slug)}_`;
    let removed = 0;
    for (const file of fs.readdirSync(this.dir)) {
      if (file.startsWith(prefix)) {
        fs.rmSync(path.join(this.dir, file), { force: true });
        removed += 1;
      }
    }
    return removed;
  }

  stats() {
    let entries = 0;
    let usedBytes = 0;
    const now = Date.now();
    for (const file of fs.readdirSync(this.dir)) {
      if (!file.endsWith('.json')) continue;
      const full = path.join(this.dir, file);
      try {
        const meta = JSON.parse(fs.readFileSync(full, 'utf8')) as CacheEntryMeta;
        if ((now - meta.cachedAt) / 1000 > this.ttlSeconds) continue;
        entries += 1;
        usedBytes += meta.size;
      } catch {
        continue;
      }
    }
    return { entries, usedBytes, ttlSeconds: this.ttlSeconds, maxBytes: this.maxBytes };
  }

  private prune() {
    const metas: Array<{ metaPath: string; bodyPath: string; cachedAt: number; size: number }> = [];
    for (const file of fs.readdirSync(this.dir)) {
      if (!file.endsWith('.json')) continue;
      const metaPath = path.join(this.dir, file);
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as CacheEntryMeta;
        const bodyPath = path.join(this.dir, meta.bodyFile);
        if (!fs.existsSync(bodyPath)) {
          fs.rmSync(metaPath, { force: true });
          continue;
        }
        if ((Date.now() - meta.cachedAt) / 1000 > this.ttlSeconds) {
          this.removePair(metaPath, bodyPath);
          continue;
        }
        metas.push({ metaPath, bodyPath, cachedAt: meta.cachedAt, size: meta.size });
      } catch {
        fs.rmSync(metaPath, { force: true });
      }
    }
    let total = metas.reduce((sum, item) => sum + item.size, 0);
    if (total <= this.maxBytes) return;
    metas.sort((a, b) => a.cachedAt - b.cachedAt);
    for (const item of metas) {
      if (total <= this.maxBytes) break;
      total -= item.size;
      this.removePair(item.metaPath, item.bodyPath);
    }
  }

  private removePair(metaPath: string, bodyPath: string) {
    fs.rmSync(metaPath, { force: true });
    fs.rmSync(bodyPath, { force: true });
  }
}
