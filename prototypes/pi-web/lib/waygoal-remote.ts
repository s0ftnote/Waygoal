import { mapSections } from "./waygoal-map";
import type { WaygoalRemoteComment, WaygoalRemoteId, WaygoalRemoteRead } from "./waygoal-types";

/** The one GitHub shape Waygoal reads: what `gh issue view <n> --json …`
 *  answers. Anything else from `gh` is left unsupported rather than guessed
 *  at — a body scraped out of prose is not the source's own text. */
const GITHUB_COMMAND = "gh issue view <编号> --json number,title,state,stateReason,body,url,updatedAt,comments";

/** The offline sample's shape, which exists to hold the boundary: one file,
 *  the same fields, no second platform integration behind it. */
const CUSTOM_SHAPE = "{ \"tracker\": \"custom\", \"id\", \"title\", \"state\", \"body\", \"updatedAt\" }";

const unsupported = (reason: string): WaygoalRemoteRead => ({
  format: "unknown", number: "", title: "", status: "open", body: "",
  url: null, updatedAt: null, comments: null, blockers: [], reason,
});

/** GitHub names a comment's author with an object, the offline sample with a
 *  plain string. Either way it is one name, and a comment the source left
 *  unnamed stays unnamed rather than being attributed to anyone. */
function authorOf(value: unknown): string {
  if (typeof value === "string") return value;
  const login = (value as { login?: unknown } | null)?.login;
  return typeof login === "string" ? login : "";
}

/** Only what the source itself wrote counts as a comment. A result that never
 *  carried comments comes back null: not asked for is not the same as none. */
function commentsOf(value: unknown): WaygoalRemoteComment[] | null {
  if (!Array.isArray(value)) return null;
  return (value as Record<string, unknown>[]).map(comment => ({
    author: authorOf(comment?.author),
    body: String(comment?.body ?? ""),
    createdAt: String(comment?.createdAt ?? ""),
  }));
}

/** The premises the source's own text names, in that source's own numbering.
 *  They are settled later against that source's tickets only, so a bare `7`
 *  here never binds to a `7` somewhere else. */
function githubBlockers(body: string): string[] {
  const section = mapSections(body).find(s => /^blocked by$/i.test(s.heading.trim()));
  const numbers = section?.body.match(/\/issues\/(\d+)/g) ?? [];
  return [...new Set(numbers.map(match => String(Number(match.split("/").at(-1)))))];
}

/** One `gh issue view --json` result. Closed is said twice over there — the
 *  state and the reason — and only "completed" is a question that was
 *  answered; "not planned" was dropped. Both land on the words the local
 *  tracker already uses, so relations are settled the same way for both. */
function readGithub(parsed: Record<string, unknown>): WaygoalRemoteRead | null {
  if (typeof parsed.number !== "number" && typeof parsed.number !== "string") return null;
  const body = String(parsed.body ?? "");
  const state = String(parsed.state ?? "").toUpperCase();
  const closed = state === "CLOSED";
  return {
    format: "github",
    number: String(Number(parsed.number)),
    title: String(parsed.title ?? ""),
    status: !closed ? "open" : String(parsed.stateReason ?? "").toUpperCase() === "NOT_PLANNED" ? "cancelled" : "resolved",
    body,
    url: typeof parsed.url === "string" && parsed.url ? parsed.url : null,
    updatedAt: typeof parsed.updatedAt === "string" && parsed.updatedAt ? parsed.updatedAt : null,
    comments: commentsOf(parsed.comments),
    blockers: githubBlockers(body),
    reason: null,
  };
}

const CUSTOM_STATUS: Record<string, string> = { open: "open", closed: "resolved", dropped: "cancelled", cancelled: "cancelled" };

/** The offline sample. It exists to hold the boundary — one file, the same
 *  fields — so there is no second platform integration behind it. */
function readCustom(parsed: Record<string, unknown>): WaygoalRemoteRead | null {
  if (parsed.tracker !== "custom" || (typeof parsed.id !== "string" && typeof parsed.id !== "number")) return null;
  const state = String(parsed.state ?? "open").toLowerCase();
  return {
    format: "custom",
    number: String(parsed.id),
    title: String(parsed.title ?? ""),
    status: CUSTOM_STATUS[state] ?? state,
    body: String(parsed.body ?? ""),
    url: typeof parsed.url === "string" && parsed.url ? parsed.url : null,
    updatedAt: typeof parsed.updatedAt === "string" && parsed.updatedAt ? parsed.updatedAt : null,
    comments: commentsOf(parsed.comments),
    blockers: Array.isArray(parsed.blockedBy) ? parsed.blockedBy.map(n => String(Number(n))) : [],
    reason: null,
  };
}

/** Turn one raw result, as the source itself produced it, into the fields the
 *  canvas shows. `source` is the delivered source identity and nothing else
 *  chooses the format: a result that does not match the format its own source
 *  claims is reported unsupported rather than half-read. */
export function readRemoteResult(source: string, raw: string): WaygoalRemoteRead {
  if (source !== "github" && source !== "custom") {
    return unsupported(`Waygoal 还不支持来源「${source}」，目前只读 GitHub 和离线自定义样本。`);
  }
  const wanted = source === "github" ? `请用 ${GITHUB_COMMAND}。` : `请用 ${CUSTOM_SHAPE}。`;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return unsupported(`这不是 Waygoal 能读的${source === "github" ? " GitHub 结果" : "自定义样本"}。${wanted}`);
  }
  return (source === "github" ? readGithub(parsed) : readCustom(parsed))
    ?? unsupported(`这份结果缺少 Waygoal 需要的字段。${wanted}`);
}

/** Which source a ticket came from, as one path-shaped id. Remote ids live
 *  under `remote/` so they never collide with a workspace-relative file path,
 *  and the source is part of the id so the same bare number under two sources
 *  stays two tickets. */
export const REMOTE_PREFIX = "remote/";
export const remoteSourcePath = (id: Pick<WaygoalRemoteId, "source" | "origin">): string =>
  `${REMOTE_PREFIX}${id.source}/${id.origin}`;
export const remoteTicketPath = (id: WaygoalRemoteId): string => `${remoteSourcePath(id)}/${id.number}`;

/** Whether an incoming result may replace one the canvas has already
 *  confirmed. The source's own time is the only order there is, and ordering
 *  takes two of them: a result with no time, and a confirmed state that was
 *  captured without one, are both simply unordered, and neither is grounds for
 *  replacing what the user has been shown. Equal times pass, so re-delivering
 *  the same result is a retry rather than a conflict. */
export function supersedes(incoming: string | null, stored: string | null): boolean {
  if (!incoming || !stored) return false;
  return incoming >= stored;
}
