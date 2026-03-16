import fs from "node:fs/promises";
import path from "node:path";

function safeResolveWithin(rootDir, leafName) {
  if (!leafName || typeof leafName !== "string") return null;
  if (!/^[a-zA-Z0-9._-]+$/.test(leafName)) return null;

  const candidate = path.resolve(rootDir, leafName);
  const rootResolved = path.resolve(rootDir) + path.sep;
  if (!candidate.startsWith(rootResolved)) return null;
  return candidate;
}

export async function listContractFiles(contractsRoot) {
  const entries = await fs.readdir(contractsRoot, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .sort();

  const schemaFiles = files.filter((name) => name.endsWith(".schema.json"));
  const otherFiles = files.filter((name) => !name.endsWith(".schema.json"));

  return { schemaFiles, otherFiles };
}

export async function readSchemaJson(contractsRoot, schemaFile) {
  const resolved = safeResolveWithin(contractsRoot, schemaFile);
  if (!resolved) return null;
  const text = await fs.readFile(resolved, "utf-8");
  return JSON.parse(text);
}

export async function readPostgresSchemaSql(contractsRoot) {
  const resolved = safeResolveWithin(contractsRoot, "postgres_schema.sql");
  if (!resolved) return null;
  return await fs.readFile(resolved, "utf-8");
}

