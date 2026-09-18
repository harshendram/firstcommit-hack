import dns from "node:dns";
import dnsPromises from "node:dns/promises";
import pg from "pg";
import { config } from "../config.js";

dns.setDefaultResultOrder("ipv4first");

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function dbConfigured(): boolean {
  return Boolean(config.databaseUrl);
}

/**
 * Build pool options. Supabase `db.<ref>.supabase.co` is often AAAA-only;
 * Node on Windows can throw ENOTFOUND for that — resolve IPv6 and set TLS
 * servername so SSL still validates the hostname.
 */
async function poolConfig(): Promise<pg.PoolConfig> {
  const connectionString = config.databaseUrl;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set — add your Supabase Postgres URI to .env"
    );
  }

  const base: pg.PoolConfig = {
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 5,
    connectionTimeoutMillis: 15_000,
  };

  try {
    const normalized = connectionString.replace(/^postgresql:/i, "http:");
    const u = new URL(normalized);
    if (!u.hostname.startsWith("db.") || !u.hostname.endsWith(".supabase.co")) {
      return base;
    }

    let address: string | undefined;
    let family: number | undefined;
    try {
      const looked = await dnsPromises.lookup(u.hostname, { verbatim: true });
      address = looked.address;
      family = looked.family;
    } catch {
      try {
        const v6 = await dnsPromises.resolve6(u.hostname);
        address = v6[0];
        family = 6;
      } catch {
        /* fall through to connectionString — may work on hosts with working IPv6 */
      }
    }

    if (family !== 6 || !address) return base;

    console.log(`[db] using IPv6 ${address} for ${u.hostname}`);
    return {
      host: address,
      port: Number(u.port || 5432),
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: decodeURIComponent(u.pathname.replace(/^\//, "")) || "postgres",
      ssl: { rejectUnauthorized: false, servername: u.hostname },
      max: 5,
      connectionTimeoutMillis: 15_000,
    };
  } catch (err) {
    console.warn(
      "[db] IPv6 resolve fallback skipped:",
      err instanceof Error ? err.message : err
    );
    return base;
  }
}

export async function getPool(): Promise<pg.Pool> {
  if (!config.databaseUrl) {
    throw new Error(
      "DATABASE_URL is not set — add your Supabase Postgres URI to .env"
    );
  }
  if (!pool) {
    pool = new Pool(await poolConfig());
    pool.on("error", (err) => {
      console.error("[db] idle client error:", err.message);
    });
  }
  return pool;
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<pg.QueryResult<T>> {
  const p = await getPool();
  return p.query<T>(text, params);
}
