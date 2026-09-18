import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const del = await pool.query(
  `DELETE FROM users WHERE username = $1 OR email = $2 RETURNING username, email`,
  ["e2e1785269245", "e2e@test.com"]
);
console.log("deleted", del.rowCount, del.rows);

await pool.end();
