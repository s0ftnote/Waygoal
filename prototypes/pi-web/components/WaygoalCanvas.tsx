"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import type { SessionInfo } from "@/lib/types";
import type { WaygoalBranchChoice, WaygoalBranchPoint, WaygoalSessionTreeResponse } from "@/lib/waygoal-branches";
import { NODE_HEIGHT, NODE_WIDTH, type WaygoalCanvasPatch, type WaygoalNode, type WaygoalPoint, type WaygoalSnapshot, type WaygoalView } from "@/lib/waygoal-types";
import { ChatWindow } from "./ChatWindow";
import { WaygoalPaths } from "./WaygoalPaths";
import { WaygoalPathView } from "./WaygoalPathView";

const NODE_W = NODE_WIDTH;
const NODE_H = NODE_HEIGHT;
const DEFAULT_VIEW: WaygoalView = { x: 48, y: 48, scale: 1 };
const MIN_SCALE = 0.35;
const MAX_SCALE = 1.8;
const CHIP_HEIGHT = 30;
const CHIP_GAP = 16;

function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next = { ...record };
  delete next[key];
  return next;
}

type Drag = { id?: string; start: WaygoalPoint; origin: WaygoalPoint; moved: boolean; pointerId: number };
/** A read-only reading position. `entryId` is the entry being displayed and is
 *  null when the position is only known as a session — a fork whose origin
 *  message was never recorded. `leafId` is the separate id continuing here would
 *  navigate to: Pi moves the leaf to a user entry's PARENT and puts its text in
 *  the editor, so the displayed entry is not what you continue from. Null means
 *  there is nothing here to continue from. */
type Viewing = { sessionId: string; entryId: string | null; leafId: string | null; label: string };

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

/** One CJK character of the link label at its 10px canvas size. */
const LINK_LABEL_CHAR_W = 10;

/** Where a link between two cards should touch each card's border, so the
 *  line and its label stay in the gap instead of running under a card. */
function borderAnchor(from: WaygoalPoint, to: WaygoalPoint): { x: number; y: number } {
  const cx = from.x + NODE_W / 2, cy = from.y + NODE_H / 2;
  const dx = to.x - from.x, dy = to.y - from.y;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const t = Math.min(
    Math.abs(dx) > 0.001 ? (NODE_W / 2) / Math.abs(dx) : Infinity,
    Math.abs(dy) > 0.001 ? (NODE_H / 2) / Math.abs(dy) : Infinity,
  );
  return { x: cx + dx * t, y: cy + dy * t };
}

/** Every branch choice of a session, flattened for the canvas chips. The order
 *  is kept per branch point so a path is called the same thing on the canvas
 *  and in the panel. */
