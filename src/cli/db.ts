import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { loadConfig, type AppConfig } from "../config.js";
import { applyMigrations } from "../db/migrate.js";
import { FeedService } from "../modules/feeds/feed.service.js";
import { FeedRepository } from "../modules/feeds/feed.repository.js";
import { createTokenService } from "../modules/feeds/token.service.js";

export function openDatabase(databasePath?: string): {
  db: Database.Database;
  config: AppConfig;
} {
  const config = loadConfig({
    ...process.env,
    ...(databasePath ? { DATABASE_PATH: databasePath } : {}),
  });
  mkdirSync(dirname(config.databasePath), { recursive: true });
  const db = new Database(config.databasePath);
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  applyMigrations(db);
  return { db, config };
}

export function createFeedService(
  db: Database.Database,
  config: AppConfig,
): FeedService {
  return new FeedService(
    config,
    createTokenService(config),
    new FeedRepository(db),
  );
}

export function testSecretsEnv(): Record<string, string> {
  return {
    TOKEN_PEPPER: Buffer.alloc(32, 1).toString("base64"),
    UID_SECRET: Buffer.alloc(32, 2).toString("base64"),
    ALLOWED_ORIGINS: "https://learn.example-school.edu.au",
  };
}
