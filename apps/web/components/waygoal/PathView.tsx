"use client";
import { useEffect, useMemo, useState } from "react";
import type { AgentMessage, SessionContext, ToolResultMessage, UserMessage } from "@/lib/types";
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
  onFork: (entryId: string, message?: UserMessage) => void;
}

/** Read-only, paginated history inside the canvas; never mounts a composer. */
export function WaygoalPathView({ sessionId, leafId, cwd, label, busyReason, forkingEntryId, onFork }: Props) {
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
      <span className="waygoal-tag reading">正在看</span>
      <span className="waygoal-readonly-label">{label}</span>
      <span className="waygoal-readonly-hint">只读预览 · 当前聊天保持不变</span>
    </div>
    {busyReason && <p className="waygoal-readonly-note">{busyReason}</p>}
    <div className="waygoal-readonly-body">
      {error && <p role="alert" className="waygoal-readonly-note error">{error}</p>}
      {!context && !error && <p className="waygoal-readonly-note">正在读取这条路径…</p>}
      {context?.hasMore && <button type="button" className="waygoal-button outlined small" onClick={async () => {
        try {
          const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/context?before=${encodeURIComponent(context.oldestEntryId!)}&tail=200`);
          const body = await response.json();
          if (!response.ok) throw new Error(body.error);
          const older = body.context as SessionContext;
          setContext(current => current ? { ...current, messages: [...older.messages, ...current.messages], entryIds: [...older.entryIds, ...current.entryIds], oldestEntryId: older.oldestEntryId, hasMore: older.hasMore } : current);
        } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
      }}>加载更早历史</button>}
      {context?.messages.length === 0 && <p className="waygoal-readonly-note">这条路径上还没有消息。</p>}
      {context?.messages.map((message: AgentMessage, index: number) => <MessageView
        key={context.entryIds[index] ?? index}
        message={message}
        toolResults={toolResults}
        cwd={cwd}
        entryId={context.entryIds[index]}
        sessionId={sessionId}
        onFork={busyReason ? undefined : entryId => onFork(entryId, message.role === "user" ? message : undefined)}
        forking={forkingEntryId === context.entryIds[index]}
        forkLabel="从这里分叉"
      />)}
    </div>
  </div>;
}
