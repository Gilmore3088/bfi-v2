import postgres from "postgres";

declare global {
  // eslint-disable-next-line no-var
  var __bfiPg: ReturnType<typeof postgres> | undefined;
}

function createClient() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }
  return postgres(url, {
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
  });
}

export const sql = global.__bfiPg ?? createClient();

if (process.env.NODE_ENV !== "production") {
  global.__bfiPg = sql;
}
