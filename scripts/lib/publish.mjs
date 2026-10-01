// Publishes the Scout snapshot to the public `scout-data` branch of this repo,
// where pm-brief.com reads it (raw.githubusercontent.com sends CORS headers).
// The branch holds exactly one commit that is force-replaced on every publish,
// so it never accumulates history. Uses the Mac's normal git credentials;
// GIT_TERMINAL_PROMPT=0 makes a missing credential fail fast instead of
// hanging the hourly launchd job.

import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, copyFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const PUBLISH_BRANCH = "scout-data";
export const PUBLIC_SNAPSHOT_URL = "https://raw.githubusercontent.com/ear2earGrin/crypto-entry-checker/scout-data/latest.json";

export function publishSnapshot({ root, file, workDir }) {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
  const git = (args, cwd = workDir) =>
    execFileSync("git", args, { cwd, env, stdio: ["ignore", "pipe", "pipe"], timeout: 90000 }).toString().trim();

  const remote = git(["remote", "get-url", "origin"], root);
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });
  git(["init", "-q"]);
  git(["checkout", "-q", "-b", PUBLISH_BRANCH]);
  copyFileSync(file, join(workDir, "latest.json"));
  writeFileSync(join(workDir, "README.md"),
    "# scout-data\n\nAuto-published by `scripts/scout.mjs` on the owner's Mac mini and force-replaced every hour.\n" +
    "Read by the SCOUT tab on pm-brief.com. Don't edit or branch from it.\n");
  git(["add", "latest.json", "README.md"]);
  git(["-c", "user.name=Narrative Scout", "-c", "user.email=scout@localhost", "-c", "commit.gpgsign=false",
    "commit", "-q", "-m", `Scout snapshot ${new Date().toISOString()}`]);
  git(["push", "-q", "--force", remote, `HEAD:refs/heads/${PUBLISH_BRANCH}`]);
}
