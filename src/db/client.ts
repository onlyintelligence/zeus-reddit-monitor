import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";
import { env } from "../env.js";

let _db: ReturnType<typeof drizzle<typeof schema>> | undefined;
let _sql: ReturnType<typeof postgres> | undefined;

export function db() {
  if (!_db) {
    _sql = postgres(env().DATABASE_URL, { max: 5, prepare: false });
    _db = drizzle(_sql, { schema });
  }
  return _db;
}
export async function closeDb() { await _sql?.end(); }
export { schema };
