import pg from "pg";

const { Pool } = pg;

function envNumber(name, fallback) {
  const raw = process.env[name];
  if (!raw || !raw.trim()) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

export function createPoolFromEnv() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return null;

  return new Pool({
    connectionString,
    max: envNumber("PGPOOL_MAX", 10),
    idleTimeoutMillis: envNumber("PGPOOL_IDLE_TIMEOUT_MS", 30_000),
    connectionTimeoutMillis: envNumber("PGPOOL_CONN_TIMEOUT_MS", 2_000),
  });
}

