"use client";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type Dispatch, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import { feedbackIntent, feedbackMotion } from "./feedback-motion";
import { TakeawayEditor } from "./TakeawayEditor";
import { zoomTier, takeawayChanged, type ZoomTier, type TurnTakeaway } from "@/lib/waygoal/takeaways";
import { expandedTurns, type SessionSize } from "@/lib/waygoal/session-expansion";
import type { WaygoalView, WaygoalPoint, WaygoalTurnLayout } from "@/lib/waygoal/types";
import type { WaygoalTurns, WaygoalTurn } from "@/lib/waygoal/turns";
import { MATERIAL_SCOPES, type MaterialScope, type MaterialSnapshot } from "@/lib/waygoal/materials";
import { findEntryTurn } from "@/lib/waygoal/entry-index";
import { projectTurnBoard, turnKey, TURN_WIDTH as WIDTH, TURN_HEIGHT as HEIGHT, TURN_GAP as GAP, type BoardCard, type BoardEdge, type BoardSession } from "@/lib/waygoal/turn-board";
import { sessionsToLoad } from "@/lib/waygoal/turn-loading";
import "./TurnSelection.css";

interface Props {
  sessionId: string;
  targetVersion: number;
  board?: WaygoalTurnLayout;
  layouts?: Record<string, WaygoalTurnLayout>;
  onSaveBoard: (layout: WaygoalTurnLayout) => Promise<boolean>;
  sessions: (BoardSession & { position: WaygoalPoint })[];
  expanded: string[];
  worldHost: HTMLDivElement | null;
  camera: WaygoalView;
  setCamera: Dispatch<SetStateAction<WaygoalView>>;
  onGrabCamera: () => WaygoalView;
  setCameraDirect: Dispatch<SetStateAction<WaygoalView>>;
  onExpand: (id: string) => void;
  onGeometry: (sizes: Record<string, SessionSize>, cards: BoardCard[], edges: BoardEdge[]) => void;
  onFit: () => void;
  locateEntry: { entryId: string; serial: number } | null;
  locateMaterial?: { sessionId: string; turnId: string; serial: number };
  inspectEntry: { entryId: string; serial: number } | null;
  materials: MaterialSnapshot[];
  busy: boolean;
  onLocate: (sessionId: string, turn: WaygoalTurn) => void;
  onContinue: (sessionId: string, leafId: string) => void;
  onOpenSession: (sessionId: string) => void;
  onDismissPreview: () => void;
  onMaterial: (material: MaterialSnapshot, allowed: () => boolean) => void;
  onMaterials?: (materials: MaterialSnapshot[], allowed: () => boolean, focus: boolean) => void;
  onReady: (sessionId: string) => void;
  onOverview: () => void;
  onFork: (sessionId: string, entryId: string) => void;
}
type Point = { x: number; y: number };

/** This board owns viewing/layout only. The persistent ChatWindow beside it
 * owns the continuation; neither selecting a card nor reading an edge moves it. */
