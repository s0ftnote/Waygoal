"use client";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { mapSections, mapLead } from "@/lib/waygoal/map";
import { remoteSourceLabel } from "@/lib/waygoal/labels";
import { canOpen, needsCheck, type WaygoalReference, type WaygoalRemoteInfo, type WaygoalTicketBlocker, type WaygoalTicketCard, type WaygoalTicketMapCard, type WaygoalTicketState } from "@/lib/waygoal/types";

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
  /** Go where the source says to go. Only a place it can reach is passed in. */
  onOpenReference: (reference: WaygoalReference) => void;
  /** Show this map's check note again after it was put away. */
  onReopenCheck: () => void;
  /** Try again to read the raw result this remote ticket was delivered with,
   *  after the source's result has been put back. */
  onRetryRemote: (ticket: WaygoalTicketCard) => void;
  onRefreshRelations: (ticket: WaygoalTicketCard) => Promise<void>;
}

/** Where a ticket stands, coloured the same way everywhere it is shown. */
export const stateClass = (state: WaygoalTicketState): string =>
  state === "resolved" ? "done" : state === "cancelled" ? "dropped" : state === "unblocked" ? "unblocked" : "waiting";

/** A premise, coloured by whether it is met, still being worked on, or a
 *  relation nobody can settle by reading. */
export const blockerClass = (blocker: WaygoalTicketBlocker): string =>
  blocker.holding === null ? "done" : needsCheck(blocker) ? "unknown" : "waiting";

/** What one premise still needs, when reading cannot settle it. Each of these
 *  is a relation the source has to change; until it does, the ticket waits. */
const HOLD_NOTE = {
  cancelled: "取消不等于解决；要放行，请在来源里改掉这条依赖",
  missing: "这张地图里找不到",
  ambiguous: "同号有多份，无法确定",
  unreadable: "现在读不到它，读不到就不算解决",
} as const;

function readTime(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? iso : at.toLocaleString("zh-CN", { hour12: false });
}

/** Every `Blocked by:` reference as the source spells it, and what each one
 *  still needs. A premise nobody can settle by reading is named as such: the
 *  ticket keeps waiting until the source says what the relation means now. */
function Blockers({ ticket }: { ticket: WaygoalTicketCard }) {
  if (ticket.blockers.length === 0) return null;
  const unsettled = ticket.blockers.filter(needsCheck).length;
  return <div className="waygoal-ticket-blockers">
    <p>
      <span className="waygoal-ticket-label">依赖</span>
      {ticket.blockers.map(blocker => <span key={`${blocker.number}-${blocker.path ?? "?"}`}
        className={`waygoal-tag ${blockerClass(blocker)}`} title={blocker.path ?? undefined}>
        {blocker.number}{blocker.status ? ` · ${blocker.status}` : ""}
        {blocker.holding && blocker.holding !== "waiting" ? ` · ${HOLD_NOTE[blocker.holding]}` : ""}
      </span>)}
    </p>
    {/* Unblocking is a change of state and nothing else: it does not finish
        this ticket, start a discussion, or close the map it belongs to. */}
    {ticket.state === "unblocked" && <p className="waygoal-ticket-unblocked" role="status">前提都满足了，这张票可以往下走。</p>}
    {unsettled > 0 && <p className="waygoal-ticket-check" role="status">
      有 {unsettled} 条依赖要在来源里核对；核对之前，这张票还在等。
    </p>}
  </div>;
}

/** What each kind of place the source names can be done with, said in the
 *  words the situation deserves: a place Waygoal cannot reach is named as
 *  unreachable rather than swapped for something with a similar name. */
const REFERENCE_NOTE = {
  ticket: "这张地图里的票据",
  file: "这个工作目录里的文件",
  missing: "按来源写的地址找不到，没有替你换成相近的东西",
  external: "站外地址，原样列出，没有替你打开",
} as const;

/** Everywhere this file explicitly points at, as it wrote it. Nothing here is
 *  guessed from wording or from a similar title: a place is listed only
 *  because the source wrote it as a link. */
