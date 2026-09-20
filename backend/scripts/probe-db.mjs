/**
 * Aurora Serverless v2 connectivity probe.
 *
 *   node backend/scripts/probe-db.mjs
 *
 * Confirms the writer endpoint is reachable and reports which Aurora instance
 * answered, which is the quickest way to tell a failover from a bad password.
 */

import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const url = process.env.DATABASE_URL?.trim();
if (!url) {
  console.error(
    "NO_DATABASE_URL — set the Aurora writer endpoint, or use DATABASE_SECRET_ID in the app."
  );
  process.exit(1);
}

const label = url.replace(/:[^:@]+@/, ":***@");
const pool = new pg.Pool({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15_000,
});

try {
  const { rows } = await pool.query(
    // aurora_version() is absent on plain RDS/local Postgres; coalesce keeps
    // the probe useful in both places.
    `SELECT current_database()                           AS db,
            inet_server_addr()::text                     AS server,
            pg_is_in_recovery()                          AS is_reader,
            COALESCE(
              (SELECT setting FROM pg_settings WHERE name = 'server_version'),
              'unknown'
            )                                            AS version`
  );
  const row = rows[0];
  console.log(`WIN  ${label}`);
  console.log(
    `     db=${row.db} server=${row.server ?? "n/a"} ` +
      `role=${row.is_reader ? "reader" : "writer"} pg=${row.version}`
  );
  await pool.end();
  process.exit(0);
} catch (err) {
  console.error(`FAIL ${label}`);
  console.error(`     ${err instanceof Error ? err.message : err}`);
  await pool.end().catch(() => {});
  process.exit(1);
}
