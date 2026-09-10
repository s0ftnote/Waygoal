"use client";
import { useEffect, useState } from "react";
import type { WaygoalTicketCard, WaygoalTicketMapCard } from "@/lib/waygoal-types";

interface Props {
  map: WaygoalTicketMapCard;
  /** Null when the map itself is what is open. */
  ticket: WaygoalTicketCard | null;
  /** When this workspace's tickets were last read from disk. */
  readAt: string;
  /** Start another discussion under this ticket. Nothing is sent until the
   *  user sends: this only opens a chat with the ticket remembered. */
  onStart: (ticket: WaygoalTicketCard) => void;
  onOpenDiscussion: (sessionId: string) => void;
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

const HINT_KEY = "waygoal-ticket-hint";
const HINT = "在这张票下开始的讨论会一直挂在它下面；从讨论里分叉出去的那段也还属于这张票。收起只是不在画布上摊开，票里照样接着聊。";
/** Where the sentence comes from, said in it: it is Waygoal's own description
 *  of this entry, not anything read out of the user's chats. */
const HINT_SOURCE = "—— Waygoal 对这个入口的说明，不是从你的对话里总结的";

/** The short how-to for discussions under a ticket. It is written here, not
 *  produced from anything the user said: no chat is read and no model is
 *  called. Closing it is remembered, and it can be opened again. */
function Guidance() {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    try { setOpen(localStorage.getItem(HINT_KEY) !== "closed"); } catch { /* private mode: just show it */ }
  }, []);
  const remember = (next: boolean) => {
    setOpen(next);
    try { localStorage.setItem(HINT_KEY, next ? "open" : "closed"); } catch { /* nothing to remember it in */ }
  };
  if (!open) return <button type="button" className="waygoal-hint-open" onClick={() => remember(true)}>怎么用</button>;
  return <p className="waygoal-hint">
    <span>{HINT}<span className="waygoal-hint-source">{HINT_SOURCE}</span></span>
    <button type="button" aria-label="关闭提示" onClick={() => remember(false)}>×</button>
  </p>;
}

function Discussions({ ticket, onStart, onOpenDiscussion }: { ticket: WaygoalTicketCard } & Pick<Props, "onStart" | "onOpenDiscussion">) {
  return <div className="waygoal-ticket-talks">
    <p className="waygoal-ticket-label">这张票下的讨论</p>
    {ticket.discussions.length === 0 && <p className="waygoal-ticket-empty">还没有。开始聊，这段讨论就挂在这张票下。</p>}
    <ul>
      {ticket.discussions.map(talk => <li key={talk.sessionId} data-talk={talk.sessionId}>
        <button type="button" className="waygoal-button outlined small" disabled={talk.missing}
          onClick={() => onOpenDiscussion(talk.sessionId)}>
          {talk.missing ? "打不开" : "打开"}
        </button>
        <span className="waygoal-talk-title">{talk.title}</span>
        {talk.originSessionId && <span className="waygoal-tag">从这张票的另一段分出来</span>}
        {talk.running && <span className="waygoal-tag branch">正在运行</span>}
        {ticket.lastDiscussion?.sessionId === talk.sessionId && <span className="waygoal-tag continuing">上次在聊这段</span>}
        {talk.missing && <span className="waygoal-tag unknown">这段讨论已经不在了，画布没有替你换一段</span>}
      </li>)}
    </ul>
    <button type="button" className="waygoal-button action small" onClick={() => onStart(ticket)}>
      {ticket.discussions.length === 0 ? "在这张票下开始聊" : "另开一段讨论"}
    </button>
    <Guidance />
  </div>;
}

/** The full view of one local ticket or map: what the source file says, where
 *  it came from and when it was read. It shows the file's own text rather than
 *  a retelling, and opening it starts no Pi session. */
export function WaygoalTicketPanel({ map, ticket, readAt, onStart, onOpenDiscussion }: Props) {
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
    {/* Blocked or resolved, a ticket can still be talked about: talking is how
        a question gets answered, and it changes no status by itself. */}
    {ticket && <Discussions ticket={ticket} onStart={onStart} onOpenDiscussion={onOpenDiscussion} />}
    {/* The file itself, unchanged: structure, answers and scope as written. */}
    <pre className="waygoal-ticket-body">{body}</pre>
  </div>;
}
