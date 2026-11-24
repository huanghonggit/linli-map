import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";

function loadJwtSecret(dbPath) {
  if (process.env.LINLI_JWT_SECRET && process.env.LINLI_JWT_SECRET.length >= 16) {
    return process.env.LINLI_JWT_SECRET;
  }
  if (dbPath === ":memory:") {
    return randomBytes(32).toString("hex");
  }
  const secretFile = resolve(dirname(dbPath), ".jwt-secret");
  if (existsSync(secretFile)) {
    const existing = readFileSync(secretFile, "utf-8").trim();
    if (existing.length >= 32) return existing;
  }
  mkdirSync(dirname(secretFile), { recursive: true });
  const generated = randomBytes(32).toString("hex");
  writeFileSync(secretFile, generated, { mode: 0o600 });
  return generated;
}

export function loadConfig(overrides = {}) {
  const rootDir = resolve(overrides.rootDir || process.cwd());
  const dbPath =
    overrides.dbPath ||
    process.env.LINLI_DB_PATH ||
    resolve(rootDir, "data/linli.sqlite");
  return {
    rootDir,
    host: overrides.host || process.env.LINLI_API_HOST || "0.0.0.0",
    port: Number(overrides.port ?? process.env.LINLI_API_PORT ?? 8787),
    dbPath,
    jwtSecret: overrides.jwtSecret || loadJwtSecret(dbPath),
    tokenTtlSec: Number(
      overrides.tokenTtlSec ?? process.env.LINLI_TOKEN_TTL_SEC ?? 7 * 24 * 3600,
    ),
    defaultAdminUsername:
      overrides.defaultAdminUsername ||
      process.env.LINLI_ADMIN_USERNAME ||
      "admin",
    defaultAdminPassword:
      overrides.defaultAdminPassword ||
      process.env.LINLI_ADMIN_PASSWORD ||
      "Admin@123456",
    modelsDir:
      overrides.modelsDir || resolve(rootDir, "public/models/v1"),
    staticDir:
      overrides.staticDir !== undefined
        ? overrides.staticDir
        : process.env.LINLI_SERVE_STATIC === "true"
          ? resolve(rootDir, "dist")
          : null,
    rateLimitDisabled: Boolean(overrides.rateLimitDisabled),
  };
}
