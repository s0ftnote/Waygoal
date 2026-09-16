"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type Dispatch, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import { expandedTurns, type SessionSize } from "@/lib/waygoal/session-expansion";
import type { WaygoalView, WaygoalPoint, WaygoalTurnLayout } from "@/lib/waygoal/types";
import type { WaygoalTurns, WaygoalTurn } from "@/lib/waygoal/turns";
import { MATERIAL_SCOPES, type MaterialScope, type MaterialSnapshot } from "@/lib/waygoal/materials";
import { projectTurnBoard, turnKey, TURN_WIDTH as WIDTH, TURN_HEIGHT as HEIGHT, TURN_GAP as GAP, type BoardCard, type BoardEdge, type BoardSession } from "@/lib/waygoal/turn-board";

interface Props {
  sessionId: string;
  targetVersion: number;
  board?: WaygoalTurnLayout;
  layouts?: Record<string, WaygoalTurnLayout>;
  onSaveBoard: (layout: WaygoalTurnLayout) => void;
  sessions: (BoardSession & { position: WaygoalPoint })[];
  expanded: string[];
  worldHost: HTMLDivElement | null;
  camera: WaygoalView;
  setCamera: Dispatch<SetStateAction<WaygoalView>>;
  onExpand: (id: string) => void;
  onGeometry: (sizes: Record<string, SessionSize>, cards: BoardCard[], edges: BoardEdge[]) => void;
  onFit: () => void;
  locateEntry: { entryId: string; serial: number } | null;
  inspectEntry: { entryId: string; serial: number } | null;
  materials: MaterialSnapshot[];
  busy: boolean;
  onLocate: (sessionId: string, turn: WaygoalTurn) => void;
  onContinue: (sessionId: string, leafId: string) => void;
  onOpenSession: (sessionId: string) => void;
  onDismissPreview: () => void;
  onMaterial: (material: MaterialSnapshot) => void;
  onReady: (sessionId: string) => void;
  onOverview: () => void;
  onFork: (sessionId: string, entryId: string) => void;
}
type Point = { x: number; y: number };

/** This board owns viewing/layout only. The persistent ChatWindow beside it
 * owns the continuation; neither selecting a card nor reading an edge moves it. */
