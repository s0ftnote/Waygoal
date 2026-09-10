"use client";
import type { WaygoalTicketCard, WaygoalTicketMapCard } from "@/lib/waygoal-types";

interface Props {
  map: WaygoalTicketMapCard;
  /** Null when the map itself is what is open. */
  ticket: WaygoalTicketCard | null;
  /** When this workspace's tickets were last read from disk. */
  readAt: string;
}

/** A ticket's own status, and a blocker's, read the same way everywhere. */
export const statusClass = (status: string): string => status === "resolved" ? "done" : "waiting";

function readTime(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? iso : at.toLocaleString("zh-CN", { hour12: false });
}

function Blockers({ ticket }: { ticket: WaygoalTicketCard }) {
  if (ticket.blockers.length === 0) return null;
  return <p className="waygoal-ticket-blockers">
    <span className="waygoal-ticket-label">依赖</span>
    {ticket.blockers.map(blocker => <span key={`${blocker.number}-${blocker.path ?? "?"}`}
      className={`waygoal-tag ${blocker.unknown ? "unknown" : statusClass(blocker.status ?? "")}`}
      title={blocker.path ?? undefined}>
      {blocker.number}
      {blocker.unknown === "missing" ? " · 这张地图里找不到"
        : blocker.unknown === "ambiguous" ? " · 同号有多份，无法确定"
        : ` · ${blocker.status}`}
    </span>)}
  </p>;
}

/** The full view of one local ticket or map: what the source file says, where
 *  it came from and when it was read. It shows the file's own text rather than
 *  a retelling, and opening it starts no Pi session. */
export function WaygoalTicketPanel({ map, ticket, readAt }: Props) {
  const stale = ticket ? ticket.stale : map.stale;
  const path = ticket ? ticket.path : map.path;
  const body = ticket ? ticket.body : map.body;
  return <div className="waygoal-ticket-panel">
    <div className="waygoal-ticket-head">
      {/* The panel header already names it; this is what the file says about it. */}
      <p className="waygoal-ticket-meta">
        {ticket && <><span className="waygoal-tag">{ticket.type}</span><span className={`waygoal-tag ${statusClass(ticket.status)}`}>{ticket.status}</span></>}
        {ticket && <span className="waygoal-ticket-map">来自「{map.title}」</span>}
      </p>
      {ticket && <Blockers ticket={ticket} />}
      <p className="waygoal-ticket-source">
        <span className="waygoal-ticket-label">来源</span><code>{path}</code>
        <span className="waygoal-ticket-label">读取于</span>{readTime(stale ? stale.lastReadAt : readAt)}
      </p>
      {stale && <p role="status" className="waygoal-ticket-stale">{stale.reason}最后一次读到是 {readTime(stale.lastReadAt)}，{readTime(stale.checkedAt)} 再读时还是读不到，所以下面的内容不能当作现在的状态。</p>}
      {!ticket && map.unreadable.length > 0 && <p role="status" className="waygoal-ticket-stale">
        这张地图下有读不出来的文件：{map.unreadable.map(u => u.path).join("、")}。
      </p>}
      {!ticket && map.warnings.map(warning => <p key={warning} role="status" className="waygoal-ticket-stale">{warning}</p>)}
    </div>
    {/* The file itself, unchanged: structure, answers and scope as written. */}
    <pre className="waygoal-ticket-body">{body}</pre>
  </div>;
}
