"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentMessage, SessionContext, ToolResultMessage } from "@/lib/types";
import { MessageView } from "../MessageView";

interface Props {
  sessionId: string;
  /** The deepest entry of the path being read; null when only the session is
    *  known, in which case its own latest path is read. */
  leafId: string | null;
  cwd: string;
  /** What this path is, e.g. 来源讨论 or 另一条路径. */
  label: string;
  /** Continuing or forking is refused while Pi is working on this session. */
  busyReason: string | null;
  forkingEntryId: string | null;
  /** Say something here: this path becomes the one the session is being
    *  continued in, and the message goes into it. Null when this is not a path
    *  to talk in — an origin whose message was never recorded. */
  onSend: ((text: string) => void) | null;
  onFork: (entryId: string) => void;
}

/** Read-only history of one path. It calls the existing history reader with an
 *  explicit leaf and nothing else — no navigation, so looking here cannot move
 *  the agent's active path or add a message. Sending is what commits: the act
 *  of sending is the explicit choice, so there is no separate confirm step. */
export function WaygoalPathView({ sessionId, leafId, cwd, label, busyReason, forkingEntryId, onSend, onFork }: Props) {
  const [context, setContext] = useState<SessionContext | null>(null);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const composer = useRef<HTMLTextAreaElement>(null);

  const send = () => {
    const text = draft.trim();
    if (!text || !onSend || busyReason) return;
    setDraft("");
    onSend(text);
  };

  // Opening a path is meant to be one click away from talking, so the composer
  // takes focus. preventScroll: the history above must stay where it was left.
  useEffect(() => { composer.current?.focus({ preventScroll: true }); }, [leafId]);

  useEffect(() => {
    const controller = new AbortController();
    setContext(null); setError("");
    const leaf = leafId ? `leafId=${encodeURIComponent(leafId)}&` : "";
    fetch(`/api/sessions/${encodeURIComponent(sessionId)}/context?${leaf}tail=200`, { signal: controller.signal, cache: "no-store" })
      .then(async res => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `读取失败（${res.status}）`);
        setContext(body.context as SessionContext);
      })
      .catch(e => { if (e.name !== "AbortError") setError(e instanceof Error ? e.message : String(e)); });
    return () => controller.abort();
  }, [sessionId, leafId]);

  const toolResults = useMemo(() => {
    const map = new Map<string, ToolResultMessage>();
    for (const message of context?.messages ?? []) {
      if (message.role === "toolResult") map.set((message as ToolResultMessage).toolCallId, message as ToolResultMessage);
    }
    return map;
  }, [context]);

  return <div className="waygoal-readonly">
    <div className="waygoal-readonly-bar">
      <span className="waygoal-tag reading">正在看</span>
      <span className="waygoal-readonly-label">{label}</span>
      <span className="waygoal-readonly-hint">{onSend ? "不发一句就什么都不动" : "来源那边的历史，这里只看不发"}</span>
    </div>
    {busyReason && <p className="waygoal-readonly-note">{busyReason}</p>}
    <div className="waygoal-readonly-body">
      {error && <p role="alert" className="waygoal-readonly-note error">{error}</p>}
      {!context && !error && <p className="waygoal-readonly-note">正在读取这条路径…</p>}
      {context?.messages.length === 0 && <p className="waygoal-readonly-note">这条路径上还没有消息。</p>}
      {context?.messages.map((message: AgentMessage, index: number) => <MessageView
        key={context.entryIds[index] ?? index}
        message={message}
        toolResults={toolResults}
        cwd={cwd}
        entryId={context.entryIds[index]}
        sessionId={sessionId}
        onFork={busyReason || (index === 0 && message.role === "user") ? undefined : onFork}
        forking={forkingEntryId === context.entryIds[index]}
        forkLabel="从这里分叉"
      />)}
    </div>
    {onSend && <div className="waygoal-readonly-composer">
      <textarea ref={composer} value={draft} onChange={e => setDraft(e.target.value)} rows={2}
        placeholder={busyReason ?? "在这条里接着说…"}
        disabled={Boolean(busyReason)} aria-label="在这条路径里接着说"
        onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} />
      <button type="button" className="waygoal-button action small" onClick={send} disabled={Boolean(busyReason) || !draft.trim()}
        title={busyReason ?? "发送；之后这段会话就在这条路径里继续"}>发送</button>
    </div>}
  </div>;
}
