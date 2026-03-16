import { spawn } from "node:child_process";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runQuiet(cmd, args, { cwd, env, label } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      env,
      stdio: ["ignore", "ignore", "ignore"],
      shell: false,
    });
    child.on("error", (err) => reject(err));
    child.on("exit", (code) => {
      if (code === 0) return resolve();
      const what = label ? `${label} (${cmd} ${args.join(" ")})` : `${cmd} ${args.join(" ")}`;
      reject(new Error(`${what} failed with exit code ${code}`));
    });
  });
}

export async function waitForComposeDbReady({
  repoRoot,
  env = process.env,
  service = "db",
  user = "fastfocus",
  database = "fastfocus",
  timeoutMs = 60000,
  pollMs = 1000,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      await runQuiet("docker", ["compose", "exec", "-T", service, "pg_isready", "-U", user, "-d", database], {
        cwd: repoRoot,
        env,
        label: "pg_isready",
      });
      return;
    } catch (error) {
      lastError = error;
      await sleep(pollMs);
    }
  }

  throw new Error(
    `Postgres did not become ready within ${timeoutMs}ms${lastError ? ` (${lastError.message})` : ""}`,
  );
}
