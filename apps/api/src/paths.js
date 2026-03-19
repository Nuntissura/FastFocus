import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function envOrNull(name) {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : null;
}

function pathExists(targetPath) {
  try {
    return fs.existsSync(targetPath);
  } catch {
    return false;
  }
}

export function resolveRepoRoot() {
  const thisFile = fileURLToPath(import.meta.url);
  const thisDir = path.dirname(thisFile);
  return path.resolve(thisDir, "..", "..", "..");
}

export function resolveWorkspaceRoot() {
  const override = envOrNull("FF_WORKSPACE_ROOT");
  if (override) return path.resolve(override);

  const repoRoot = resolveRepoRoot();
  // Expected layout: <workspaceRoot>/FF - worktrees/fastfocus_platform
  return path.resolve(repoRoot, "..", "..");
}

export function resolveGovRoot() {
  const override = envOrNull("FF_GOV_ROOT");
  if (override) return path.resolve(override);

  // Deployment-friendly fallback: if the product repo contains an in-repo
  // runtime snapshot, prefer that over the sibling workspace layout.
  const repoSnapshot = path.resolve(resolveRepoRoot(), "gov-snapshot");
  if (pathExists(repoSnapshot)) return repoSnapshot;

  const workspaceRoot = resolveWorkspaceRoot();
  return path.resolve(workspaceRoot, "FF - gov");
}

export function resolveGovContractsRoot() {
  return path.resolve(resolveGovRoot(), "data_contracts");
}

export function resolveGovSpecCurrentPath() {
  return path.resolve(resolveGovRoot(), "SPEC_CURRENT.md");
}

export function assertPathsExist(pathsToCheck) {
  const missing = [];
  for (const { label, targetPath } of pathsToCheck) {
    if (!fs.existsSync(targetPath)) missing.push({ label, targetPath });
  }
  if (missing.length > 0) {
    const lines = missing.map((m) => `- ${m.label}: ${m.targetPath}`);
    const hint = [
      "Missing required workspace paths:",
      ...lines,
      "",
      "Fix by either:",
      "- keeping an in-repo `gov-snapshot/` directory, or",
      "- keeping the expected workspace layout (FF - gov/ and FF - worktrees/ as siblings), or",
      "- setting FF_WORKSPACE_ROOT / FF_GOV_ROOT environment variables.",
    ].join("\n");
    throw new Error(hint);
  }
}