export function WaygoalTurnCanvas({ sessionId, targetVersion, board, layouts, onSaveBoard, sessions, locateEntry, inspectEntry, materials, busy, onLocate, onContinue, onOpenSession, onDismissPreview, onMaterial, onOverview, onFork, onReady, expanded, worldHost, camera, setCamera, onGeometry, onExpand, onFit }: Props) {
  const [actionKey, setActionKey] = useState<string | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const toolsMenu = useRef<HTMLDetailsElement>(null);
  const [sourceId, setSourceId] = useState(sessionId);
  const [data, setData] = useState<Record<string, WaygoalTurns>>({});
  const [readErrors, setReadErrors] = useState<Record<string, string>>({});
  const [layout, setLayout] = useState<WaygoalTurnLayout>(() => board ?? { positions: {}, links: Object.entries(layouts ?? {}).flatMap(([sid, saved]) => saved.links.map(([a, b]): [string, string] => [turnKey(sid, a), turnKey(sid, b)])) });
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<"read" | "reference" | "link">("read");
  const [from, setFrom] = useState<string | null>(null);
  const [scope, setScope] = useState<MaterialScope>("answer");
  const [excerpt, setExcerpt] = useState("");
  const [treeOpen, setTreeOpen] = useState(false);
  const [inspected, setInspected] = useState<BoardEdge | null>(null);
  const [error, setError] = useState("");
  const [capturing, setCapturing] = useState(false);
  const captureRequest = useRef<AbortController | null>(null);
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
      setActionKey(null); setTreeOpen(false); setMode("read"); setFrom(null); setInspected(null);
      if (toolsMenu.current) toolsMenu.current.open = false;
    };
    window.addEventListener("keydown", dismiss);
    return () => window.removeEventListener("keydown", dismiss);
  }, []);
  const gesture = useRef<{ id?: string; start: Point; origin: Point; moved: boolean } | null>(null);
  const layoutRef = useRef(layout); layoutRef.current = layout;
  const positions = useRef<Record<string, Point>>({});
  const sessionIds = JSON.stringify(sessions.map(session => session.id).sort());
  useEffect(() => {
    captureRequest.current?.abort(); setCapturing(false);
    return () => captureRequest.current?.abort();
  }, [sessionId, targetVersion, busy]);
  useEffect(() => { setSourceId(sessionId); setInspected(null); setFrom(null); setActionKey(null); }, [sessionId]);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const ids = JSON.parse(sessionIds) as string[];
    const refresh = async () => {
      const loaded: Record<string, WaygoalTurns> = {};
      const failed: Record<string, string> = {};
      // Bound concurrent reads and pause background polling. No AgentSession is
      // created by these endpoints; failed sources remain visibly marked stale.
      for (let offset = 0; offset < ids.length && !controller.signal.aborted; offset += 4) {
        await Promise.all(ids.slice(offset, offset + 4).map(async id => {
          try {
            const response = await fetch(`/api/waygoal/session/${encodeURIComponent(id)}/turns`, { signal: controller.signal, cache: "no-store" });
            const body = await response.json();
            if (!response.ok) throw new Error(body.error);
            loaded[id] = body;
          } catch (error) { failed[id] = error instanceof Error ? error.message : String(error); }
        }));
      }
      if (!controller.signal.aborted) {
        setData(current => ({ ...current, ...loaded })); setReadErrors(failed);
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
    layoutRef.current = saved; setLayout(saved); onSaveBoard(saved);
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
    if (!expanded.includes(sessionId)) { onExpand(sessionId); return; }
    const card = cards.find(card => card.members.some(member => member.sessionId === sessionId && member.turn.entryIds.includes(locateEntry.entryId)));
    if (!card) return;
    lastLocate.current = locateEntry.serial; setInspected(null); focusCard(card.key, true);
  }, [locateEntry, cards, focusCard, sessionId, expanded, onExpand]);
  const lastInspect = useRef<number | null>(null);
  useEffect(() => {
    if (!inspectEntry || lastInspect.current === inspectEntry.serial) return;
    const turn = data[sessionId]?.turns.find(turn => turn.entryIds.includes(inspectEntry.entryId));
    const edge = turn && graph.edges.find(edge => edge.kind === "reference" && edge.to === graph.aliases.get(turnKey(sessionId, turn.id)));
    if (!edge) return;
    lastInspect.current = inspectEntry.serial; setInspected(edge);
  }, [inspectEntry, data, graph, sessionId]);

  const reference = async (key: string, selectedScope = scope) => {
    const card = byKey.get(key);
    if (!card || capturing || busy) return;
    const member = memberFor(card);
    if (readErrors[member.sessionId]) { setError("来源读取失败，请等待恢复后重新选择材料。"); return; }
    const controller = new AbortController(); captureRequest.current = controller;
    setCapturing(true); setError("");
    try {
      const query = new URLSearchParams({ turn: member.turn.id, target: sessionId, scope: selectedScope, ...(selectedScope === "excerpt" ? { excerpt } : {}) });
      const response = await fetch(`/api/waygoal/session/${encodeURIComponent(member.sessionId)}/materials?${query}`, { cache: "no-store", signal: controller.signal });
      const body = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok) throw new Error(body.error);
      onMaterial(body); setFrom(null); setActionKey(null); onDismissPreview();
    } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : String(error)); }
    finally { if (captureRequest.current === controller) setCapturing(false); }
  };
  const connect = (to: string) => {
    if (!from || from === to) { setFrom(to); return; }
    const exists = layout.links.some(([a, b]) => (a === from && b === to) || (a === to && b === from));
    persistLayout({ ...layout, links: exists ? layout.links.filter(([a, b]) => !((a === from && b === to) || (a === to && b === from))) : [...layout.links, [from, to]] }); setFrom(null);
  };
  const edgePath = (a: Point, b: Point, side = false) => {
    if (side) { const right = b.x > a.x, start = a.x + (right ? WIDTH : 0), end = b.x + (right ? 0 : WIDTH), bend = Math.max(60, Math.abs(end - start) / 2) * (right ? 1 : -1); return `M ${start} ${a.y + HEIGHT / 2} C ${start + bend} ${a.y + HEIGHT / 2}, ${end - bend} ${b.y + HEIGHT / 2}, ${end} ${b.y + HEIGHT / 2}`; }
    return `M ${a.x + WIDTH / 2} ${a.y + HEIGHT} C ${a.x + WIDTH / 2} ${a.y + HEIGHT + GAP / 2}, ${b.x + WIDTH / 2} ${b.y - GAP / 2}, ${b.x + WIDTH / 2} ${b.y}`;
  };
  const locate = (card: BoardCard) => { setInspected(null); setSelected(card.key); setActionKey(card.key); const member = memberFor(card); onLocate(member.sessionId, member.turn); };
  const inspect = (edge: BoardEdge) => { onDismissPreview(); setInspected(edge); };
  const actionCard = actionKey ? byKey.get(actionKey) : undefined;
  const actionMember = actionCard && memberFor(actionCard);
  const actionOnCurrentPath = actionMember?.sessionId === sessionId && actionMember.turn.active;
  const forkBlocked = busy || Boolean(sessions.find(session => session.id === actionMember?.sessionId)?.running);
  const menuWidth = Math.min(actionOnCurrentPath ? 172 : 332, viewportSize.width - 16);
  const actionBounds = actionCard ? {
    left: camera.x + actionCard.position.x * camera.scale,
    top: camera.y + actionCard.position.y * camera.scale,
    right: camera.x + (actionCard.position.x + WIDTH) * camera.scale,
    bottom: camera.y + (actionCard.position.y + HEIGHT) * camera.scale,
  } : null;
  const menuTop = actionBounds && (actionBounds.bottom + 66 < viewportSize.height - 66 ? actionBounds.bottom + 8 : actionBounds.top - 60);
  const showActions = actionBounds && menuTop !== null && menuTop >= 0 && menuTop < viewportSize.height - 60
    && actionBounds.right > 0 && actionBounds.left < viewportSize.width && actionBounds.bottom > 0 && actionBounds.top < viewportSize.height;
  return <section className="waygoal-turn-canvas waygoal-turn-embedded" aria-label="轮次画布">
    <div className="waygoal-turn-toolbar">
      <button type="button" aria-label="当前轮次" onClick={() => { setActionKey(null); if (active) focusCard(active.key, true); else if (sessionId) { pendingFocus.current = activeKey ?? null; onExpand(sessionId); } }}>◎ 回到正在聊的位置</button>
      <button type="button" aria-label="全景" onClick={() => { setActionKey(null); onFit(); }}>看全局</button>
      <details className="waygoal-turn-more" ref={toolsMenu}>
        <summary aria-label="画布操作">•••</summary>
        <div className="waygoal-turn-more-body">
      <button type="button" onClick={() => { onOverview(); if (toolsMenu.current) toolsMenu.current.open = false; }}>整理会话与票据</button>
      <select aria-label="查看会话轮次" value={sourceId} onChange={event => {
        const id = event.target.value; setSourceId(id); onExpand(id);
        const last = data[id]?.turns.findLast(turn => turn.active);
        const key = last && graph.aliases.get(turnKey(id, last.id)); if (key) { pendingFocus.current = key; if (byKey.has(key)) { focusCard(key, true); pendingFocus.current = null; } }
      }}>{sessions.map(session => <option key={session.id} value={session.id}>{session.title}</option>)}</select>
      <button type="button" aria-expanded={treeOpen} onClick={() => { setTreeOpen(!treeOpen); if (toolsMenu.current) toolsMenu.current.open = false; }}>选择继续路径</button>
      <button type="button" aria-pressed={mode === "reference"} onClick={() => { setMode(mode === "reference" ? "read" : "reference"); setFrom(null); }}>引用连线</button>
      <button type="button" aria-pressed={mode === "link"} onClick={() => { setMode(mode === "link" ? "read" : "link"); setFrom(null); }}>仅作关联</button>
        </div>
      </details>
    </div>
    {mode === "reference" && <div className="waygoal-turn-options">
      <select aria-label="引用范围" value={scope} onChange={event => setScope(event.target.value as MaterialScope)}>{Object.entries(MATERIAL_SCOPES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <span>将来源连到当前对话的「下一轮」。文字范围不含图片、思考与工具参数。</span>
      {scope === "excerpt" && <textarea aria-label="回答摘录" value={excerpt} onChange={event => setExcerpt(event.target.value)} placeholder="粘贴回答中的原文摘录" />}
    </div>}
    {mode === "link" && <p className="waygoal-turn-options">依次点击两张卡片的连线点；再次连接同一对可取消。只作关联，不带入模型。</p>}
    {treeOpen && <nav className="waygoal-turn-tree" aria-label="Tree 路径选择">
      <strong>{title(sourceId)}</strong>
      {(data[sourceId]?.turns ?? []).filter(turn => !data[sourceId]?.turns.some(child => child.parentId === turn.id)).map((turn, index) => <button key={turn.id} type="button" disabled={busy || !!readErrors[sourceId] || sessions.find(s => s.id === sourceId)?.running} onClick={() => { onContinue(sourceId, turn.endId); setTreeOpen(false); }}>路径 {index + 1} · {turn.question.slice(0, 40)}{turn.active && sourceId === sessionId ? " · 当前" : " · 在此继续"}</button>)}
      {data[sourceId]?.turns.length === 0 && <button type="button" disabled={busy} onClick={() => { onOpenSession(sourceId); setTreeOpen(false); }}>在这段会话继续</button>}
    </nav>}
    {(error || Object.keys(readErrors).length > 0) && <p role="alert" className="waygoal-turn-error">{error || Object.keys(readErrors).map(id => `${title(id)} 读取失败，保留上次画面。`).join(" ")}</p>}
    <div className="waygoal-turn-viewport" ref={viewport} tabIndex={0} aria-label="轮次画布：拖动空白处平移，滚轮缩放"
      onPointerDown={event => { if (event.target !== event.currentTarget) return; setActionKey(null); if (toolsMenu.current) toolsMenu.current.open = false; gesture.current = { start: { x: event.clientX, y: event.clientY }, origin: camera, moved: false }; event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={event => { const drag = gesture.current; if (!drag) return; const dx = event.clientX - drag.start.x, dy = event.clientY - drag.start.y; drag.moved ||= Math.abs(dx) + Math.abs(dy) > 4; if (drag.id) setLayout(layout => ({ ...layout, positions: { ...layout.positions, [drag.id!]: { x: drag.origin.x + dx / camera.scale, y: drag.origin.y + dy / camera.scale } } })); else setCamera(camera => ({ ...camera, x: drag.origin.x + dx, y: drag.origin.y + dy })); }}
      onPointerUp={() => { if (gesture.current?.id && gesture.current.moved) persistLayout(layoutRef.current); requestAnimationFrame(() => { gesture.current = null; }); }} onPointerCancel={() => { gesture.current = null; }}>
      {worldHost && createPortal(<div className="waygoal-turn-world" style={{ "--turn-scale": camera.scale } as CSSProperties}>
        <svg className="waygoal-turn-lines" width="1" height="1">
          {graph.edges.map(edge => { const a = byKey.get(edge.from), b = byKey.get(edge.to); if (edge.kind === "history" && (!a || !b) || edge.kind === "fork" && !a && !b) return null; const from = a?.position ?? sessions.find(session => session.id === edge.fromSession)?.position, to = b?.position ?? sessions.find(session => session.id === edge.toSession)?.position; if (!from || !to) return null; const path = edgePath(from, to, edge.kind === "reference" || edge.kind === "association"); return <g key={edge.key}><path d={path} className={edge.kind} /><path d={path} className="edge-hit" role="button" tabIndex={0} aria-label={`${edge.kind === "reference" ? "引用材料" : edge.kind === "fork" ? "分叉来源" : edge.kind === "association" ? "手动关联" : "连续历史"}：${title(edge.fromSession)} → ${title(edge.toSession)}`} onClick={() => inspect(edge)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); inspect(edge); } }} /></g>; })}
          {materials.map(material => { const key = graph.aliases.get(turnKey(material.sessionId, material.turnId)), card = key && byKey.get(key); return card ? <path key={`${material.sessionId}:${material.turnId}`} className="reference pending" d={edgePath(card.position, next, true)} /> : null; })}
          {from && mode === "reference" && byKey.has(from) && <path className="reference pending" d={edgePath(byKey.get(from)!.position, next, true)} />}
        </svg>
        {cards.map((card, index) => <article key={card.key} data-turn={card.turn.id} data-session={card.sessionId} data-turn-key={card.key} className={`waygoal-turn-card${activeKey === card.key ? " active" : ""}${selected === card.key ? " selected" : ""}`} style={{ left: card.position.x, top: card.position.y, width: WIDTH, height: HEIGHT }}>
          <button type="button" className="waygoal-turn-content" aria-label={`${index + 1} · ${card.turn.question}`} aria-pressed={selected === card.key}
            onPointerDown={event => { setActionKey(null); gesture.current = { id: card.key, start: { x: event.clientX, y: event.clientY }, origin: positions.current[card.key] ?? card.position, moved: false }; event.currentTarget.setPointerCapture(event.pointerId); }}
            onClick={() => { if (!gesture.current?.moved) locate(card); }}><span className="waygoal-turn-number">{String(index + 1).padStart(2, "0")}</span><strong>{card.turn.question || "图片消息"}</strong><p>{card.turn.answer || (activeKey === card.key && busy ? "正在回复…" : "…")}</p></button>
          {mode !== "read" && <button type="button" className={`waygoal-turn-port${from === card.key ? " selected" : ""}`} aria-label={`从 ${index + 1} 连线`} draggable
            onDragStart={event => { event.dataTransfer.setData("text/plain", card.key); setFrom(card.key); }}
            onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); const source = event.dataTransfer.getData("text/plain"); if (mode === "link" && byKey.has(source) && source !== card.key) { persistLayout({ ...layout, links: [...layout.links.filter(([a, b]) => !((a === source && b === card.key) || (b === source && a === card.key))), [source, card.key]] }); setFrom(null); } }}
            onClick={() => mode === "link" ? connect(card.key) : setFrom(card.key)}>●</button>}
        </article>)}
        {active && <button type="button" className="waygoal-next-turn" data-next-turn style={{ left: next.x, top: next.y, width: WIDTH }} disabled={busy || capturing || mode !== "reference" || !from}
          onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); const key = event.dataTransfer.getData("text/plain"); if (mode === "reference") void reference(key); }} onClick={() => from && void reference(from)}>下一轮{capturing ? " · 正在读取材料…" : materials.length ? ` · 带入 ${materials.length} 份材料` : " · 在右侧继续聊"}</button>}
      </div>, worldHost)}
      {showActions && actionCard && actionMember && <div className="waygoal-turn-actions" role="group" aria-label="所选卡片操作"
        style={{ left: Math.max(8, Math.min((actionBounds!.left + actionBounds!.right - menuWidth) / 2, viewportSize.width - menuWidth - 8)), top: menuTop!, width: menuWidth }}>
        <span title={forkBlocked ? "等待当前操作或回复结束后，即可从这里分叉" : "从这轮对话开始一条新分支"}>
          <button type="button" disabled={forkBlocked} onClick={() => { setActionKey(null); onFork(actionMember.sessionId, actionMember.turn.endId); }}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 12V4m0 5c5 0 6-2 6-5M3 5l2-2 2 2m2 0 2-2 2 2" /></svg>从这里分叉</button>
        </span>
        {!actionOnCurrentPath && <>
          <button type="button" disabled={busy || capturing || !sessionId} onClick={() => void reference(actionCard.key, "answer")}>引用回答</button>
          <button type="button" disabled={busy} onClick={() => { setActionKey(null); onContinue(actionMember.sessionId, actionMember.turn.endId); }}>在此继续</button>
        </>}
        <button type="button" aria-label="关联其他卡片" onClick={() => { setMode("link"); setFrom(actionCard.key); setActionKey(null); }}>关联</button>
      </div>}
    </div>
    <details className="waygoal-turn-legend-wrap"><summary>连线说明</summary><div className="waygoal-turn-legend"><span>— 连续历史</span><span>━ 分叉来源</span><span>┄ 引用材料</span><span>┈ 仅作关联</span></div></details>
    {inspected && <aside className="waygoal-edge-preview" aria-label="关系来源">
      <header><strong>{inspected.kind === "reference" ? "发送时的引用材料" : inspected.kind === "fork" ? "分叉来源" : inspected.kind === "association" ? "仅作关联" : "连续历史"}</strong><button type="button" onClick={() => setInspected(null)} aria-label="关闭关系预览">×</button></header>
      {inspected.kind === "reference" && graph.edges.filter(edge => edge.kind === "reference" && edge.to === inspected.to).length > 1 && <select aria-label="本轮引用来源" value={inspected.key} onChange={event => { const edge = graph.edges.find(edge => edge.key === event.target.value); if (edge) setInspected(edge); }}>{graph.edges.filter(edge => edge.kind === "reference" && edge.to === inspected.to).map((edge, index) => <option key={edge.key} value={edge.key}>{index + 1} · {title(edge.fromSession)} · {edge.source && MATERIAL_SCOPES[edge.source.scope]}</option>)}</select>}
      <p>{title(inspected.fromSession)} → {title(inspected.toSession)}</p>
      {inspected.source && <><p>{MATERIAL_SCOPES[inspected.source.scope]}{inspected.source.sharedSnapshot ? " · 旧记录展示本轮全部引用原文" : ""}</p><pre>{inspected.source.snapshot || "这条历史没有保存可读取的材料正文。"}</pre></>}
      {inspected.kind === "association" && <p>这条联系只作整理，不影响下一轮输入。</p>}
      <div>{[inspected.from, inspected.to].map((key, index) => <button key={index} type="button" disabled={!graph.cards.some(card => card.key === key)} onClick={() => { const card = byKey.get(key); if (card) { locate(card); focusCard(key, true); } else onExpand(index === 0 ? inspected.fromSession : inspected.toSession); }}>{index === 0 ? "查看来源" : "查看使用位置"}</button>)}</div>
      {!graph.cards.some(card => card.key === inspected.from) && <p>来源不在当前画布或已不可读取；已发送的原文仍保留。</p>}
      {inspected.pair && <button type="button" onClick={() => { persistLayout({ ...layout, links: layout.links.filter(([a, b]) => !((a === inspected.pair![0] && b === inspected.pair![1]) || (b === inspected.pair![0] && a === inspected.pair![1]))) }); setInspected(null); }}>取消关联</button>}
    </aside>}
  </section>;
}
export function WaygoalMaterialTray({ materials, onRemove }: { materials: MaterialSnapshot[]; onRemove: (index: number) => void }) {
  if (!materials.length) return null;
  return <div className="waygoal-material-tray" aria-label="下一轮引用材料">
    <strong>下一轮引用 · 发送时带入以下原文</strong>
    {materials.map((material, index) => <details key={`${material.sessionId}:${material.turnId}:${index}`}>
      <summary>{MATERIAL_SCOPES[material.scope]} · {material.parts.length} 条文字 <button type="button" onClick={event => { event.preventDefault(); onRemove(index); }} aria-label={`移除材料 ${index + 1}`}>×</button></summary>
      <p>来源：{material.sessionId} / {material.turnId} · {material.capturedAt}</p>
      {material.parts.map(part => <pre key={part.entryId}>{part.text}</pre>)}
    </details>)}
  </div>;
}
