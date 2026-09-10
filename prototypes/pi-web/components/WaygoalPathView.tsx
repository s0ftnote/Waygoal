"use client";
import { useEffect, useMemo, useState } from "react";
import type { AgentMessage, SessionContext, ToolResultMessage } from "@/lib/types";
import { MessageView } from "./MessageView";

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
  /** Null when there is no position to continue from — an unrecorded origin. */
  onContinue: (() => void) | null;
  onFork: (entryId: string) => void;
}

/** Read-only history of one path. It calls the existing history reader with an
 *  explicit leaf and nothing else — no navigation, so looking here cannot move
 *  the agent's active path or add a message. Continuing is a separate,
 *  explicit action the user takes from the banner. */
export function WaygoalPathView({ sessionId, leafId, cwd, label, busyReason, forkingEntryId, onContinue, onFork }: Props) {
  const [context, setContext] = useState<SessionContext | null>(null);
  const [error, setError] = useState("");

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
      <span className="waygoal-tag reading">正在查看</span>
      <span className="waygoal-readonly-label">{label}</span>
      <span className="waygoal-readonly-hint">只读回看，这里不会发送消息</span>
      {onContinue && <button type="button" className="waygoal-button action small" onClick={onContinue} disabled={Boolean(busyReason)}
        title={busyReason ?? "把这段设为继续位置，下一次发送进入这条路径"}>从这里继续</button>}
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
  </div>;
}