function References({ references, onOpen }: { references: WaygoalReference[]; onOpen: Props["onOpenReference"] }) {
  if (references.length === 0) return null;
  return <div className="waygoal-ticket-refs">
    <p className="waygoal-ticket-label">来源指向</p>
    <ul>
      {references.map(reference => <li key={reference.target} data-reference={reference.target} data-reference-kind={reference.kind}>
        {canOpen(reference)
          ? <button type="button" className="waygoal-button outlined small" data-reference-open={reference.target}
              onClick={() => onOpen(reference)}>打开</button>
          : <span className={`waygoal-tag ${reference.kind === "missing" ? "unknown" : ""}`}>{reference.kind === "missing" ? "打不开" : "站外"}</span>}
        <span className="waygoal-ref-label">{reference.label}</span>
        <code>{reference.target}</code>
        <span className="waygoal-ref-note">{REFERENCE_NOTE[reference.kind]}</span>
      </li>)}
    </ul>
  </div>;
}

/** Where a remote ticket came from, and how far it got. The source operation
 *  and the canvas being in sync are two facts and are shown as two: a ticket
 *  whose raw result was never read says 未同步 and shows nothing as if it were
 *  the source's own text. Nothing here is fetched further — an attachment or a
 *  link in the body is an address, shown as written. */
function Remote({ remote, onRetry }: { remote: WaygoalRemoteInfo; onRetry: () => void }) {
  return <div className="waygoal-ticket-remote" data-remote={remote.source}>
    <p>
      <span className="waygoal-ticket-label">来源</span>
      <span className="waygoal-tag">{remoteSourceLabel(remote.source)} · {remote.origin}</span>
      {remote.capturedAt
        ? <span className="waygoal-tag done" data-remote-synced>取得于 {readTime(remote.capturedAt)}</span>
        : <span className="waygoal-tag unknown" data-remote-unsynced>未同步</span>}
    </p>
    {remote.url && <p className="waygoal-ticket-source"><code>{remote.url}</code><span className="waygoal-ref-note">站外地址，原样列出，没有替你打开</span></p>}
    {remote.note && <p role="status" className="waygoal-ticket-stale" data-remote-note>{remote.note}</p>}
    {!remote.capturedAt && <p className="waygoal-ticket-check">
      <button type="button" className="waygoal-button outlined small" data-remote-retry onClick={onRetry}>重新取得</button>
      <span>来源那边报告成功是 {readTime(remote.deliveredAt)}；把结果重新写回工作目录后可以再取一次。</span>
    </p>}
    <p className="waygoal-ticket-check" data-remote-pending>
      待核对：这里是取得那一刻的原文。来源上的改动要等下一次取得才会出现，Waygoal 不承诺实时同步。附件只按地址列出，不下载，也不代你打开。
    </p>
    <RemoteComments comments={remote.comments} />
  </div>;
}

/** The comments the result actually carried. A result that never carried them
 *  says so: not fetched is not the same as there being none. */
function RemoteComments({ comments }: { comments: WaygoalRemoteInfo["comments"] }) {
  if (comments === null) return <p className="waygoal-ticket-empty" data-remote-comments="none">这次取得的结果里没有评论字段，所以这不是「没有评论」，是评论没取到。</p>;
  if (comments.length === 0) return <p className="waygoal-ticket-empty" data-remote-comments="empty">取到的评论：0 条。</p>;
  return <div className="waygoal-ticket-talks" data-remote-comments="some">
    <p className="waygoal-ticket-label">取到的评论</p>
    <ul>
      {comments.map((comment, index) => <li key={`${index}-${comment.createdAt}`} data-remote-comment={index}>
        <span className="waygoal-talk-title">{comment.author || "没有署名"}</span>
        <span className="waygoal-tag">{comment.createdAt ? readTime(comment.createdAt) : "没有时间"}</span>
        <pre className="waygoal-ticket-body">{comment.body}</pre>
      </li>)}
    </ul>
  </div>;
}

