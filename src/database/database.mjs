import pg from "pg";
let pool;
export function database() {
  if (!process.env.DB_PASSWORD)
    throw new Error(
      "Database credentials are missing. Configure backend/.env and run npm.cmd run start:dev from backend/.",
    );
  return (pool ??= new pg.Pool({
    host: process.env.DB_HOST || "db",
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME || "kynetis_local",
    user: process.env.DB_USER || "app_user",
    password: process.env.DB_PASSWORD,
    max: 8,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    statement_timeout: 10000,
  }));
}
export async function dbStatus(db = database()) {
  const { rows } = await db.query(
    "SELECT current_database() AS database, to_regclass('kynetis.users') IS NOT NULL AND to_regclass('kynetis.workspaces') IS NOT NULL AS schema_ready",
  );
  return {
    databaseConnected: true,
    schemaReady: rows[0].schema_ready,
    database: rows[0].database,
  };
}