export function WaygoalTurnCanvas({ sessionId, targetVersion, board, layouts, onSaveBoard, sessions, locateEntry, locateMaterial, inspectEntry, materials, busy, onLocate, onContinue, onOpenSession, onDismissPreview, onMaterial, onMaterials, onOverview, onFork, onReady, expanded, worldHost, camera, setCamera, onGrabCamera, setCameraDirect, onGeometry, onExpand, onFit }: Props) {
  const tierRef = useRef<ZoomTier>("detail");
  const tier = zoomTier(camera.scale, tierRef.current);
  useEffect(() => { tierRef.current = tier; }, [tier]);
  const [confirmation, setConfirmation] = useState<{ key: string; allowed: () => boolean } | null>(null);
  useLayoutEffect(() => {
    if (!confirmation?.allowed()) return;
    const card = Array.from(worldHost?.querySelectorAll<HTMLElement>("[data-turn-key]") ?? []).find(element => element.dataset.turnKey === confirmation.key);
    card?.querySelectorAll(".waygoal-takeaway-status, .waygoal-turn-glyph").forEach(element => {
      if (element.getBoundingClientRect().width) feedbackMotion(element, { opacity: 0, transform: "scale(.97)" }, { opacity: 1, transform: "none" });
    });
  }, [confirmation, worldHost]);
  const [editingTakeaway, setEditingTakeaway] = useState<BoardCard | null>(null);
  const [actionKey, setActionKey] = useState<string | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const toolsMenu = useRef<HTMLDetailsElement>(null);
  const [sourceId, setSourceId] = useState(sessionId);
  const [data, setData] = useState<Record<string, WaygoalTurns>>({});
  const [readErrors, setReadErrors] = useState<Record<string, string>>({});
  const [layout, setLayout] = useState<WaygoalTurnLayout>(() => board ?? { positions: {}, links: Object.entries(layouts ?? {}).flatMap(([sid, saved]) => saved.links.map(([a, b]): [string, string] => [turnKey(sid, a), turnKey(sid, b)])) });
  const [selected, setSelected] = useState<string | null>(null);
  // Selection belongs to this view, never to Pi history or the saved layout.
  const [selecting, setSelecting] = useState(false);
  const [selection, setSelection] = useState<string[]>([]);
  const [selectionScope, setSelectionScope] = useState<"turn" | "answer" | "user">("turn");
  const [selectionError, setSelectionError] = useState("");
  const [mode, setMode] = useState<"read" | "reference" | "link">("read");
  const [from, setFrom] = useState<string | null>(null);
  const [linkSaving, setLinkSaving] = useState(false);
  const linkInFlight = useRef(false);
  const [linkError, setLinkError] = useState("");
  const [linkSaved, setLinkSaved] = useState(false);
  const [scope, setScope] = useState<MaterialScope>("answer");
  const [excerpt, setExcerpt] = useState("");
  const [treeOpen, setTreeOpen] = useState(false);
  const [inspected, setInspected] = useState<BoardEdge | null>(null);
  const [error, setError] = useState("");
  const [capturing, setCapturing] = useState(false);
  const captureRequest = useRef<AbortController | null>(null);
  const captureSources = useRef<string[]>([]);
  const cancelCapture = useCallback(() => {
    captureRequest.current?.abort(); captureRequest.current = null;
    captureSources.current = []; setCapturing(false);
  }, []);
  const exitSelection = useCallback(() => {
    cancelCapture(); setSelection([]); setSelecting(false); setSelectionError("");
  }, [cancelCapture]);
  const viewport = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setViewportSize({ width: element.clientWidth, height: element.clientHeight }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setEditingTakeaway(null); setActionKey(null); setTreeOpen(false); setMode("read"); setFrom(null); setInspected(null); setLinkSaved(false);
      exitSelection();
      if (toolsMenu.current) toolsMenu.current.open = false;
    };
    window.addEventListener("keydown", dismiss);
    return () => window.removeEventListener("keydown", dismiss);
  }, [exitSelection]);
  useEffect(() => {
    if (mode !== "link") return;
    const cancelLink = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault(); event.stopPropagation();
      if (!linkInFlight.current) { setMode("read"); setFrom(null); setLinkError(""); }
    };
    // Cancel selection before the canvas handles Escape by closing the chat.
    window.addEventListener("keydown", cancelLink, true);
    return () => window.removeEventListener("keydown", cancelLink, true);
  }, [mode]);
  const gesture = useRef<{ id?: string; start: Point; origin: Point; moved: boolean; pointerId: number } | null>(null);
  const layoutRef = useRef(layout); layoutRef.current = layout;
  const positions = useRef<Record<string, Point>>({});
  const sessionIds = JSON.stringify(sessionsToLoad(sessions, [...expanded, sessionId, ...(locateMaterial ? [locateMaterial.sessionId] : [])]));
  const turnEtags = useRef(new Map<string, string>());
  useLayoutEffect(() => {
    cancelCapture();
    return () => captureRequest.current?.abort();
  }, [sessionId, targetVersion, busy, cancelCapture]);
  useLayoutEffect(() => {
    if (!captureRequest.current) return;
    const unavailable = captureSources.current.some(id => readErrors[id] || !sessions.some(session => session.id === id) || sessions.find(session => session.id === id)?.running);
    if (unavailable || sessions.find(session => session.id === sessionId)?.running) {
      cancelCapture(); setSelectionError("会话正在运行或来源不可读取，已停止读取。选区已保留，请稍后重试。");
    }
  }, [sessions, readErrors, sessionId, cancelCapture]);
  useEffect(() => { setSelection([]); setSelecting(false); setSelectionError(""); }, [sessionId]);
  useEffect(() => { setSourceId(sessionId); setInspected(null); setFrom(null); setActionKey(null); }, [sessionId]);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const ids = JSON.parse(sessionIds) as string[];
    const wanted = new Set(ids);
    for (const id of turnEtags.current.keys()) if (!wanted.has(id)) turnEtags.current.delete(id);
    setData(current => Object.keys(current).some(id => !wanted.has(id))
      ? Object.fromEntries(Object.entries(current).filter(([id]) => wanted.has(id))) : current);
    const refresh = async () => {
      const loaded: Record<string, WaygoalTurns> = {};
      const failed: Record<string, string> = {};
      const receivedEtags = new Map<string, string>();
      // Bound concurrent reads and pause background polling. No AgentSession is
      // created by these endpoints; failed sources remain visibly marked stale.
      for (let offset = 0; offset < ids.length && !controller.signal.aborted; offset += 4) {
        await Promise.all(ids.slice(offset, offset + 4).map(async id => {
          try {
            const etag = turnEtags.current.get(id);
            const response = await fetch(`/api/waygoal/session/${encodeURIComponent(id)}/turns`, { signal: controller.signal, cache: "no-store", headers: etag ? { "If-None-Match": etag } : {} });
            if (response.status === 304) return;
            const body = await response.json();
            if (!response.ok) throw new Error(body.error);
            loaded[id] = body;
            const nextEtag = response.headers.get("etag");
            if (nextEtag) receivedEtags.set(id, nextEtag);
          } catch (error) { failed[id] = error instanceof Error ? error.message : String(error); }
        }));
      }
      if (!controller.signal.aborted) {
        for (const [id, etag] of receivedEtags) turnEtags.current.set(id, etag);
        if (Object.keys(loaded).length) setData(current => ({ ...current, ...loaded }));
        setReadErrors(current => JSON.stringify(current) === JSON.stringify(failed) ? current : failed);
        timer = setTimeout(tick, 2000);
      }
    };
    const tick = () => { if (document.visibilityState === "visible") void refresh(); else timer = setTimeout(tick, 2000); };
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [sessionIds]);
  const graph = useMemo(() => projectTurnBoard(sessions, data, layout, positions.current,
    board ? {} : Object.fromEntries(Object.entries(layouts ?? {}).map(([id, saved]) => [id, { ...saved, links: [] }]))), [sessions, data, layout, board, layouts]);
  const sessionOrigins = useRef(board?.sessionOrigins ?? {});
  const projection = useMemo(() => expandedTurns(graph, sessions, expanded, sessionOrigins.current), [graph, sessions, expanded]);
  useEffect(() => { sessionOrigins.current = projection.bases; }, [projection.bases]);
  const cards = projection.cards;
  useEffect(() => { positions.current = Object.fromEntries(graph.cards.map(card => [card.key, card.position])); }, [graph.cards]);
  useEffect(() => onGeometry(projection.sizes, cards, graph.edges), [projection.sizes, cards, graph.edges, onGeometry]);
  const byKey = useMemo(() => new Map(cards.map(card => [card.key, card])), [cards]);
  const memberFor = (card: BoardCard) => card.members.find(member => member.sessionId === sessionId) ?? card;
  const title = (id: string) => sessions.find(session => session.id === id)?.title ?? "来源会话不可用";
  const persistLayout = (next: WaygoalTurnLayout) => {
    const saved = { ...next, sessionOrigins: sessionOrigins.current, positions: { ...positions.current, ...next.positions } };
    layoutRef.current = saved; setLayout(saved); return onSaveBoard(saved);
  };
  const activeTurn = data[sessionId]?.turns.findLast(turn => turn.active);
  const activeKey = activeTurn ? graph.aliases.get(turnKey(sessionId, activeTurn.id)) : undefined;
  const active = activeKey ? byKey.get(activeKey) : undefined;
  const ownCards = cards.filter(card => card.sessionId === sessionId);
  let next = active && ownCards.length ? { x: active.position.x, y: active.position.y + HEIGHT + GAP } : graph.anchors[sessionId] ?? { x: 0, y: 0 };
  while (cards.some(card => Math.abs(card.position.x - next.x) < WIDTH + 20 && Math.abs(card.position.y - next.y) < HEIGHT + 25)) next = { ...next, y: next.y + HEIGHT + GAP };
  const focusCard = useCallback((key: string, readable = false) => {
    const card = byKey.get(key), bounds = viewport.current?.getBoundingClientRect();
    if (!card || !bounds) return;
    setSelected(card.key);
    setCamera(camera => { const scale = readable ? Math.max(1, camera.scale) : camera.scale; return { scale, x: bounds.width / 2 - (card.position.x + WIDTH / 2) * scale, y: bounds.height / 2 - (card.position.y + HEIGHT / 2) * scale }; });
  }, [byKey, setCamera]);
  useEffect(() => { if (data[sessionId]?.turns.length) onReady(sessionId); }, [data, sessionId, onReady]);
  const previousCount = useRef<{ session: string; count: number } | null>(null);
  useEffect(() => {
    const count = data[sessionId]?.turns.length;
    if (count === undefined || viewportSize.width === 0) return;
    const previous = previousCount.current;
    previousCount.current = { session: sessionId, count };
    if (activeKey && previous?.session === sessionId && count > previous.count) focusCard(activeKey);
  }, [data, sessionId, activeKey, focusCard, viewportSize.width]);
  const pendingFocus = useRef<string | null>(null);
  useEffect(() => {
    if (pendingFocus.current && byKey.has(pendingFocus.current)) {
      focusCard(pendingFocus.current, true); pendingFocus.current = null;
    }
  }, [byKey, focusCard]);
  const lastLocate = useRef<number | null>(null);
  useEffect(() => {
    if (!locateEntry || lastLocate.current === locateEntry.serial) return;
    const original = graph.cards.find(card => card.members.some(member => member.sessionId === sessionId && member.turn.id === findEntryTurn(data[member.sessionId], locateEntry.entryId)?.id));
    if (original && !projection.owners.has(original.key)) { onExpand(original.sessionId); return; }
    const card = cards.find(card => card.members.some(member => member.sessionId === sessionId && member.turn.id === findEntryTurn(data[member.sessionId], locateEntry.entryId)?.id));
    if (!card) return;
    lastLocate.current = locateEntry.serial; setInspected(null); focusCard(card.key, true);
  }, [locateEntry, cards, focusCard, sessionId, expanded, onExpand, graph.cards, projection.owners, data]);
  const lastInspect = useRef<number | null>(null);
  const lastMaterialLocate = useRef<string | null>(null);
  useEffect(() => {
    if (!locateMaterial) return;
    const intent = JSON.stringify(locateMaterial);
    if (lastMaterialLocate.current === intent) return;
    const original = graph.cards.find(card => card.members.some(member => member.sessionId === locateMaterial.sessionId && member.turn.id === locateMaterial.turnId));
    // Only reveal an existing graph card; do not open a session or navigate Pi.
    if (!original) return;
    if (!projection.owners.has(original.key)) { onExpand(original.sessionId); return; }
    if (!byKey.has(original.key) || !viewportSize.width) return;
    lastMaterialLocate.current = intent;
    setActionKey(null); setInspected(null); focusCard(original.key, true);
  }, [locateMaterial, graph.cards, projection.owners, byKey, viewportSize.width, onExpand, focusCard]);
  useEffect(() => {
    if (!inspectEntry || lastInspect.current === inspectEntry.serial) return;
    const turn = findEntryTurn(data[sessionId], inspectEntry.entryId);
    const edge = turn && graph.edges.find(edge => edge.kind === "reference" && edge.to === graph.aliases.get(turnKey(sessionId, turn.id)));
    if (!edge) return;
    lastInspect.current = inspectEntry.serial; setInspected(edge);
  }, [inspectEntry, data, graph, sessionId]);

  const reference = async (key: string, selectedScope = scope) => {
    const card = byKey.get(key);
    if (!card || captureRequest.current || busy || !sessionId) return;
    const member = memberFor(card);
    if (readErrors[member.sessionId]) { setError("来源读取失败，请等待恢复后重新选择材料。"); return; }
    if (sessions.some(session => (session.id === member.sessionId || session.id === sessionId) && session.running)) { setError("会话正在运行，请等待回复结束后再读取材料。"); return; }
    const allowed = feedbackIntent(worldHost);
    const controller = new AbortController(); captureRequest.current = controller;
    captureSources.current = [member.sessionId];
    setCapturing(true); setError("");
    try {
      const query = new URLSearchParams({ turn: member.turn.id, target: sessionId, scope: selectedScope, ...(selectedScope === "excerpt" ? { excerpt } : {}) });
      const response = await fetch(`/api/waygoal/session/${encodeURIComponent(member.sessionId)}/materials?${query}`, { cache: "no-store", signal: controller.signal });
      const body = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok) throw new Error(body.error);
      onMaterial(body, allowed); setFrom(null); setActionKey(null); onDismissPreview();
    } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : String(error)); }
    finally { if (captureRequest.current === controller) { captureRequest.current = null; captureSources.current = []; setCapturing(false); } }
  };
  const selectionCards = selection.map(key => graph.cards.find(card => card.key === key));
  const selectionMembers = selectionCards.flatMap(card => card ? [memberFor(card)] : []);
  const selectionBlocked = !sessionId ? "请先打开当前会话，再加入材料。"
    : busy || sessions.find(session => session.id === sessionId)?.running ? "当前会话正在运行或处理中，请结束后再加入材料。"
    : !onMaterials ? "当前视图尚未接入批量材料。"
    : selectionCards.some(card => !card) ? "部分轮次已不在画布，请取消后重新选择。"
    : selectionMembers.some(member => readErrors[member.sessionId]) ? "来源读取失败，选区已保留，请恢复后重试。"
    : selectionMembers.some(member => sessions.find(session => session.id === member.sessionId)?.running) ? "所选来源会话正在运行，请等待回复结束，避免读取未完成材料。"
    : !selection.length ? "点选轮次，也可用 ⌘ / Ctrl 点击；选一轮也可加入。" : "";
  const toggleSelection = (key: string) => {
    // Changing the selection invalidates the whole batch, never a partial tray.
    cancelCapture(); setSelectionError(""); setSelecting(true);
    setMode("read"); setFrom(null); setActionKey(null); setInspected(null); setTreeOpen(false);
    setSelection(current => current.includes(key) ? current.filter(item => item !== key) : [...current, key]);
  };
  const captureSelection = async () => {
    if (captureRequest.current || selectionBlocked || !onMaterials) return;
    const focusOwner = document.activeElement;
    const controller = new AbortController(); captureRequest.current = controller;
    captureSources.current = selectionMembers.map(member => member.sessionId);
    const allowed = feedbackIntent(worldHost);
    setCapturing(true); setSelectionError("");
    try {
      const snapshots: MaterialSnapshot[] = [];
      // Bound reads while retaining click order. Nothing enters the tray until
      // every source has succeeded and all snapshots agree on the target path.
      for (let offset = 0; offset < selectionMembers.length; offset += 4) {
        const batch = await Promise.all(selectionMembers.slice(offset, offset + 4).map(async member => {
          const query = new URLSearchParams({ turn: member.turn.id, target: sessionId, scope: selectionScope });
          const response = await fetch(`/api/waygoal/session/${encodeURIComponent(member.sessionId)}/materials?${query}`, { cache: "no-store", signal: controller.signal });
          const body = await response.json();
          if (!response.ok) throw new Error(`${title(member.sessionId)}：${body.error || "材料读取失败，请重试。"}`);
          if (body.sessionId !== member.sessionId || body.turnId !== member.turn.id || body.scope !== selectionScope || !Array.isArray(body.parts) || !body.parts.length || !(body.targetLeafId === null || typeof body.targetLeafId === "string")) throw new Error("材料响应不完整，请重新读取。");
          return body as MaterialSnapshot;
        }));
        if (controller.signal.aborted) return;
        snapshots.push(...batch);
      }
      if (snapshots.some(snapshot => snapshot.targetLeafId !== snapshots[0].targetLeafId)) throw new Error("读取期间当前路径发生变化，未加入任何材料。请重试。");
      if (controller.signal.aborted) return;
      const focus = !!focusOwner?.isConnected && document.activeElement === focusOwner;
      onMaterials(snapshots, allowed, focus);
      setSelection([]); setSelecting(false); setActionKey(null);
      if (focus) onDismissPreview();
    } catch (error) {
      if (!controller.signal.aborted) {
        setSelectionError(`${error instanceof Error ? error.message : String(error)} 选区已保留，未加入任何材料。`);
        controller.abort(); // Stop other reads in the failed Promise.all batch.
      }
    } finally {
      if (captureRequest.current === controller) { captureRequest.current = null; captureSources.current = []; setCapturing(false); }
    }
  };
  const beginLink = (key: string | null = null) => {
    exitSelection(); setMode("link"); setFrom(key); setActionKey(null);
    setInspected(null); setLinkSaved(false); setLinkError(""); setTreeOpen(false);
    if (toolsMenu.current) toolsMenu.current.open = false;
  };
  const connect = async (to: string) => {
    if (linkInFlight.current) return;
    if (!from || from === to) { setFrom(to); setLinkError(""); return; }
    const pair: [string, string] = [from, to];
    const current = layoutRef.current;
    const exists = current.links.some(([a, b]) => (a === from && b === to) || (a === to && b === from));
    linkInFlight.current = true; setLinkSaving(true); setLinkError("");
    try {
      if (!exists) {
        const saved = { ...current, sessionOrigins: sessionOrigins.current, positions: { ...current.positions, ...positions.current }, links: [...current.links, pair] };
        if (!await onSaveBoard(saved)) throw new Error("保存失败");
        layoutRef.current = saved; setLayout(saved);
      }
      setFrom(null); setMode("read"); setLinkSaved(true);
    } catch {
      setLinkError("关联没有保存，请重新点选目标卡片重试。");
    } finally { linkInFlight.current = false; setLinkSaving(false); }
  };
  const edgePath = (a: Point, b: Point, side = false, fromTurn = true, toTurn = true) => {
    const compactA = tier === "overview" && fromTurn, compactB = tier === "overview" && toTurn;
    const ax = a.x + WIDTH / 2, ay = a.y + HEIGHT / 2, bx = b.x + WIDTH / 2, by = b.y + HEIGHT / 2;
    if (side) { const direction = bx > ax ? 1 : -1, start = ax + direction * (compactA ? 36 : WIDTH / 2), end = bx - direction * (compactB ? 36 : WIDTH / 2), bend = Math.max(60, Math.abs(end - start) / 2) * direction; return `M ${start} ${ay} C ${start + bend} ${ay}, ${end - bend} ${by}, ${end} ${by}`; }
    const start = ay + (compactA ? 36 : HEIGHT / 2), end = by - (compactB ? 36 : HEIGHT / 2);
    return `M ${ax} ${start} C ${ax} ${start + GAP / 2}, ${bx} ${end - GAP / 2}, ${bx} ${end}`;
  };
  const locate = (card: BoardCard) => { setInspected(null); setSelected(card.key); setActionKey(card.key); const member = memberFor(card); onLocate(member.sessionId, member.turn); };
  const inspect = (edge: BoardEdge) => { onDismissPreview(); setLinkSaved(false); setInspected(edge); };
  const actionCard = actionKey ? byKey.get(actionKey) : undefined;
  const actionMember = actionCard && memberFor(actionCard);
  const actionOnCurrentPath = actionMember?.sessionId === sessionId && actionMember.turn.active;
  const forkBlocked = busy || Boolean(sessions.find(session => session.id === actionMember?.sessionId)?.running);
  const menuWidth = Math.min(actionOnCurrentPath ? 270 : 430, viewportSize.width - 16);
  const actionBounds = actionCard ? {
    left: camera.x + actionCard.position.x * camera.scale,
    top: camera.y + actionCard.position.y * camera.scale,
    right: camera.x + (actionCard.position.x + WIDTH) * camera.scale,
    bottom: camera.y + (actionCard.position.y + HEIGHT) * camera.scale,
  } : null;
  const menuTop = actionBounds && (actionBounds.bottom + 66 < viewportSize.height - 66 ? actionBounds.bottom + 8 : actionBounds.top - 60);
  const showActions = actionBounds && menuTop !== null && menuTop >= 0 && menuTop < viewportSize.height - 60
    && actionBounds.right > 0 && actionBounds.left < viewportSize.width && actionBounds.bottom > 0 && actionBounds.top < viewportSize.height;
  return <section className="waygoal-turn-canvas waygoal-turn-embedded" aria-label="轮次画布" data-selecting={selecting || undefined}>
    <div className="waygoal-turn-toolbar">
      <button type="button" aria-label="当前轮次" title="定位当前对话正在聊的轮次" onClick={() => { setActionKey(null); if (active) focusCard(active.key, true); else if (sessionId) { pendingFocus.current = activeKey ?? null; onExpand(graph.cards.find(card => card.key === activeKey)?.sessionId ?? sessionId); } }}>定位对话</button>
      <button type="button" aria-label="全景" title="缩放画布，查看所有会话与分支" onClick={() => { setActionKey(null); onFit(); }}>查看全部</button>
      <details className="waygoal-turn-more" ref={toolsMenu}>
        <summary aria-label="画布操作" title="画布工具：多选、连线与路径">画布工具</summary>
        <div className="waygoal-turn-more-body">
      <button type="button" aria-pressed={selecting} onClick={() => {
        if (selecting) exitSelection();
        else { cancelCapture(); setSelecting(true); setSelectionError(""); setMode("read"); setFrom(null); setActionKey(null); setInspected(null); setTreeOpen(false); }
        if (toolsMenu.current) toolsMenu.current.open = false;
      }}>多选轮次</button>
      <button type="button" onClick={() => { onOverview(); if (toolsMenu.current) toolsMenu.current.open = false; }}>整理会话与票据</button>
      <select aria-label="查看会话轮次" value={sourceId} onChange={event => {
        const id = event.target.value; setSourceId(id); onExpand(id);
        const last = data[id]?.turns.findLast(turn => turn.active);
        const key = last && graph.aliases.get(turnKey(id, last.id)); if (key) { const owner = graph.cards.find(card => card.key === key)?.sessionId; if (owner) onExpand(owner); pendingFocus.current = key; if (byKey.has(key)) { focusCard(key, true); pendingFocus.current = null; } }
      }}>{sessions.map(session => <option key={session.id} value={session.id}>{session.title}</option>)}</select>
      <button type="button" aria-expanded={treeOpen} onClick={() => { exitSelection(); setTreeOpen(!treeOpen); if (toolsMenu.current) toolsMenu.current.open = false; }}>选择继续路径</button>
      <button type="button" aria-pressed={mode === "reference"} onClick={() => { exitSelection(); setMode(mode === "reference" ? "read" : "reference"); setFrom(null); }}>引用连线</button>
      <button type="button" aria-pressed={mode === "link"} onClick={() => beginLink()}>标记相关</button>
      <details className="waygoal-turn-legend-wrap"><summary>连线说明</summary><div className="waygoal-turn-legend"><span>— 连续历史</span><span>━ 分叉来源</span><span>┄ 引用材料</span><span>┈ 手动标记相关</span></div></details>
        </div>
      </details>
    </div>
    {selecting && <div className="waygoal-turn-selection" role="group" aria-label="轮次选区" aria-busy={capturing}>
      <div className="waygoal-turn-selection-head">
        <strong role="status">已选 {selection.length} 轮</strong>
        <select aria-label="综合材料范围" value={selectionScope} disabled={capturing} onChange={event => { setSelectionScope(event.target.value as typeof selectionScope); setSelectionError(""); }}>
          <option value="turn">整轮文字</option><option value="answer">回答</option><option value="user">用户消息</option>
        </select>
        <button type="button" onClick={exitSelection}>取消多选</button>
      </div>
      <button type="button" className="waygoal-turn-selection-submit" disabled={capturing || !!selectionBlocked} onClick={() => void captureSelection()}>加入材料，继续综合</button>
      <p role={selectionError ? "alert" : "status"}>{selectionError || (capturing ? `正在读取 ${selection.length} 轮材料…` : selectionBlocked || "加入当前会话后，在右侧继续写；不会自动发送。")}</p>
    </div>}
    {mode === "reference" && <div className="waygoal-turn-options">
      <select aria-label="引用范围" value={scope} onChange={event => setScope(event.target.value as MaterialScope)}>{Object.entries(MATERIAL_SCOPES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <span>将来源连到当前对话的「下一轮」。文字范围不含图片、思考与工具参数。</span>
      {scope === "excerpt" && <textarea aria-label="回答摘录" value={excerpt} onChange={event => setExcerpt(event.target.value)} placeholder="粘贴回答中的原文摘录" />}
    </div>}
    {mode === "link" && <div className="waygoal-turn-selection waygoal-link-guide" role="group" aria-label="标记相关" aria-busy={linkSaving}>
      <div className="waygoal-turn-selection-head"><strong role="status">{linkSaving ? "正在保存关联…" : from ? "再点一张相关的卡片" : "先点选一张卡片"}</strong>
        <button type="button" disabled={linkSaving} onClick={() => { setMode("read"); setFrom(null); setLinkError(""); }}>取消关联</button></div>
      {from && <p className="waygoal-link-source">已选：{byKey.get(from)?.turn.question || "这轮讨论"}</p>}
      <p>把讨论同一问题的两轮连起来，方便回看对照。只在画布上标记，不会把内容发给 Agent。</p>
      {linkError && <p role="alert">{linkError}</p>}
    </div>}
    {linkSaved && mode !== "link" && <div className="waygoal-turn-selection waygoal-link-guide" role="status">
      <div className="waygoal-turn-selection-head"><strong>已标记相关</strong><button type="button" onClick={() => setLinkSaved(false)}>关闭提示</button></div>
      <p>点两张卡片之间的连线，可以回看或移除关联。</p>
    </div>}
    {treeOpen && <nav className="waygoal-turn-tree" aria-label="Tree 路径选择">
      <strong>{title(sourceId)}</strong>
      {(data[sourceId]?.turns ?? []).filter(turn => !data[sourceId]?.turns.some(child => child.parentId === turn.id)).map((turn, index) => <button key={turn.id} type="button" disabled={busy || !!readErrors[sourceId] || sessions.find(s => s.id === sourceId)?.running} onClick={() => { onContinue(sourceId, turn.endId); setTreeOpen(false); }}>路径 {index + 1} · {turn.question.slice(0, 40)}{turn.active && sourceId === sessionId ? " · 当前" : " · 在此继续"}</button>)}
      {data[sourceId]?.turns.length === 0 && <button type="button" disabled={busy} onClick={() => { onOpenSession(sourceId); setTreeOpen(false); }}>在这段会话继续</button>}
    </nav>}
    {(error || Object.keys(readErrors).length > 0) && <p role="alert" className="waygoal-turn-error">{error || Object.keys(readErrors).map(id => `${title(id)} 读取失败，保留上次画面。`).join(" ")}</p>}
    <div className="waygoal-turn-viewport" ref={viewport} tabIndex={0} aria-label="轮次画布：拖动空白处平移，滚轮缩放"
      onPointerDown={event => { if (event.target !== event.currentTarget || gesture.current || event.button !== 0) return; setActionKey(null); if (toolsMenu.current) toolsMenu.current.open = false; gesture.current = { start: { x: event.clientX, y: event.clientY }, origin: onGrabCamera(), moved: false, pointerId: event.pointerId }; event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={event => { const drag = gesture.current; if (!drag || drag.pointerId !== event.pointerId) return; const dx = event.clientX - drag.start.x, dy = event.clientY - drag.start.y; drag.moved ||= Math.abs(dx) + Math.abs(dy) > 4; if (drag.id) setLayout(layout => ({ ...layout, positions: { ...layout.positions, [drag.id!]: { x: drag.origin.x + dx / camera.scale, y: drag.origin.y + dy / camera.scale } } })); else setCameraDirect(camera => ({ ...camera, x: drag.origin.x + dx, y: drag.origin.y + dy })); }}
      onPointerUp={event => { if (gesture.current?.pointerId !== event.pointerId) return; if (gesture.current?.id && gesture.current.moved) persistLayout(layoutRef.current); requestAnimationFrame(() => { gesture.current = null; }); }} onPointerCancel={event => { if (gesture.current?.pointerId === event.pointerId) gesture.current = null; }}>
      {worldHost && createPortal(<div className="waygoal-turn-world" data-zoom-tier={tier} data-mode={mode} data-selecting={selecting || undefined} style={{ "--turn-scale": camera.scale } as CSSProperties}>
        <svg className="waygoal-turn-lines" width="1" height="1">
          {graph.edges.map(edge => { const a = byKey.get(edge.from), b = byKey.get(edge.to); if (edge.kind === "history" && (!a || !b) || edge.kind === "fork" && !a && !b && !edge.status) return null; const from = a?.position ?? sessions.find(session => session.id === edge.fromSession)?.position, to = b?.position ?? sessions.find(session => session.id === edge.toSession)?.position; if (!from || !to) return null; const path = edgePath(from, to, edge.kind === "reference" || edge.kind === "association", !!a, !!b); return <g key={edge.key} data-spatial-edge={edge.key} data-origin-status={edge.status ?? "resolved"} data-fork-target={edge.kind === "fork" ? edge.toSession : undefined} data-spatial-from={a ? `turn:${a.key}` : `node:${edge.fromSession}`} data-spatial-to={b ? `turn:${b.key}` : `node:${edge.toSession}`}><path d={path} className={edge.kind} /><path d={path} className="edge-hit" role="button" tabIndex={0} aria-label={`${edge.kind === "reference" ? "引用材料" : edge.kind === "fork" ? "分叉来源" : edge.kind === "association" ? "手动关联" : "连续历史"}：${title(edge.fromSession)} → ${title(edge.toSession)}`} onClick={() => inspect(edge)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); inspect(edge); } }} /></g>; })}
          {tier === "detail" && materials.map(material => { const key = graph.aliases.get(turnKey(material.sessionId, material.turnId)), card = key && byKey.get(key); return card ? <path key={`${material.sessionId}:${material.turnId}`} className="reference pending" data-spatial-from={`turn:${card.key}`} data-spatial-to="pending" d={edgePath(card.position, next, true)} /> : null; })}
          {tier === "detail" && from && mode === "reference" && byKey.has(from) && <path className="reference pending" d={edgePath(byKey.get(from)!.position, next, true)} />}
        </svg>
        {cards.map((card, index) => {
          const takeaway = layout.takeaways?.[card.key];
          const changed = takeaway && takeawayChanged(takeaway, card.turn.fingerprint);
          const confirmed = takeaway?.status === "confirmed" && !changed;
          return <article key={card.key} data-turn={card.turn.id} data-session={card.sessionId} data-turn-key={card.key} data-material-selected={selection.includes(card.key) || undefined} data-link-source={mode === "link" && from === card.key || undefined} data-spatial-key={`turn:${card.key}`} data-spatial-owner={projection.owners.get(card.key)} data-takeaway={takeaway ? changed ? "changed" : takeaway.status : undefined} className={`waygoal-turn-card${activeKey === card.key ? " active" : ""}${selected === card.key ? " selected" : ""}`} style={{ left: card.position.x, top: card.position.y, width: WIDTH, height: HEIGHT }}>
          <button type="button" className="waygoal-turn-content" data-spatial-face aria-label={`${index + 1} · ${card.turn.question}`} aria-pressed={mode === "link" ? from === card.key : selecting ? selection.includes(card.key) : selected === card.key}
            onPointerDown={event => { if (mode === "link") { event.stopPropagation(); event.preventDefault(); event.currentTarget.focus({ preventScroll: true }); return; } if (selecting || event.metaKey || event.ctrlKey) { event.stopPropagation(); return; } if (gesture.current || event.button !== 0) return; onGrabCamera(); setActionKey(null); gesture.current = { id: card.key, start: { x: event.clientX, y: event.clientY }, origin: positions.current[card.key] ?? card.position, moved: false, pointerId: event.pointerId }; event.currentTarget.setPointerCapture(event.pointerId); }}
            title={takeaway?.text || card.turn.question}
            onClick={event => { if (mode === "link") { event.stopPropagation(); void connect(card.key); return; } if (selecting || event.metaKey || event.ctrlKey) { event.stopPropagation(); toggleSelection(card.key); return; } if (gesture.current?.moved) return; if (tier !== "detail") { setActionKey(null); focusCard(card.key, true); const member = memberFor(card); onLocate(member.sessionId, member.turn); } else locate(card); }}>
            {selecting && <span className="waygoal-turn-selection-mark" aria-hidden="true"><svg viewBox="0 0 16 16">{selection.includes(card.key) && <path d="m3.5 8 3 3 6-6" />}</svg></span>}
            <span className="waygoal-turn-number">{String(index + 1).padStart(2, "0")}</span>
            <span className="waygoal-turn-glyph" aria-hidden="true"><svg viewBox="0 0 24 24">{confirmed ? <path d="m6 12 4 4 8-8" /> : activeKey === card.key ? <><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="1" /></> : <circle cx="12" cy="12" r="3" />}</svg></span>
            <strong>{tier === "map" && takeaway ? takeaway.text : card.turn.question || "图片消息"}</strong>
            <p>{card.turn.answer || (activeKey === card.key && busy ? "正在回复…" : "…")}</p>
            {takeaway && <span className="waygoal-turn-takeaway">{tier === "detail" && <span>{takeaway.text}</span>}<small className="waygoal-takeaway-status">{changed ? "原文已变化" : confirmed ? "✓ 已确认" : "待确认"}</small></span>}
          </button>
          {mode === "reference" && <button type="button" className={`waygoal-turn-port${from === card.key ? " selected" : ""}`} aria-label={`从 ${index + 1} 连线`} draggable
            onDragStart={event => { event.dataTransfer.setData("text/plain", card.key); setFrom(card.key); }}
            onClick={() => setFrom(card.key)}>●</button>}
        </article>; })}
        {active && <button type="button" className="waygoal-next-turn" data-next-turn style={{ left: next.x, top: next.y, width: WIDTH }} disabled={busy || capturing || mode !== "reference" || !from}
          onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); const key = event.dataTransfer.getData("text/plain"); if (mode === "reference") void reference(key); }} onClick={() => from && void reference(from)}>下一轮{capturing ? " · 正在读取材料…" : materials.length ? ` · 带入 ${materials.length} 份材料` : " · 在右侧继续聊"}</button>}
      </div>, worldHost)}
      {!selecting && showActions && actionCard && actionMember && <div className="waygoal-turn-actions" role="group" aria-label="所选卡片操作"
        style={{ left: Math.max(8, Math.min((actionBounds!.left + actionBounds!.right - menuWidth) / 2, viewportSize.width - menuWidth - 8)), top: menuTop!, width: menuWidth }}>
        <span title={forkBlocked ? "等待当前操作或回复结束后，即可从这里分叉" : "从这轮对话开始一条新分支"}>
          <button type="button" disabled={forkBlocked} onClick={() => { setActionKey(null); onFork(actionMember.sessionId, actionMember.turn.endId); }}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 12V4m0 5c5 0 6-2 6-5M3 5l2-2 2 2m2 0 2-2 2 2" /></svg>从这里分叉</button>
        </span>
        {!actionOnCurrentPath && <>
          <button type="button" disabled={busy || capturing || !sessionId} onClick={() => void reference(actionCard.key, "answer")}>引用回答</button>
          {!actionMember.turn.active && <button type="button" disabled={busy} onClick={() => { setActionKey(null); onContinue(actionMember.sessionId, actionMember.turn.endId); }}>切换到这条分支</button>}
        </>}
        <button type="button" onClick={() => { onDismissPreview(); setEditingTakeaway(actionCard); setActionKey(null); }}>所得</button>
        <button type="button" title="连接相关的两轮讨论，方便回看对照" onClick={() => beginLink(actionCard.key)}>标记相关</button>
      </div>}
    </div>
    {editingTakeaway && <TakeawayEditor key={editingTakeaway.key} card={editingTakeaway} initial={layout.takeaways?.[editingTakeaway.key]}
      busy={Boolean(sessions.find(session => session.id === editingTakeaway.sessionId)?.running)} onClose={() => setEditingTakeaway(null)}
      onSave={async (value: TurnTakeaway | null) => {
        const allowed = feedbackIntent(worldHost);
        const current = layoutRef.current;
        const takeaways = { ...current.takeaways };
        if (value) takeaways[editingTakeaway.key] = value; else delete takeaways[editingTakeaway.key];
        const saved = { ...current, takeaways, sessionOrigins: sessionOrigins.current, positions: { ...positions.current } };
        if (!await onSaveBoard(saved)) return false;
        layoutRef.current = saved; setLayout(saved);
        if (value?.status === "confirmed") setConfirmation({ key: editingTakeaway.key, allowed });
        return true;
      }} />}
    {inspected && <aside className="waygoal-edge-preview" aria-label="关系来源">
      <header><strong>{inspected.kind === "reference" ? "发送时的引用材料" : inspected.kind === "fork" ? "分叉来源" : inspected.kind === "association" ? "相关讨论" : "连续历史"}</strong><button type="button" onClick={() => setInspected(null)} aria-label="关闭关系预览">×</button></header>
      {inspected.kind === "reference" && graph.edges.filter(edge => edge.kind === "reference" && edge.to === inspected.to).length > 1 && <select aria-label="本轮引用来源" value={inspected.key} onChange={event => { const edge = graph.edges.find(edge => edge.key === event.target.value); if (edge) setInspected(edge); }}>{graph.edges.filter(edge => edge.kind === "reference" && edge.to === inspected.to).map((edge, index) => <option key={edge.key} value={edge.key}>{index + 1} · {title(edge.fromSession)} · {edge.source && MATERIAL_SCOPES[edge.source.scope]}</option>)}</select>}
      {inspected.kind === "association" ? <ul className="waygoal-link-endpoints">{[inspected.from, inspected.to].map(key => <li key={key}>{graph.cards.find(card => card.key === key)?.turn.question || "暂不可读取的讨论"}</li>)}</ul> : <p>{title(inspected.fromSession)} → {title(inspected.toSession)}</p>}
      {inspected.source && <><p>{MATERIAL_SCOPES[inspected.source.scope]}{inspected.source.sharedSnapshot ? " · 旧记录展示本轮全部引用原文" : ""}</p><pre>{inspected.source.snapshot || "这条历史没有保存可读取的材料正文。"}</pre></>}
      {inspected.kind === "association" && <p>这是你手动标记的相关讨论，方便回看对照；不会把内容发给 Agent。</p>}
      <div>{[inspected.from, inspected.to].map((key, index) => <button key={index} type="button" disabled={!graph.cards.some(card => card.key === key)} onClick={() => { const card = byKey.get(key); if (card) { locate(card); focusCard(key, true); } else onExpand(index === 0 ? inspected.fromSession : inspected.toSession); }}>{inspected.kind === "association" ? index === 0 ? "查看第一张卡片" : "查看第二张卡片" : index === 0 ? "查看来源" : "查看使用位置"}</button>)}</div>
      {!graph.cards.some(card => card.key === inspected.from) && <p>来源不在当前画布或已不可读取；已发送的原文仍保留。</p>}
      {inspected.pair && <button type="button" onClick={() => { persistLayout({ ...layout, links: layout.links.filter(([a, b]) => !((a === inspected.pair![0] && b === inspected.pair![1]) || (b === inspected.pair![0] && a === inspected.pair![1]))) }); setInspected(null); setLinkSaved(false); }}>移除关联</button>}
    </aside>}
  </section>;
}