const SECTION_LABELS: Record<string, string> = {
  destination: "目标", question: "要解决的问题", answer: "已有结论",
  "decisions so far": "已有判断", "not yet specified": "待明确", notes: "补充说明",
  "out of scope": "暂不涉及", "acceptance criteria": "验收条件",
};

/** Format the source, without inventing a summary or loading remote images. */
function OverviewText({ body, references, onOpen }: { body: string; references: WaygoalReference[]; onOpen: Props["onOpenReference"] }) {
  return <div className="waygoal-ticket-prose"><ReactMarkdown components={{
    img: ({ alt }) => <span>{alt || "图片见原文"}</span>,
    a: ({ href, children }) => {
      const reference = references.find(item => item.target === href);
      if (reference && canOpen(reference)) return <button type="button" className="waygoal-inline-reference" onClick={() => onOpen(reference)}>{children}</button>;
      return href && /^https?:\/\//i.test(href) ? <a href={href} target="_blank" rel="noreferrer">{children}</a> : <span>{children}</span>;
    },
  }}>{body}</ReactMarkdown></div>;
}

function Overview({ body, references, onOpen }: { body: string; references: WaygoalReference[]; onOpen: Props["onOpenReference"] }) {
  const sections = mapSections(body);
  const lead = mapLead(body).replace(/^#\s+[^\n]+\n?/, "").replace(/^(?:\*\*)?(?:Type|Status|Blocked by):(?:\*\*)?[^\n]*(?:\n|$)/gmi, "").trim();
  return <div className="waygoal-ticket-overview">
    {lead && <section><OverviewText body={lead} references={references} onOpen={onOpen} /></section>}
    {sections.map((section, index) => {
      const name = section.heading.toLowerCase();
      const label = SECTION_LABELS[name] ?? section.heading;
      const primary = ["destination", "question", "answer", "decisions so far", "acceptance criteria"].includes(name);
      return primary ? <section key={index} data-overview-section={name} data-section={section.heading}>
        <h3>{label}</h3><OverviewText body={section.body} references={references} onOpen={onOpen} />
      </section> : <details key={index} className="waygoal-ticket-disclosure" data-section={section.heading}>
        <summary>{label}</summary><OverviewText body={section.body} references={references} onOpen={onOpen} />
      </details>;
    })}
  </div>;
}

function Discussions({ ticket, onStart, onOpenDiscussion }: { ticket: WaygoalTicketCard } & Pick<Props, "onStart" | "onOpenDiscussion">) {
  return <div className="waygoal-ticket-talks">
    <h3>讨论</h3>
    {ticket.discussions.length === 0 && <p className="waygoal-ticket-empty">还没有讨论。</p>}
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
  </div>;
}

/** The full view of one local ticket or map: what the source file says, where
 *  it came from and when it was read. It shows the file's own text rather than
 *  a retelling, and opening it starts no Pi session. */
export function WaygoalTicketPanel({ map, ticket, readAt, onStart, onOpenDiscussion, onOpenReference, onReopenCheck, onRetryRemote, onRefreshRelations }: Props) {
  const [refreshing, setRefreshing] = useState(false);
  const stale = ticket ? ticket.stale : map.stale;
  const path = ticket ? ticket.path : map.path;
  const parent = map.tickets.find(t => t.id === ticket?.parentTicketId);
  const children = ticket ? map.tickets.filter(t => t.parentTicketId === ticket.id) : map.tickets;
  const body = ticket?.body ?? map.body;
  const openReference = (item: WaygoalTicketCard) => onOpenReference({ label: item.title, target: item.id, path: item.id, kind: "ticket", external: false });
  return <div className="waygoal-ticket-panel" key={path}>
    <div className="waygoal-ticket-head">
      <p className="waygoal-ticket-meta">
        {ticket && <span className={`waygoal-tag ${stateClass(ticket.state)}`}>{ticket.status === "open" ? "进行中" : ticket.status === "closed" ? "已关闭" : ticket.status}</span>}
        {ticket && <span>#{ticket.number}</span>}
        {ticket?.type && <span>{ticket.type === "map" ? "探索地图" : ticket.type}</span>}
      </p>
      {ticket?.parentTicketId && <p className="waygoal-ticket-parent">属于 {parent ? <button type="button" onClick={() => openReference(parent)}>#{parent.number} {parent.title}</button> : <span>#{ticket.parentTicketId.split("/").at(-1)} · 未导入画布</span>}</p>}
      {stale && <p role="status" className="waygoal-ticket-stale">来源暂时读不到，当前显示 {readTime(stale.lastReadAt)} 的内容。</p>}
      {ticket?.remote && !ticket.remote.capturedAt && <p role="status" className="waygoal-ticket-stale">票据内容尚未同步，请在「来源与同步」中重新取得。</p>}
      {ticket?.remote?.relationsNote && <p role="status" className="waygoal-ticket-stale">关系读取未完成，详情见「来源与同步」。</p>}
    </div>
    <Overview body={body} references={ticket?.references ?? map.references} onOpen={onOpenReference} />
    {children.length > 0 && <section className="waygoal-ticket-children">
      <h3>子票据 <span>{children.length}</span></h3>
      {children.map(child => <button type="button" key={child.id} onClick={() => openReference(child)}>
        <span className={`waygoal-ticket-status-dot ${stateClass(child.state)}`} aria-hidden="true" />
        <span className="waygoal-ticket-child-copy"><strong>{child.title}</strong><small>#{child.number} · {child.status === "open" ? "进行中" : child.status === "closed" ? "已关闭" : child.status}{child.blocked ? ` · 等待 ${child.blockers.filter(b => b.holding).map(b => `#${b.number}`).join("、")}` : ""}</small></span>
        <span aria-hidden="true">→</span>
      </button>)}
    </section>}
    {ticket && <Blockers ticket={ticket} />}
    {ticket && <Discussions ticket={ticket} onStart={onStart} onOpenDiscussion={onOpenDiscussion} />}
    {(ticket?.references ?? map.references).length > 0 && <details className="waygoal-ticket-disclosure waygoal-ticket-support">
      <summary>相关资料 <span>{(ticket?.references ?? map.references).length}</span></summary>
      <References references={ticket ? ticket.references : map.references} onOpen={onOpenReference} />
    </details>}
    <details className="waygoal-ticket-disclosure waygoal-ticket-support" data-ticket-source>
      <summary>来源与同步</summary>
      {ticket?.remote && <Remote remote={ticket.remote} onRetry={() => onRetryRemote(ticket)} />}
      {ticket?.remote?.source === "github" && <div className="waygoal-ticket-relations-refresh">
        <button type="button" disabled={refreshing} onClick={async () => { setRefreshing(true); try { await onRefreshRelations(ticket); } finally { setRefreshing(false); } }}>{refreshing ? "正在读取关系…" : "刷新父子与依赖关系"}</button>
        <small>{ticket.remote.relationsNote || (ticket.remote.relationsReadAt ? `关系读取于 ${readTime(ticket.remote.relationsReadAt)}` : "关系尚未读取")}</small>
      </div>}
      <p className="waygoal-ticket-source"><code>{path}</code><span>读取于 {readTime(stale ? stale.lastReadAt : readAt)}</span></p>
      {!ticket && map.unreadable.length > 0 && <p role="status" className="waygoal-ticket-stale">读不到：{map.unreadable.map(u => u.path).join("、")}</p>}
      {!ticket && map.warnings.map(warning => <p key={warning} role="status" className="waygoal-ticket-stale">{warning}</p>)}
      {!ticket && map.check?.dismissed && <button type="button" className="waygoal-button outlined small" data-map-check-reopen={map.path} onClick={onReopenCheck}>重新显示检查提示</button>}
    </details>
    <details className="waygoal-ticket-disclosure waygoal-ticket-support" data-ticket-original>
      <summary>查看原文</summary><pre className="waygoal-ticket-body">{body}</pre>
    </details>
  </div>;
}
