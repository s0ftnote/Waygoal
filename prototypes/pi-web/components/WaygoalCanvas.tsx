"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import type { SessionInfo } from "@/lib/types";
import { NODE_HEIGHT, NODE_WIDTH, type WaygoalCanvasPatch, type WaygoalNode, type WaygoalPoint, type WaygoalSnapshot, type WaygoalView } from "@/lib/waygoal-types";
import { ChatWindow } from "./ChatWindow";

const NODE_W = NODE_WIDTH;
const NODE_H = NODE_HEIGHT;
const DEFAULT_VIEW: WaygoalView = { x: 48, y: 48, scale: 1 };
const MIN_SCALE = 0.35;
const MAX_SCALE = 1.8;

function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next = { ...record };
  delete next[key];
  return next;
}

type Drag = { id?: string; start: WaygoalPoint; origin: WaygoalPoint; moved: boolean; pointerId: number };

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff)) return "";
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} 天前`;
  return new Date(iso).toLocaleDateString("zh-CN");
}

function nodeToSession(node: WaygoalNode, cwd: string): SessionInfo {
  return {
    id: node.id,
    path: "",
    cwd,
    name: node.titleSource === "name" ? node.title : undefined,
    created: node.created,
    modified: node.modified,
    messageCount: node.messageCount,
    firstMessage: node.title,
    transient: node.transient,
  };
}

export function WaygoalCanvas() {
  const isMobile = useIsMobile();
  const [cwd] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("cwd") ?? "";
  });
  const [snapshot, setSnapshot] = useState<WaygoalSnapshot | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [view, setView] = useState<WaygoalView>(DEFAULT_VIEW);
  const [dragging, setDragging] = useState<Record<string, WaygoalPoint>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftKey, setDraftKey] = useState<string | null>(null);
  const [createdSession, setCreatedSession] = useState<SessionInfo | null>(null);
  const [panelKey, setPanelKey] = useState(0);
  const [trust, setTrust] = useState<{ requiresTrust: boolean; trusted: boolean } | null>(null);
  const restoredFor = useRef<string | null>(null);
  // Set only by user interaction (wheel, drag, buttons, keys). Restoring the
  // saved view or revealing a node never writes the record back.
  const viewDirty = useRef(false);
  const viewSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drag = useRef<Drag | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  const patch = useCallback(async (body: WaygoalCanvasPatch) => {
    if (!snapshot?.cwd) return;
    try {
      const res = await fetch("/api/waygoal", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd: snapshot.cwd, ...body }) });
      if (!res.ok) throw new Error((await res.json()).error);
    } catch (e) { setError(`画布记录没有保存：${e instanceof Error ? e.message : String(e)}`); }
  }, [snapshot?.cwd]);

  const refresh = useCallback(async (force = false) => {
    try {
      const params = new URLSearchParams();
      if (cwd) params.set("cwd", cwd);
      if (force) params.set("force", "1");
      const res = await fetch(`/api/waygoal${params.size ? `?${params}` : ""}`, { cache: "no-store" });
      const next = await res.json();
      if (!res.ok) throw new Error(next.error);
      setSnapshot(next as WaygoalSnapshot);
      setError("");
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [cwd]);

  useEffect(() => {
    void refresh(true);
    const timer = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 2500);
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [refresh]);

  // Keep the URL on the real workspace so a reload lands in the same place.
  useEffect(() => {
    if (!snapshot) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("cwd") !== snapshot.cwd) {
      url.searchParams.set("cwd", snapshot.cwd);
      window.history.replaceState(null, "", url);
    }
  }, [snapshot]);

  useEffect(() => {
    if (!snapshot?.cwd) return;
    const controller = new AbortController();
    fetch(`/api/project-trust?cwd=${encodeURIComponent(snapshot.cwd)}`, { signal: controller.signal })
      .then(r => r.ok ? r.json() : null).then(data => { if (data) setTrust(data); }).catch(() => {});
    return () => controller.abort();
  }, [snapshot?.cwd]);

  // Restore view and the last viewed node once per workspace. Reading only:
  // opening the panel loads history and never sends a message.
  useEffect(() => {
    if (!snapshot || restoredFor.current === snapshot.cwd) return;
    restoredFor.current = snapshot.cwd;
    viewDirty.current = false;
    setView(snapshot.view ?? DEFAULT_VIEW);
    setDraftKey(null); setCreatedSession(null);
    if (snapshot.lastViewed && !snapshot.lastViewedMissing) {
      setSelectedId(snapshot.lastViewed);
      setPanelKey(k => k + 1);
    } else {
      setSelectedId(null);
      if (snapshot.lastViewedMissing) setNotice("上次查看的会话已不在这个工作目录里，没有自动绑定到其他会话。");
    }
  }, [snapshot]);

  useEffect(() => {
    if (!viewDirty.current || !snapshot?.cwd) return;
    if (viewSaveTimer.current) clearTimeout(viewSaveTimer.current);
    viewSaveTimer.current = setTimeout(() => { void patch({ view }); }, 500);
    return () => { if (viewSaveTimer.current) clearTimeout(viewSaveTimer.current); };
  }, [view, patch, snapshot?.cwd]);

  const revealedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedId || revealedFor.current === selectedId) return;
    const el = viewportRef.current;
    const node = snapshot?.nodes.find(n => n.id === selectedId);
    if (!el || !node) return;
    revealedFor.current = selectedId;
    setView(v => {
      const left = node.position.x * v.scale + v.x, top = node.position.y * v.scale + v.y;
      const right = left + NODE_W * v.scale, bottom = top + NODE_H * v.scale;
      const margin = 24;
      if (left >= margin && top >= margin && right <= el.clientWidth - margin && bottom <= el.clientHeight - margin) return v;
      return { ...v, x: (el.clientWidth - NODE_W * v.scale) / 2 - node.position.x * v.scale, y: (el.clientHeight - NODE_H * v.scale) / 2 - node.position.y * v.scale };
    });
  }, [selectedId, snapshot]);

  const nodes = useMemo(() => (snapshot?.nodes ?? []).map(node => ({ ...node, position: dragging[node.id] ?? node.position })), [snapshot, dragging]);
  const selectedNode = nodes.find(n => n.id === selectedId) ?? null;
  const panelSession: SessionInfo | null = selectedNode ? nodeToSession(selectedNode, snapshot!.cwd) : createdSession;
  const panelOpen = Boolean(panelSession || draftKey);

  const openNode = useCallback((node: WaygoalNode) => {
    setDraftKey(null); setCreatedSession(null);
    setSelectedId(node.id);
    setPanelKey(k => k + 1);
    setNotice("");
    void patch({ lastViewed: node.id });
  }, [patch]);

  const startNewChat = useCallback(() => {
    if (!snapshot) return;
    setSelectedId(null); setCreatedSession(null);
    setDraftKey(`waygoal-new:${crypto.randomUUID()}:${snapshot.cwd}`);
    setPanelKey(k => k + 1);
    setNotice("");
  }, [snapshot]);

  const closePanel = useCallback(() => {
    setSelectedId(null); setDraftKey(null); setCreatedSession(null);
    viewportRef.current?.focus();
  }, []);

  const onSessionCreated = useCallback((session: SessionInfo) => {
    setCreatedSession(session);
    setSelectedId(session.id);
    void patch({ lastViewed: session.id });
    void refresh(true);
  }, [patch, refresh]);

  const zoomBy = useCallback((factor: number, center?: WaygoalPoint) => {
    viewDirty.current = true;
    setView(v => {
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor));
      if (!center) return { ...v, scale };
      const ratio = scale / v.scale;
      return { x: center.x - (center.x - v.x) * ratio, y: center.y - (center.y - v.y) * ratio, scale };
    });
  }, []);

  const fitAll = useCallback(() => {
    viewDirty.current = true;
    const el = viewportRef.current;
    if (!el || nodes.length === 0) { setView(DEFAULT_VIEW); return; }
    const xs = nodes.map(n => n.position.x), ys = nodes.map(n => n.position.y);
    const minX = Math.min(...xs), minY = Math.min(...ys);
    const width = Math.max(...xs) + NODE_W - minX, height = Math.max(...ys) + NODE_H - minY;
    const scale = Math.min(1, Math.max(MIN_SCALE, Math.min((el.clientWidth - 96) / width, (el.clientHeight - 96) / height)));
    setView({ x: (el.clientWidth - width * scale) / 2 - minX * scale, y: (el.clientHeight - height * scale) / 2 - minY * scale, scale });
  }, [nodes]);

  const nudge = useCallback((node: WaygoalNode, dx: number, dy: number) => {
    const position = { x: node.position.x + dx, y: node.position.y + dy };
    setDragging(d => ({ ...d, [node.id]: position }));
    void patch({ positions: { [node.id]: position } }).then(() => refresh()).then(() => setDragging(d => without(d, node.id)));
  }, [patch, refresh]);

  const onViewportPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("[data-node]")) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { start: { x: e.clientX, y: e.clientY }, origin: { x: view.x, y: view.y }, moved: false, pointerId: e.pointerId };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const dx = e.clientX - d.start.x, dy = e.clientY - d.start.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
    if (d.id) setDragging(p => ({ ...p, [d.id!]: { x: d.origin.x + dx / view.scale, y: d.origin.y + dy / view.scale } }));
    else { viewDirty.current = true; setView(v => ({ ...v, x: d.origin.x + dx, y: d.origin.y + dy })); }
  };
  const onPointerUp = (e: React.PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    if (d.id && d.moved) {
      const id = d.id;
      const position = dragging[id];
      if (position) void patch({ positions: { [id]: { x: Math.round(position.x), y: Math.round(position.y) } } }).then(() => refresh()).then(() => setDragging(p => without(p, id)));
    } else if (d.id) {
      setDragging(p => without(p, d.id!));
    }
    // Let the click that follows a drag see `moved` before clearing.
    setTimeout(() => { drag.current = null; }, 0);
  };

  const onViewportKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const step = e.shiftKey ? 160 : 40;
    const moves: Record<string, WaygoalPoint> = { ArrowLeft: { x: step, y: 0 }, ArrowRight: { x: -step, y: 0 }, ArrowUp: { x: 0, y: step }, ArrowDown: { x: 0, y: -step } };
    if (moves[e.key]) { e.preventDefault(); viewDirty.current = true; setView(v => ({ ...v, x: v.x + moves[e.key].x, y: v.y + moves[e.key].y })); }
    else if (e.key === "+" || e.key === "=") { e.preventDefault(); zoomBy(1.15); }
    else if (e.key === "-") { e.preventDefault(); zoomBy(1 / 1.15); }
    else if (e.key === "0") { e.preventDefault(); fitAll(); }
    else if (e.key === "Escape" && panelOpen) { e.preventDefault(); closePanel(); }
  };

  const cwdName = snapshot?.cwd.split("/").filter(Boolean).at(-1) ?? "";
  const runningCount = nodes.filter(n => n.running).length;

  return <main className="waygoal-app" data-panel-open={panelOpen || undefined}>
    <header className="waygoal-top">
      <div className="waygoal-brand">waygoal<span>.</span></div>
      <div className="waygoal-workspace" title={snapshot?.cwd}>
        <span>工作目录</span>
        <code>{snapshot?.cwd ?? "…"}</code>
      </div>
      <div className="waygoal-top-right">
        <button type="button" className="waygoal-button action" onClick={startNewChat} disabled={!snapshot}>新开聊天</button>
      </div>
    </header>
    {error && <div role="alert" className="waygoal-alert">{error}</div>}
    {notice && <div role="status" className="waygoal-notice">{notice}<button type="button" aria-label="关闭提示" onClick={() => setNotice("")}>×</button></div>}
    {trust?.requiresTrust && !trust.trusted && snapshot && <div role="status" className="waygoal-notice">这个目录带有项目级 skills 或扩展；Pi 需要你确认信任后才会加载它们。
      <button type="button" className="waygoal-button outlined small" onClick={() => void fetch("/api/project-trust", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd: snapshot.cwd }) }).then(r => r.json()).then(setTrust)}>信任此目录</button></div>}
    <div className="waygoal-stage">
      <section className="waygoal-canvas-area" aria-label="会话画布区域">
        <div className="waygoal-toolbar">
          <h1>{cwdName || "会话画布"}</h1>
          <span className="waygoal-count">{snapshot ? `${nodes.length} 段会话${runningCount ? ` · ${runningCount} 段正在运行` : ""}` : "正在读取…"}</span>
          <div className="waygoal-zoom" role="group" aria-label="缩放">
            <button type="button" aria-label="缩小" onClick={() => zoomBy(1 / 1.15)}>−</button>
            <span aria-live="polite">{Math.round(view.scale * 100)}%</span>
            <button type="button" aria-label="放大" onClick={() => zoomBy(1.15)}>+</button>
            <button type="button" onClick={fitAll}>回到全景</button>
          </div>
        </div>
        <div ref={viewportRef} className="waygoal-viewport" tabIndex={0} aria-label="会话画布：方向键平移，+ − 缩放，0 回到全景" role="region"
          onWheel={e => zoomBy(e.deltaY > 0 ? 0.92 : 1.08, { x: e.clientX - e.currentTarget.getBoundingClientRect().left, y: e.clientY - e.currentTarget.getBoundingClientRect().top })}
          onPointerDown={onViewportPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onKeyDown={onViewportKeyDown}>
          <div className={`waygoal-world${drag.current ? " dragging" : ""}`} style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}>
            {nodes.map(node => <button key={node.id} type="button" data-node={node.id} className={`waygoal-node${node.id === selectedId ? " selected" : ""}${node.running ? " running" : ""}`}
              style={{ left: node.position.x, top: node.position.y }}
              aria-pressed={node.id === selectedId}
              aria-label={`${node.title}${node.running ? "，正在运行" : ""}`}
              onPointerDown={e => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); drag.current = { id: node.id, start: { x: e.clientX, y: e.clientY }, origin: node.position, moved: false, pointerId: e.pointerId }; }}
              onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
              onClick={() => { if (!drag.current?.moved) openNode(node); }}
              onKeyDown={e => {
                const step = e.shiftKey ? 50 : 10;
                const moves: Record<string, WaygoalPoint> = { ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 }, ArrowUp: { x: 0, y: -step }, ArrowDown: { x: 0, y: step } };
                if (moves[e.key]) { e.preventDefault(); e.stopPropagation(); nudge(node, moves[e.key].x, moves[e.key].y); }
                else if (e.key === "Escape" && panelOpen) { e.preventDefault(); closePanel(); }
              }}>
              <span className="waygoal-node-meta"><span>{node.titleSource === "name" ? "会话" : node.titleSource === "fallback" ? "未命名 · 首条消息" : "未命名"}</span><span className="waygoal-node-state">{node.running ? <><i aria-hidden="true" /> 正在运行</> : relativeTime(node.modified)}</span></span>
              <strong>{node.title}</strong>
              <span className="waygoal-node-foot"><span>{node.messageCount ? `${node.messageCount} 条消息` : "还没有消息"}</span><span aria-hidden="true">{node.id === selectedId ? "正在查看" : "打开 →"}</span></span>
            </button>)}
            {snapshot && nodes.length === 0 && <div className="waygoal-empty" style={{ left: 0, top: 0 }}>
              <strong>这个目录还没有 Pi 会话。</strong>
              <p>点「新开聊天」开始一段讨论；已有的 Pi 会话会按真实身份出现在这里。不需要 Git 仓库、票据或特定 skill。</p>
            </div>}
          </div>
        </div>
        <div className="waygoal-statusline"><span>拖动卡片摆放 · 拖动空白处平移 · 滚轮缩放 · 位置与最近查看保存在 Pi 数据目录</span><span className="waygoal-id">{snapshot?.workspaceId}</span></div>
      </section>
      {panelOpen && snapshot && <aside className="waygoal-panel" aria-label="讨论面板">
        <div className="waygoal-panel-head">
          {isMobile && <button type="button" className="waygoal-button outlined small" onClick={closePanel}>← 回到画布</button>}
          <div className="waygoal-panel-title">
            <span className="waygoal-eyebrow">{panelSession ? (selectedNode?.running ? "正在运行" : "已有会话") : "新的会话"}</span>
            <strong>{panelSession ? (selectedNode?.title ?? createdSession?.firstMessage ?? "会话") : "先写下第一句，发送后这段会话才会出现在画布上"}</strong>
          </div>
          {!isMobile && <button type="button" className="waygoal-icon" aria-label="关闭面板" onClick={closePanel}>×</button>}
        </div>
        <div className="waygoal-panel-body">
          <ChatWindow key={panelKey} session={panelSession} sessionRunning={selectedNode?.running ?? false}
            newSessionCwd={panelSession ? null : snapshot.cwd} newSessionDraftKey={panelSession ? null : draftKey}
            onSessionCreated={onSessionCreated} onAgentEnd={() => void refresh(true)} soundEnabled={false}
            onOpenSession={id => { const node = snapshot.nodes.find(n => n.id === id); if (node) openNode(node); }} />
        </div>
      </aside>}
    </div>
  </main>;
}
