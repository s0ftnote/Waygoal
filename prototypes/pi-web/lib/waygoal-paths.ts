import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { projectIdentityKey } from "./project-identity";

// Records live under Pi's agent directory, apart from the plugin code, and
// are split per workspace from the start (ADR 0001). Nothing here sends
// messages or touches Pi session files.
export function waygoalRoot(agentDir = getAgentDir()): string {
  return join(agentDir, "waygoal");
}

/** A working directory's identity: the path, not the folder name. Two
 *  directories that show the same name are two workspaces. */
export function workspaceId(cwd: string): string {
  const key = projectIdentityKey(cwd);
  const hash = createHash("sha1").update(key).digest("hex").slice(0, 12);
  const label = basename(key).replace(/[^\p{L}\p{N}_-]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "workspace";
  return `${label}-${hash}`;
}

export function workspaceDir(cwd: string, agentDir = getAgentDir()): string {
  return join(waygoalRoot(agentDir), "workspaces", workspaceId(cwd));
}

export function normalizeWorkspaceInput(input: string): string {
  const trimmed = input.trim();
  if (trimmed === "~") return homedir();
  if (trimmed.startsWith("~/")) return resolve(homedir(), trimmed.slice(2));
  return resolve(trimmed);
}
