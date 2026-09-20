import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readRemoteDeliveries, saveRemoteRelations } from "./remote-store";
import type { WaygoalRemoteId, WaygoalWorkspaceRef } from "../../shared/waygoal-types";

const exec = promisify(execFile);
export type GithubRead = (endpoint: string, list: boolean) => Promise<unknown>;
const githubRead: GithubRead = async (endpoint, list) => {
  const { stdout } = await exec("gh", ["api", endpoint, ...(list ? ["--paginate", "--slurp"] : [])], {
    timeout: 15_000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, GH_PROMPT_DISABLED: "1" },
  });
  return JSON.parse(stdout);
};

function identity(issue: unknown): WaygoalRemoteId {
  const url = (issue as { html_url?: unknown })?.html_url;
  const match = typeof url === "string" && /^https:\/\/github\.com\/([^/]+\/[^/]+)\/issues\/(\d+)$/.exec(url);
  if (!match) throw new Error("GitHub 返回了无法识别的票据身份");
  return { source: "github", origin: match[1], number: match[2] };
}
function listIdentities(pages: unknown): WaygoalRemoteId[] {
  if (!Array.isArray(pages) || !pages.every(Array.isArray)) throw new Error("GitHub 关系列表格式不完整");
  return pages.flat().map(identity);
}

/** Explicit, read-only refresh. Never called by canvas polling. Keep the last
 * confirmed relationships on errors; a failed read is not an empty graph. */
export async function refreshRemoteRelations(ref: WaygoalWorkspaceRef, id: string, read: GithubRead = githubRead) {
  const ticket = readRemoteDeliveries(ref)[id];
  if (!ticket) throw new Error("这张票据还没有交付到画布");
  if (ticket.source !== "github") return { refreshed: false, note: "此来源暂不支持刷新关系" };
  const base = `repos/${ticket.origin}/issues/${ticket.number}`;
  try {
    const [parent, children, blockedBy] = await Promise.all([
      read(`${base}/parent`, false).catch(error => {
        if (String(error?.stderr ?? error?.message).includes("HTTP 404")) return null;
        throw error;
      }),
      read(`${base}/sub_issues?per_page=100`, true),
      read(`${base}/dependencies/blocked_by?per_page=100`, true),
    ]);
    const relations = { parent: parent === null ? null : identity(parent), children: listIdentities(children),
      blockedBy: listIdentities(blockedBy), readAt: new Date().toISOString() };
    const saved = saveRemoteRelations(ref, id, ticket.deliveredAt, relations, null);
    return { refreshed: saved, note: saved ? null : "票据已更新，请重新刷新关系" };
  } catch (error) {
    const note = `关系读取失败，保留上次结果：${error instanceof Error ? error.message.split("\n")[0] : String(error)}`;
    saveRemoteRelations(ref, id, ticket.deliveredAt, null, note);
    return { refreshed: false, note };
  }
}
