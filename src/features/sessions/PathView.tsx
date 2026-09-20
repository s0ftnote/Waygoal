"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AgentMessage, SessionContext, ToolResultMessage, UserMessage } from "@/shared/types";
import { MessageView } from "../chat/MessageView";

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

/** Read-only, paginated history in the discussion panel; never mounts a composer. */
export function WaygoalPathView({ sessionId, leafId, cwd, label, busyReason, forkingEntryId, onFork }: Props) {
  const [context, setContext] = useState<SessionContext | null>(null);
  const [error, setError] = useState("");
  const historyBody = useRef<HTMLDivElement>(null);
  const locateLoadedPath = useRef(false);
  useLayoutEffect(() => {
    if (!locateLoadedPath.current || !historyBody.current) return;
    historyBody.current.scrollTop = historyBody.current.scrollHeight;
    locateLoadedPath.current = false;
  }, [context]);
  useEffect(() => {
    const controller = new AbortController();
    setContext(null); setError("");
    const leaf = leafId ? `leafId=${encodeURIComponent(leafId)}&` : "";
    fetch(`/api/sessions/${encodeURIComponent(sessionId)}/context?${leaf}tail=200`, { signal: controller.signal, cache: "no-store" })
      .then(async res => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `读取失败（${res.status}）`);
        if (controller.signal.aborted) return;
        locateLoadedPath.current = true;
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
      <span className="waygoal-readonly-label" title={label}>{label}</span>
      <span className="waygoal-readonly-hint">仅查看历史 · 原聊天与草稿已保留</span>
    </div>
    {busyReason && <p className="waygoal-readonly-note">{busyReason}</p>}
    <div className="waygoal-readonly-body" ref={historyBody}>
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
