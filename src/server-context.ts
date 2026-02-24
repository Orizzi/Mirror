import type { FastifyBaseLogger } from 'fastify';
import type { AppConfig } from './config.js';
import { FileCache } from './cache/file-cache.js';
import { MirrorDb } from './db/sqlite.js';
import { AllowlistStore } from './security/allowlist.js';

export type AppState = {
  serviceDisabled: boolean;
  startedAtMs: number;
};

export type AppServices = {
  config: AppConfig;
  db: MirrorDb;
  allowlist: AllowlistStore;
  cache: FileCache;
  state: AppState;
  logger: FastifyBaseLogger;
};
