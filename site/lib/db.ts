import postgres from "postgres";

// One pooled client per server instance, lazily initialized so build-time
// type-checks don't crash when DATABASE_URL isn't set.
let sql: ReturnType<typeof postgres> | null = null;

export function db() {
  if (sql) return sql;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("database-env-missing: set DATABASE_URL");
  sql = postgres(url, {
    max: 5,                  // small pool — serverless functions are short-lived
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,          // Neon pooled connections don't support prepared statements
  });
  return sql;
}