function flattenChoices(branchPoints: WaygoalBranchPoint[]): { choice: WaygoalBranchChoice; order: number }[] {
  return branchPoints.flatMap(point => point.choices.map((choice, order) => ({ choice, order })));
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
  const [tree, setTree] = useState<WaygoalSessionTreeResponse | null>(null);
  const [viewing, setViewing] = useState<Viewing | null>(null);
  const [forkingEntryId, setForkingEntryId] = useState<string | null>(null);
  const restoredFor = useRef<string | null>(null);
  // Set only by user interaction (wheel, drag, buttons, keys). Restoring the
  // saved view or revealing a node never writes the record back.
  const viewDirty = useRef(false);
  const viewSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drag = useRef<Drag | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  // The session ChatWindow is showing, so a fork it reports can be attributed.
  const chatSessionId = useRef<string | null>(null);
  const pendingRestoreEntry = useRef<string | null>(null);

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

  // Restore view, the last viewed session and the position inside it, once per
  // workspace. Reading only: opening a panel loads history and never sends.
  useEffect(() => {
    if (!snapshot || restoredFor.current === snapshot.cwd) return;
    restoredFor.current = snapshot.cwd;
    viewDirty.current = false;
    setView(snapshot.view ?? DEFAULT_VIEW);
    setDraftKey(null); setCreatedSession(null); setViewing(null); setTree(null);
    if (snapshot.lastViewed && !snapshot.lastViewedMissing) {
      setSelectedId(snapshot.lastViewed);
      pendingRestoreEntry.current = snapshot.lastViewedEntry;
      setPanelKey(k => k + 1);
    } else {
      setSelectedId(null);
      pendingRestoreEntry.current = null;
      if (snapshot.lastViewedMissing) setNotice("上次查看的会话已不在这个工作目录里，没有自动绑定到其他会话。");
    }
  }, [snapshot]);

  useEffect(() => {
    if (!viewDirty.current || !snapshot?.cwd) return;
    if (viewSaveTimer.current) clearTimeout(viewSaveTimer.current);
    viewSaveTimer.current = setTimeout(() => { void patch({ view }); }, 500);
    return () => { if (viewSaveTimer.current) clearTimeout(viewSaveTimer.current); };
  }, [view, patch, snapshot?.cwd]);

  // The real branch structure of the open session, read straight from its Pi
  // tree. Polled so a message sent in the panel moves the continue marker.
  const loadTree = useCallback(async (sessionId: string) => {
    try {
      const res = await fetch(`/api/waygoal/session/${encodeURIComponent(sessionId)}`, { cache: "no-store" });
      if (!res.ok) { setTree(null); return; }
      setTree(await res.json() as WaygoalSessionTreeResponse);
    } catch { setTree(null); }
  }, []);

  const openSessionId = selectedId ?? createdSession?.id ?? null;
  useEffect(() => {
    if (!openSessionId) { setTree(null); return; }
    setTree(t => t?.sessionId === openSessionId ? t : null);
    void loadTree(openSessionId);
    const timer = setInterval(() => { if (document.visibilityState === "visible") void loadTree(openSessionId); }, 2500);
    return () => clearInterval(timer);
  }, [openSessionId, loadTree]);

  // A restored reading position must still exist in this session's real tree.
  // A position that is gone stays gone — a similar title is not the same history.
  useEffect(() => {
    const entryId = pendingRestoreEntry.current;
    if (!entryId || !openSessionId) return;
    pendingRestoreEntry.current = null;
    const sessionId = openSessionId;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/waygoal/session/${encodeURIComponent(sessionId)}?entry=${encodeURIComponent(entryId)}`, { cache: "no-store" });
        const body = await res.json() as WaygoalSessionTreeResponse & { entryFound?: boolean };
        if (cancelled) return;
        if (res.ok && body.entryFound) {
          const choice = flattenChoices(body.branchPoints ?? []).find(c => c.choice.entryId === entryId)?.choice;
          setViewing({ sessionId, entryId, leafId: choice?.leafId ?? null, label: "上次查看的位置" });
        }
        else {
          setNotice("上次查看的位置在这段会话里已经找不到了，画布没有按标题绑定到别的历史，面板停在当前继续位置。");
          void patch({ lastViewedEntry: null });
        }
      } catch { /* the panel still opens at the continue position */ }
    })();
    return () => { cancelled = true; };
  }, [openSessionId, patch]);

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
  const nodeById = useMemo(() => new Map(nodes.map(node => [node.id, node])), [nodes]);
  const selectedNode = nodes.find(n => n.id === selectedId) ?? null;
  const panelSession: SessionInfo | null = selectedNode ? nodeToSession(selectedNode, snapshot!.cwd) : createdSession;
  const panelOpen = Boolean(panelSession || draftKey);

  // Kept in a ref, not read from the closure: ChatWindow reports a fork
  // asynchronously, and the panel may already show something else by then.
  useEffect(() => { chatSessionId.current = panelSession?.id ?? null; }, [panelSession]);

  // Real fork relations between nodes of this workspace, as drawn edges.
  const originEdges = useMemo(() => nodes.flatMap(node => {
    const from = node.origin?.inWorkspace ? nodeById.get(node.origin.sessionId) : undefined;
    if (!from || from.id === node.id) return [];
    return [{ id: node.id, from: from.position, to: node.position, exact: Boolean(node.origin?.entryId) }];
  }), [nodes, nodeById]);

  // The card grows when it carries origin or branch marks, so the chip stack
  // is placed under its measured height rather than the nominal one.
  const selectedElRef = useRef<HTMLButtonElement | null>(null);
  const [chipTop, setChipTop] = useState(NODE_H + CHIP_GAP);
  useEffect(() => {
    const el = selectedElRef.current;
    if (!el) { setChipTop(NODE_H + CHIP_GAP); return; }
    const update = () => setChipTop(el.offsetHeight + CHIP_GAP);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [selectedId, snapshot]);

  const selectedChoices = useMemo(
    () => (tree && tree.sessionId === selectedId ? flattenChoices(tree.branchPoints) : []),
    [tree, selectedId],
  );

  const busyReason = nodes.find(n => n.id === openSessionId)?.running
    ? "这段会话正在运行。分叉和切换继续位置要等它结束，Waygoal 不打断正在进行的任务；查看不受影响。"
    : null;

  const openNode = useCallback((node: WaygoalNode) => {
    setDraftKey(null); setCreatedSession(null); setViewing(null);
    setSelectedId(node.id);
    setPanelKey(k => k + 1);
    setNotice("");
    void patch({ lastViewed: node.id, lastViewedEntry: null });
  }, [patch]);

  /** Open a read-only reading position. Display only — no navigation.
   *  `leafId` is where 「从这里继续」 would move the active path, null when this
   *  position is not something to continue from. */
  const viewPath = useCallback((sessionId: string, entryId: string | null, label: string, leafId: string | null) => {
    setNotice("");
    if (sessionId !== selectedId) {
      setDraftKey(null); setCreatedSession(null);
      setSelectedId(sessionId);
      setPanelKey(k => k + 1);
    }
    setViewing({ sessionId, entryId, leafId, label });
    void patch({ lastViewed: sessionId, lastViewedEntry: entryId });
  }, [patch, selectedId]);

  const stopViewing = useCallback(() => {
    setViewing(null);
    if (openSessionId) void patch({ lastViewed: openSessionId, lastViewedEntry: null });
  }, [openSessionId, patch]);

  const startNewChat = useCallback(() => {
    if (!snapshot) return;
    setSelectedId(null); setCreatedSession(null); setViewing(null);
    setDraftKey(`waygoal-new:${crypto.randomUUID()}:${snapshot.cwd}`);
    setPanelKey(k => k + 1);
    setNotice("");
  }, [snapshot]);

  const closePanel = useCallback(() => {
    setSelectedId(null); setDraftKey(null); setCreatedSession(null); setViewing(null);
    viewportRef.current?.focus();
  }, []);

  const onSessionCreated = useCallback((session: SessionInfo) => {
    setCreatedSession(session);
    setSelectedId(session.id);
    void patch({ lastViewed: session.id, lastViewedEntry: null });
    void refresh(true);
  }, [patch, refresh]);

  /** Land on a session that was just branched off, keeping where it came from. */
  const landOnFork = useCallback(async (newSessionId: string, originSessionId: string, originEntryId?: string) => {
    if (originEntryId) await patch({ origin: { sessionId: newSessionId, originSessionId, originEntryId } });
    setViewing(null); setDraftKey(null); setCreatedSession(null);
    setSelectedId(newSessionId);
    setPanelKey(k => k + 1);
    await patch({ lastViewed: newSessionId, lastViewedEntry: null });
    setNotice(originEntryId
      ? "已分出一条新路径。原来的讨论还在画布上，连线指向它分出的那条消息。"
      : "已分出一条新路径。这次没有记下具体消息位置，画布只显示来源会话。");
    await refresh(true);
  }, [patch, refresh]);

  /** The real Pi fork, from a message in the read-only view. */
  const forkFrom = useCallback(async (sessionId: string, entryId: string) => {
    setForkingEntryId(entryId);
    try {
      const res = await fetch(`/api/agent/${encodeURIComponent(sessionId)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "fork", entryId }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      const newSessionId = (body.data as { newSessionId?: string } | undefined)?.newSessionId;
      if (!newSessionId) throw new Error("这段历史还没有保存，暂时不能从这里分叉。");
      await landOnFork(newSessionId, sessionId, entryId);
    } catch (e) {
      setError(`分叉没有完成：${e instanceof Error ? e.message : String(e)}`);
    } finally { setForkingEntryId(null); }
  }, [landOnFork]);

  /** The one action that moves the agent: continue from an explicit position. */
  const continueAt = useCallback(async (sessionId: string, entryId: string) => {
    try {
      const res = await fetch(`/api/agent/${encodeURIComponent(sessionId)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "navigate_tree", targetId: entryId }),
      });
      const body = await res.json() as { error?: string; data?: { cancelled?: boolean } };
      if (!res.ok) throw new Error(body.error);
      // Pi can refuse the move (an extension cancelled it, a summary aborted).
      if (body.data?.cancelled) { setNotice("继续位置没有切换，Pi 取消了这次导航。"); return; }
      setViewing(null);
      setSelectedId(sessionId);
      setPanelKey(k => k + 1);
      setNotice("继续位置已切到这条路径，下一次发送进入这里。其他路径仍然保留。");
      await patch({ lastViewed: sessionId, lastViewedEntry: null });
      await loadTree(sessionId);
      await refresh(true);
    } catch (e) {
      setError(`没有切换继续位置：${e instanceof Error ? e.message : String(e)}`);
    }
  }, [loadTree, patch, refresh]);

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
    if ((e.target as HTMLElement).closest("[data-node], [data-chip]")) return;
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
  const branchNodeCount = nodes.filter(n => n.branchPointCount > 0).length;
  const panelOrigin = selectedNode?.origin ?? null;

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
    {error && <div role="alert" className="waygoal-alert">{error}<button type="button" aria-label="关闭错误" onClick={() => setError("")}>×</button></div>}
    {notice && <div role="status" className="waygoal-notice">{notice}<button type="button" aria-label="关闭提示" onClick={() => setNotice("")}>×</button></div>}
    {trust?.requiresTrust && !trust.trusted && snapshot && <div role="status" className="waygoal-notice">这个目录带有项目级 skills 或扩展；Pi 需要你确认信任后才会加载它们。
      <button type="button" className="waygoal-button outlined small" onClick={() => void fetch("/api/project-trust", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd: snapshot.cwd }) }).then(r => r.json()).then(setTrust)}>信任此目录</button></div>}
    <div className="waygoal-stage">
      <section className="waygoal-canvas-area" aria-label="会话画布区域">
        <div className="waygoal-toolbar">
          <h1>{cwdName || "会话画布"}</h1>
          <span className="waygoal-count">{snapshot ? `${nodes.length} 段会话${branchNodeCount ? ` · ${branchNodeCount} 段有会话内分叉` : ""}${runningCount ? ` · ${runningCount} 段正在运行` : ""}` : "正在读取…"}</span>
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
            <svg className="waygoal-links" width="1" height="1" aria-hidden="true">
              {originEdges.map(edge => {
                const start = borderAnchor(edge.from, edge.to);
                const end = borderAnchor(edge.to, edge.from);
                const mx = (start.x + end.x) / 2, my = (start.y + end.y) / 2;
                const label = edge.exact ? "分叉自这条消息" : "分叉自这段会话";
                // Cards the user dragged close together leave no room between
                // them; a label that would run under a card is dropped, and the
                // card's own 「分叉自「…」」 mark still says where it came from.
                const gap = Math.hypot(end.x - start.x, end.y - start.y);
                return <g key={`origin-${edge.id}`} className="waygoal-link">
                  <path d={`M ${start.x} ${start.y} L ${end.x} ${end.y}`} />
                  <circle cx={end.x} cy={end.y} r={4.5} />
                  {gap >= label.length * LINK_LABEL_CHAR_W + 16
                    && <text x={mx} y={my - 9} textAnchor="middle">{label}</text>}
                </g>;
              })}
            </svg>
            {nodes.map(node => <button key={node.id} type="button" data-node={node.id}
              ref={node.id === selectedId ? selectedElRef : undefined}
              className={`waygoal-node${node.id === selectedId ? " selected" : ""}${node.running ? " running" : ""}${viewing?.sessionId === node.id ? " viewing" : ""}`}
              style={{ left: node.position.x, top: node.position.y }}
              aria-pressed={node.id === selectedId}
              aria-label={`${node.title}${node.running ? "，正在运行" : ""}${node.branchPointCount ? `，${node.branchPointCount} 处会话内分叉` : ""}${node.origin ? "，有分叉来源" : ""}`}
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
              {(node.origin || node.branchPointCount > 0) && <span className="waygoal-node-marks">
                {node.origin && <span className="waygoal-tag origin">{node.origin.inWorkspace ? `分叉自「${node.origin.title}」` : "分叉自其他工作目录"}</span>}
                {node.branchPointCount > 0 && <span className="waygoal-tag branch">{node.branchPointCount} 处会话内分叉</span>}
              </span>}
              <span className="waygoal-node-foot"><span>{node.messageCount ? `${node.messageCount} 条消息` : "还没有消息"}</span><span aria-hidden="true">{node.id === selectedId ? "正在查看" : "打开 →"}</span></span>
            </button>)}
            {/* In-session paths of the open node, so branches stay findable on the
                canvas and not only inside the chat panel. Clicking one reads it. */}
            {selectedNode && selectedChoices.map(({ choice, order }, index) => <button key={`chip-${choice.entryId}`} type="button" data-chip={choice.entryId}
              className={`waygoal-chip${choice.active ? " active" : ""}${viewing?.entryId === choice.entryId ? " viewing" : ""}`}
              style={{ left: selectedNode.position.x, top: selectedNode.position.y + chipTop + index * CHIP_HEIGHT, width: NODE_W }}
              onPointerDown={e => e.stopPropagation()}
              onClick={e => { e.stopPropagation(); viewPath(selectedNode.id, choice.entryId, `会话内路径 ${order + 1}`, choice.leafId); }}
              title="只看这段：显示这条路径的历史，不改变继续位置">
              <span className="waygoal-chip-label">路径 {order + 1}</span>
              <span className="waygoal-chip-preview">{choice.preview}</span>
              {viewing?.entryId === choice.entryId && <span className="waygoal-tag reading">正在查看</span>}
              {choice.active && <span className="waygoal-tag continuing">继续位置</span>}
            </button>)}
            {snapshot && nodes.length === 0 && <div className="waygoal-empty" style={{ left: 0, top: 0 }}>
              <strong>这个目录还没有 Pi 会话。</strong>
              <p>点「新开聊天」开始一段讨论；已有的 Pi 会话会按真实身份出现在这里。不需要 Git 仓库、票据或特定 skill。</p>
            </div>}
          </div>
        </div>
        <div className="waygoal-statusline"><span>拖动卡片摆放 · 拖动空白处平移 · 滚轮缩放 · 只看这段不改变继续位置</span><span className="waygoal-id">{snapshot?.workspaceId}</span></div>
      </section>
      {panelOpen && snapshot && <aside className="waygoal-panel" aria-label="讨论面板">
        <div className="waygoal-panel-head">
          {isMobile && <button type="button" className="waygoal-button outlined small" onClick={closePanel}>← 回到画布</button>}
          <div className="waygoal-panel-title">
            <span className="waygoal-eyebrow">{viewing ? "只读回看" : panelSession ? (selectedNode?.running ? "正在运行" : "已有会话") : "新的会话"}</span>
            <strong>{panelSession ? (selectedNode?.title ?? createdSession?.firstMessage ?? "会话") : "先写下第一句，发送后这段会话才会出现在画布上"}</strong>
          </div>
          {viewing && <button type="button" className="waygoal-button outlined small" onClick={stopViewing}>回到继续位置</button>}
          {!isMobile && <button type="button" className="waygoal-icon" aria-label="关闭面板" onClick={closePanel}>×</button>}
        </div>
        {panelSession && <WaygoalPaths
          origin={panelOrigin}
          branchPoints={tree?.sessionId === panelSession.id ? tree.branchPoints : []}
          viewingEntryId={viewing?.sessionId === panelSession.id ? viewing.entryId : null}
          busyReason={busyReason}
          loading={!tree || tree.sessionId !== panelSession.id}
          onViewOrigin={() => {
            if (!panelOrigin) return;
            if (!panelOrigin.inWorkspace) { setNotice("来源会话不在这个工作目录里，画布不会替你打开另一段历史。"); return; }
            // Nothing to continue from here: this is the source discussion, and
            // its own paths are chosen from its own panel.
            viewPath(panelOrigin.sessionId, panelOrigin.entryId, panelOrigin.entryId ? "来源讨论的这条消息" : "来源讨论", null);
          }}
          onView={choice => panelSession && viewPath(panelSession.id, choice.entryId, "这条路径", choice.leafId)}
          onContinue={leafId => panelSession && void continueAt(panelSession.id, leafId)}
        />}
        <div className="waygoal-panel-body">
          {viewing
            ? <WaygoalPathView key={`${viewing.sessionId}:${viewing.entryId}`} sessionId={viewing.sessionId} leafId={viewing.entryId} cwd={snapshot.cwd}
                label={viewing.label} busyReason={busyReason} forkingEntryId={forkingEntryId}
                onContinue={viewing.leafId ? () => void continueAt(viewing.sessionId, viewing.leafId!) : null}
                onFork={entryId => void forkFrom(viewing.sessionId, entryId)} />
            : <ChatWindow key={panelKey} session={panelSession} sessionRunning={selectedNode?.running ?? false}
                newSessionCwd={panelSession ? null : snapshot.cwd} newSessionDraftKey={panelSession ? null : draftKey}
                onSessionCreated={onSessionCreated}
                onSessionForked={(newSessionId, originEntryId) => {
                  const from = chatSessionId.current;
                  if (from) void landOnFork(newSessionId, from, originEntryId);
                }}
                forkLabel="从这里分叉"
                onAgentEnd={() => { void refresh(true); if (openSessionId) void loadTree(openSessionId); }} soundEnabled={false}
                onOpenSession={id => { const node = snapshot.nodes.find(n => n.id === id); if (node) openNode(node); }} />}
        </div>
      </aside>}
    </div>
  </main>;
}
