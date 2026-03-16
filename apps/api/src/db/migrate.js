import fs from "node:fs/promises";
import path from "node:path";

import pg from "pg";
import { resolveGovContractsRoot } from "../paths.js";

const { Client } = pg;

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("Missing DATABASE_URL.");
    console.error("Example:");
    console.error("  DATABASE_URL=postgres://fastfocus:fastfocus@127.0.0.1:55432/fastfocus");
    process.exitCode = 2;
    return;
  }

  const contractsRoot = resolveGovContractsRoot();
  const sqlPath = path.resolve(contractsRoot, "postgres_schema.sql");
  const sql = await fs.readFile(sqlPath, "utf-8");

  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query(sql);
    console.log("Applied schema OK.");
    console.log("Source:", "FF - gov/data_contracts/postgres_schema.sql");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
