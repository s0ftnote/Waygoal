import { existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { writePrivateFileAtomicSync } from "./atomic-file";
import { safePath } from "./beacon-store";
import { readRemoteResult, remoteSourcePath, remoteTicketPath, supersedes } from "./waygoal-remote";
import { sourceLinks } from "./waygoal-map";
import { workspaceDir } from "./waygoal-paths";
import { resolveBlockers } from "./waygoal-tickets";
import { remoteSourceLabel, type WaygoalReference, type WaygoalRemoteDelivery, type WaygoalRemoteId, type WaygoalTicketMapView, type WaygoalTicketView, type WaygoalWorkspaceRef } from "./waygoal-types";

/** What one delivery says, and all it says: who the source is, which ticket
 *  there, and where the raw result it produced can be read. No body — the
 *  text is Waygoal's to read from the source's own result. */
export interface WaygoalRemoteDeliveryInput extends WaygoalRemoteId {
  ref: string;
}

interface WaygoalRemoteRecord {
  version: 1;
  tickets: Record<string, WaygoalRemoteDelivery>;
}

/** Source identity is part of a card's id, so it has to be a plain name and
 *  nothing that can walk out of where the records are kept. */
const SEGMENT = /^[\p{L}\p{N}._-]+$/u;
const NUMBER = /^\d+$/;
const isName = (value: string): boolean =>
  Boolean(value) && value.split("/").every(part => SEGMENT.test(part) && part !== "." && part !== "..");

const NOT_TAKEN = (updatedAt: string | null) =>
  `收到一份更旧或顺序不明的结果（${updatedAt ?? "没有时间"}），没有采用，画布上还是已经确认的那一份。要排出先后，来源的结果里得带上它自己的更新时间。`;

/** The working directory as the host resolves it. A session started through a
 *  symlink and a canvas opened on the real path are the same workspace, so a
 *  delivery must land where the canvas will look for it. */
function realCwd(cwd: string): string {
  try { return realpathSync(cwd); } catch { return cwd; }
}

function recordPath(ref: WaygoalWorkspaceRef): string {
  return join(workspaceDir(realCwd(ref.cwd), ref.agentDir), "remote.json");
}

export function readRemoteDeliveries(ref: WaygoalWorkspaceRef): Record<string, WaygoalRemoteDelivery> {
  const path = recordPath(ref);
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<WaygoalRemoteRecord>;
    const tickets: Record<string, WaygoalRemoteDelivery> = {};
    for (const [id, delivery] of Object.entries(parsed.tickets ?? {})) {
      if (delivery && isName(delivery.source ?? "") && isName(delivery.origin ?? "") && NUMBER.test(delivery.number ?? "")
        && remoteTicketPath(delivery) === id) tickets[id] = delivery;
    }
    return tickets;
  } catch {
    // A damaged record must not take the canvas down with it; the sources are
    // still there to be delivered again.
    return {};
  }
}

function writeRemoteDeliveries(ref: WaygoalWorkspaceRef, tickets: Record<string, WaygoalRemoteDelivery>): void {
  mkdirSync(workspaceDir(realCwd(ref.cwd), ref.agentDir), { recursive: true });
  const record: WaygoalRemoteRecord = { version: 1, tickets };
  writePrivateFileAtomicSync(recordPath(ref), JSON.stringify(record, null, 2));
}

/** Read the raw result the delivery points at, from inside the working
 *  directory and nowhere else. A path the delivery wrote relative — which is
 *  how the tool asks for it — is relative to that directory, never to whatever
 *  directory this host happens to be running in. A reference that has expired is a state of its
 *  own, not an error to swallow, and the reason it could not be read is
 *  carried out as the source gave it rather than guessed at. */
function capture(cwd: string, path: string): { raw: string | null; reason: string } {
  try {
    return { raw: readFileSync(safePath(cwd, isAbsolute(path) ? path : join(cwd, path)), "utf8"), reason: "" };
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    return { raw: null, reason: `没有读到这次交付的原始结果（${why}）。原始结果要落在工作目录里；把它写回去之后可以再取一次。` };
  }
}

/** Take in one delivery and try, right then, to capture the raw result it
 *  points at — before that reference expires. The source operation and the
 *  capture are two separate facts and both are written down: a delivery whose
 *  result could not be read still leaves the ticket on the canvas, marked as
 *  not synced, and re-deliverable. */
