import dns from "node:dns";
import pg from "pg";
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { awsBase } from "../aws/clients.js";
import { config } from "../config.js";

dns.setDefaultResultOrder("ipv4first");

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function dbConfigured(): boolean {
  return Boolean(config.databaseUrl || config.databaseSecretId);
}

/** The shape RDS writes when it manages a master-user secret. */
interface AuroraSecret {
  username: string;
  password: string;
  host?: string;
  port?: number;
  dbname?: string;
  engine?: string;
}

/**
 * Credentials for Amazon Aurora Serverless v2 (PostgreSQL).
 *
 * Preferred path is `DATABASE_SECRET_ID`: RDS owns the password, rotates it on a
 * schedule, and nothing in the repo or the task definition ever holds it. A
 * plain `DATABASE_URL` still works for local development.
 */
async function resolveConnection(): Promise<pg.PoolConfig> {
  if (config.databaseSecretId) {
    const client = new SecretsManagerClient(awsBase());
    const res = await client.send(
      new GetSecretValueCommand({ SecretId: config.databaseSecretId })
    );
    const secret = JSON.parse(res.SecretString ?? "{}") as AuroraSecret;
    if (!secret.username || !secret.password) {
      throw new Error(
        `Secret ${config.databaseSecretId} has no username/password — is it an RDS-managed secret?`
      );
    }
    const host = secret.host ?? process.env.DATABASE_HOST ?? "";
    if (!host) {
      throw new Error(
        "Aurora endpoint unknown — the secret has no host and DATABASE_HOST is unset"
      );
    }
    console.log(`[db] Aurora credentials from Secrets Manager · ${host}`);
    return {
      host,
      port: secret.port ?? 5432,
      user: secret.username,
      password: secret.password,
      database: secret.dbname ?? "rakshak",
    };
  }

  if (!config.databaseUrl) {
    throw new Error(
      "DATABASE_URL is not set — add the Aurora Serverless v2 (PostgreSQL) endpoint to .env"
    );
  }
  return { connectionString: config.databaseUrl };
}

async function poolConfig(): Promise<pg.PoolConfig> {
  return {
    ...(await resolveConnection()),
    // Aurora terminates TLS with an Amazon RDS certificate. `rejectUnauthorized`
    // stays false so the demo works without shipping the RDS CA bundle; set
    // DATABASE_CA to the bundle path to verify it properly.
    ssl: process.env.DATABASE_CA
      ? { ca: process.env.DATABASE_CA, rejectUnauthorized: true }
      : { rejectUnauthorized: false },
    // Aurora Serverless v2 scales capacity, not the connection ceiling — keep the
    // per-task pool small so many tasks can share one writer.
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
  };
}

export async function getPool(): Promise<pg.Pool> {
  if (!dbConfigured()) {
    throw new Error(
      "DATABASE_URL is not set — add the Aurora Serverless v2 (PostgreSQL) endpoint to .env"
    );
  }
  if (!pool) {
    pool = new Pool(await poolConfig());
    pool.on("error", (err) => {
      // A failover promotes the reader; pg surfaces that as an idle client error.
      // Dropping the pool makes the next query reconnect to the new writer.
      console.error("[db] idle client error:", err.message);
      pool = null;
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
