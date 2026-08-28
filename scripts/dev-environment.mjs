import { existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

export const REPOSITORY_ROOT = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
export const DEMO_HOME = join(REPOSITORY_ROOT, ".dev-home");
export const DEMO_CLAUDE_HOME = join(DEMO_HOME, ".claude");
export const DIST_DIR = join(REPOSITORY_ROOT, "dist");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with status ${result.status}`);
  }
}

function runNpm(args, options = {}) {
  if (process.platform === "win32") {
    run(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "npm", ...args], options);
    return;
  }
  run("npm", args, options);
}

/** Recreate a safe, synthetic Claude Code data tree for local demos. */
export function prepareDemoHome(demoHome = DEMO_HOME) {
  rmSync(demoHome, { recursive: true, force: true });
  run(process.execPath, [join(REPOSITORY_ROOT, "docs", "make-demo-home.mjs"), demoHome]);
}

/** Remove only the generated synthetic data tree. */
export function cleanupDemoHome(demoHome = DEMO_HOME) {
  rmSync(demoHome, { recursive: true, force: true });
}

export function installDependencies() {
  runNpm(["ci"], { cwd: REPOSITORY_ROOT });
}

export function runDemo() {
  if (!existsSync(DEMO_CLAUDE_HOME)) {
    throw new Error("Demo data is missing. Run `npm run setup` first.");
  }
  runNpm(["run", "dev"], {
    cwd: REPOSITORY_ROOT,
    env: { ...process.env, CLAUDETUI_HOME: DEMO_CLAUDE_HOME },
  });
}