export function deliverRemoteTicket(
  ref: WaygoalWorkspaceRef,
  input: WaygoalRemoteDeliveryInput,
  now: () => Date = () => new Date(),
): { ticket: string; captured: boolean; note: string | null } {
  if (!isName(input.source) || !isName(input.origin)) throw new Error("来源身份只能是普通名字，不能是路径。");
  if (!NUMBER.test(input.number)) throw new Error("票据编号只能是数字。");
  const id = remoteTicketPath(input);
  const tickets = readRemoteDeliveries(ref);
  const stored = tickets[id];
  const deliveredAt = now().toISOString();
  const { raw, reason } = capture(realCwd(ref.cwd), input.ref);
  const kept = stored ?? { raw: null, updatedAt: null, capturedAt: null };
  const identity = { source: input.source, origin: input.origin, number: input.number, ref: input.ref, deliveredAt };
  const read = raw === null ? null : readRemoteResult(input.source, raw);
  // A result is taken when there was nothing confirmed to protect, or when the
  // source's own time places it at or after what is already shown. Otherwise
  // the confirmed state stays exactly as it was and the reason is written down
  // beside it, so an older or unordered result never passes silently.
  const taken = read !== null && (!stored?.capturedAt || supersedes(read.updatedAt, stored.updatedAt));
  const note = read === null ? reason : taken ? read.reason : NOT_TAKEN(read.updatedAt);
  tickets[id] = taken
    ? { ...identity, capturedAt: deliveredAt, raw, updatedAt: read.updatedAt, note }
    : { ...identity, capturedAt: kept.capturedAt, raw: kept.raw, updatedAt: kept.updatedAt, note };
  writeRemoteDeliveries(ref, tickets);
  return { ticket: id, captured: taken, note };
}

/** Ask again for the raw result of a delivery whose reference could not be
 *  read. It is the same delivery and the same card — only the capture is
 *  retried, after the user has put the source's result back. */
export function retryRemoteCapture(
  ref: WaygoalWorkspaceRef,
  ticket: string,
  now: () => Date = () => new Date(),
): { ticket: string; captured: boolean; note: string | null } {
  const stored = readRemoteDeliveries(ref)[ticket];
  if (!stored) throw new Error("这张来源票据不在画布上。");
  return deliverRemoteTicket(ref, { source: stored.source, origin: stored.origin, number: stored.number, ref: stored.ref }, now);
}

/** Everything a remote body points at is left as written. Waygoal reads the
 *  source's result and nothing further: an attachment or a link in it is an
 *  address to show, never a file to fetch, and a relative path in it belongs
 *  to the source's own repository, not to this working directory. */
function remoteReferences(body: string): WaygoalReference[] {
  return sourceLinks(body).map(link => ({ ...link, kind: link.external ? "external" as const : "missing" as const, path: null }));
}

const sourceLead = (origin: string) =>
  `这是 ${origin} 的只读镜像。正文和评论都是取得那一刻的原文，来源上的改动要等下一次取得才会看到；Waygoal 不承诺实时同步，也不往来源写任何东西。`;

/** The remote sources of one workspace, each as a group of ticket cards laid
 *  out the same way a local map's are. Their premises are settled inside their
 *  own source only, so the same bare number under two sources stays two
 *  tickets that never resolve to each other. */
export function remoteMapViews(ref: WaygoalWorkspaceRef): WaygoalTicketMapView[] {
  const bySource = new Map<string, { source: string; origin: string; tickets: WaygoalTicketView[] }>();
  for (const [id, delivery] of Object.entries(readRemoteDeliveries(ref))) {
    const read = delivery.raw === null ? null : readRemoteResult(delivery.source, delivery.raw);
    const mapPath = remoteSourcePath(delivery);
    const body = read?.format === "unknown" ? "" : read?.body ?? "";
    const source = bySource.get(mapPath) ?? { source: delivery.source, origin: delivery.origin, tickets: [] };
    bySource.set(mapPath, source);
    source.tickets.push({
      id, path: id, mapPath,
      number: delivery.number,
      title: read?.title || `#${delivery.number}`,
      type: "", status: read?.status ?? "open", question: "", answer: "",
      body,
      rawBlockers: read?.blockers ?? [],
      stale: null, blockers: [], blocked: false, state: "unblocked",
      references: remoteReferences(body),
      remote: {
        source: delivery.source, origin: delivery.origin, number: delivery.number,
        url: read?.url ?? null, format: read?.format ?? "unknown",
        deliveredAt: delivery.deliveredAt, capturedAt: delivery.capturedAt,
        comments: read?.comments ?? null,
        note: delivery.note ?? read?.reason ?? null,
      },
    });
  }
  return [...bySource.entries()].map(([path, { source, origin, tickets }]) => {
    tickets.sort((a, b) => Number(a.number) - Number(b.number));
    resolveBlockers(tickets);
    return {
      path,
      title: `${remoteSourceLabel(source)} · ${origin}`,
      body: "", lead: sourceLead(origin), sections: [], references: [],
      tickets, unreadable: [], warnings: [], stale: null, remote: true,
    };
  }).sort((a, b) => a.path.localeCompare(b.path));
}
