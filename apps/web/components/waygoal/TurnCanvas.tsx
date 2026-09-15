"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WaygoalTurnLayout } from "@/lib/waygoal/types";
import type { WaygoalTurns, WaygoalTurn } from "@/lib/waygoal/turns";
import { MATERIAL_SCOPES, type MaterialScope, type MaterialSnapshot } from "@/lib/waygoal/materials";

interface Props {
  sessionId: string;
  layouts?: Record<string, WaygoalTurnLayout>;
  onSaveLayout: (sessionId: string, layout: WaygoalTurnLayout) => void;
  sessions: { id: string; title: string }[];
  locateEntry: { entryId: string; serial: number } | null;
  busy: boolean;
  onLocate: (sessionId: string, turn: WaygoalTurn) => void;
  onContinue: (sessionId: string, leafId: string) => void;
  onMaterial: (material: MaterialSnapshot) => void;
  onOverview: () => void;
}

const WIDTH = 278, HEIGHT = 150, GAP = 46;
type Point = { x: number; y: number };
const emptyLayout = (): WaygoalTurnLayout => ({ positions: {}, links: [] });

/** The session tree is a presentation of Pi entries. ChatWindow lives beside
 * this module, and never depends on its selected card, camera or preview. */
export function WaygoalTurnCanvas({ sessionId, layouts, onSaveLayout, sessions, locateEntry, busy, onLocate, onContinue, onMaterial, onOverview }: Props) {
  const [sourceId, setSourceId] = useState(sessionId);
  const [data, setData] = useState<WaygoalTurns | null>(null);
  const [camera, setCamera] = useState({ x: 38, y: 35, scale: 1 });
  const [layout, setLayout] = useState<WaygoalTurnLayout>(emptyLayout);
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<"read" | "reference" | "link">("read");
  const [from, setFrom] = useState<string | null>(null);
  const [scope, setScope] = useState<MaterialScope>("answer");
  const [excerpt, setExcerpt] = useState("");
  const [treeOpen, setTreeOpen] = useState(false);
  const [error, setError] = useState("");
  const [capturing, setCapturing] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ id?: string; start: Point; origin: Point; moved: boolean } | null>(null);
  const layoutRef = useRef(layout); layoutRef.current = layout;
  const incomingLayouts = useRef(layouts); incomingLayouts.current = layouts;
  const persistLayout = (next: WaygoalTurnLayout) => { layoutRef.current = next; setLayout(next); onSaveLayout(sourceId, next); };
  useEffect(() => { setSourceId(sessionId); }, [sessionId]);
  useEffect(() => {
    setLayout(incomingLayouts.current?.[sourceId] ?? emptyLayout());
    setSelected(null); setFrom(null); setCamera({ x: 38, y: 35, scale: 1 });
  }, [sourceId]);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    setData(null); setError("");
    const refresh = async () => {
      try {
        const response = await fetch(`/api/waygoal/session/${encodeURIComponent(sourceId)}/turns`, { signal: controller.signal, cache: "no-store" });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error);
        if (!controller.signal.aborted) setData(body);
      } catch (error) {
        if (!controller.signal.aborted) setError(error instanceof Error ? error.message : String(error));
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(refresh, 1000);
      }
    };
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [sourceId]);

  const cards = useMemo(() => {
    const placed = new Map<string, Point>();
    const childCount = new Map<string | null, number>();
    let lane = 0;
    return (data?.turns ?? []).map(turn => {
      const parent = turn.parentId ? placed.get(turn.parentId) : undefined;
      const siblings = childCount.get(turn.parentId) ?? 0;
      childCount.set(turn.parentId, siblings + 1);
      const position = layout.positions[turn.id] ?? {
        x: parent && siblings === 0 ? parent.x : lane++ * (WIDTH + GAP),
        y: parent ? parent.y + HEIGHT + GAP : 0,
      };
      placed.set(turn.id, position);
      return { ...turn, position };
    });
  }, [data, layout.positions]);
  const focusCard = useCallback((id: string) => {
    const card = cards.find(card => card.id === id || card.entryIds.includes(id));
    const bounds = viewport.current?.getBoundingClientRect();
    if (!card || !bounds) return;
    setSelected(card.id);
    setCamera(camera => ({ ...camera, x: bounds.width / 2 - (card.position.x + WIDTH / 2) * camera.scale, y: bounds.height / 2 - (card.position.y + HEIGHT / 2) * camera.scale }));
  }, [cards]);
  const previousCount = useRef<{ session: string; count: number } | null>(null);
  useEffect(() => {
    if (!data) return;
    const previous = previousCount.current;
    previousCount.current = { session: sourceId, count: cards.length };
    if (previous?.session === sourceId && cards.length > previous.count && sourceId === sessionId) {
      const current = cards.findLast(card => card.active);
      if (current) focusCard(current.id);
    }
  }, [cards, data, focusCard, sessionId, sourceId]);
  const lastLocate = useRef<number | null>(null);
  useEffect(() => {
    if (!locateEntry || lastLocate.current === locateEntry.serial) return;
    if (sourceId !== sessionId) { setSourceId(sessionId); return; }
    if (!cards.some(card => card.entryIds.includes(locateEntry.entryId))) return;
    lastLocate.current = locateEntry.serial;
    focusCard(locateEntry.entryId);
  }, [locateEntry, cards, focusCard, sessionId, sourceId]);

  const reference = async (turnId: string) => {
    if (capturing || busy) return;
    setCapturing(true); setError("");
    try {
      const query = new URLSearchParams({ turn: turnId, target: sessionId, scope, ...(scope === "excerpt" ? { excerpt } : {}) });
      const response = await fetch(`/api/waygoal/session/${encodeURIComponent(sourceId)}/materials?${query}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      onMaterial(body); setFrom(null);
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setCapturing(false); }
  };
  const connect = (to: string) => {
    if (!from || from === to) { setFrom(to); return; }
    const exists = layout.links.some(([a, b]) => (a === from && b === to) || (a === to && b === from));
    persistLayout({ ...layout, links: exists ? layout.links.filter(([a, b]) => !((a === from && b === to) || (a === to && b === from))) : [...layout.links, [from, to]] });
    setFrom(null);
  };
  const active = cards.findLast(card => card.active);
  const next = active ? { x: active.position.x, y: active.position.y + HEIGHT + GAP } : { x: 0, y: 0 };
  const edge = (a: Point, b: Point) => `M ${a.x + WIDTH / 2} ${a.y + HEIGHT} C ${a.x + WIDTH / 2} ${a.y + HEIGHT + GAP / 2}, ${b.x + WIDTH / 2} ${b.y - GAP / 2}, ${b.x + WIDTH / 2} ${b.y}`;
  return <section className="waygoal-turn-canvas" aria-label="轮次画布">
    <div className="waygoal-turn-toolbar">
      <button type="button" onClick={onOverview}>← 总画布</button>
      <select aria-label="查看会话轮次" value={sourceId} onChange={event => setSourceId(event.target.value)}>
        {sessions.map(session => <option key={session.id} value={session.id}>{session.title}</option>)}
      </select>
      <button type="button" aria-expanded={treeOpen} onClick={() => setTreeOpen(!treeOpen)}>Tree</button>
      <button type="button" aria-pressed={mode === "reference"} onClick={() => { setMode(mode === "reference" ? "read" : "reference"); setFrom(null); }}>引用连线</button>
      <button type="button" aria-pressed={mode === "link"} onClick={() => { setMode(mode === "link" ? "read" : "link"); setFrom(null); }}>仅作关联</button>
      <button type="button" onClick={() => active && focusCard(active.id)}>当前轮次</button>
      <button type="button" onClick={() => {
        const bounds = viewport.current?.getBoundingClientRect(); if (!bounds || !cards.length) return;
        const x = Math.min(...cards.map(card => card.position.x)), y = Math.min(...cards.map(card => card.position.y));
        const width = Math.max(...cards.map(card => card.position.x + WIDTH)) - x;
        const height = Math.max(...cards.map(card => card.position.y + HEIGHT)) - y;
        const scale = Math.max(.3, Math.min(1, (bounds.width - 70) / width, (bounds.height - 70) / height));
        setCamera({ scale, x: (bounds.width - width * scale) / 2 - x * scale, y: 35 - y * scale });
      }}>全景</button>
    </div>
    {mode === "reference" && <div className="waygoal-turn-options">
      <select aria-label="引用范围" value={scope} onChange={event => setScope(event.target.value as MaterialScope)}>{Object.entries(MATERIAL_SCOPES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <span>将连线点拖到「下一轮」，或依次点击。文字范围不含图片、思考与工具参数。</span>
      {scope === "excerpt" && <textarea aria-label="回答摘录" value={excerpt} onChange={event => setExcerpt(event.target.value)} placeholder="粘贴回答中的原文摘录" />}
    </div>}
    {mode === "link" && <p className="waygoal-turn-options">依次点击两张卡片的连线点；再次连接同一对可取消。</p>}
    {treeOpen && <nav className="waygoal-turn-tree" aria-label="Tree 路径选择">
      {cards.filter(card => !cards.some(child => child.parentId === card.id)).map((card, index) => <button key={card.id} type="button" disabled={busy} onClick={() => { onContinue(sourceId, card.endId); setTreeOpen(false); }}>路径 {index + 1} · {card.question.slice(0, 40)}{card.active && sourceId === sessionId ? " · 当前" : " · 在此继续"}</button>)}
    </nav>}
    {error && <p role="alert" className="waygoal-turn-error">{error}</p>}
    <div className="waygoal-turn-viewport" ref={viewport} tabIndex={0} aria-label="轮次画布：拖动空白处平移，滚轮缩放"
      onWheel={event => {
        const bounds = event.currentTarget.getBoundingClientRect();
        const x = event.clientX - bounds.left, y = event.clientY - bounds.top;
        setCamera(camera => { const scale = Math.max(.3, Math.min(1.5, camera.scale * (event.deltaY > 0 ? .92 : 1.08))); return { x: x - (x - camera.x) * scale / camera.scale, y: y - (y - camera.y) * scale / camera.scale, scale }; });
      }}
      onPointerDown={event => { if (event.target !== event.currentTarget) return; gesture.current = { start: { x: event.clientX, y: event.clientY }, origin: camera, moved: false }; event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={event => {
        const drag = gesture.current; if (!drag) return;
        const dx = event.clientX - drag.start.x, dy = event.clientY - drag.start.y;
        drag.moved ||= Math.abs(dx) + Math.abs(dy) > 4;
        if (drag.id) setLayout(layout => ({ ...layout, positions: { ...layout.positions, [drag.id!]: { x: drag.origin.x + dx / camera.scale, y: drag.origin.y + dy / camera.scale } } }));
        else setCamera(camera => ({ ...camera, x: drag.origin.x + dx, y: drag.origin.y + dy }));
      }}
      onPointerUp={() => { if (gesture.current?.id && gesture.current.moved) onSaveLayout(sourceId, layoutRef.current); requestAnimationFrame(() => { gesture.current = null; }); }} onPointerCancel={() => { gesture.current = null; }}>
      <div className="waygoal-turn-world" style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})` }}>
        <svg className="waygoal-turn-lines" width="1" height="1" aria-hidden="true">
          {cards.map(card => { const parent = cards.find(parent => parent.id === card.parentId); return parent ? <path key={card.id} d={edge(parent.position, card.position)} className={card.active ? "active" : ""} /> : null; })}
          {layout.links.map(([a, b]) => { const from = cards.find(card => card.id === a), to = cards.find(card => card.id === b); return from && to ? <path key={`${a}:${b}`} d={edge(from.position, to.position)} className="association" /> : null; })}
          {cards.flatMap(card => card.sources.filter(source => source.sessionId === sourceId).map(source => { const from = cards.find(card => card.id === source.turnId); return from ? <path key={`ref:${card.id}:${source.turnId}`} d={edge(from.position, card.position)} className="reference" /> : null; }))}
          {from && mode === "reference" && cards.find(card => card.id === from) && <path className="reference pending" d={edge(cards.find(card => card.id === from)!.position, next)} />}
        </svg>
        {cards.map((card, index) => <article key={card.id} data-turn={card.id} className={`waygoal-turn-card${card.active ? " active" : ""}${selected === card.id ? " selected" : ""}`} style={{ left: card.position.x, top: card.position.y, width: WIDTH, height: HEIGHT }}>
          <button type="button" className="waygoal-turn-content" aria-label={`${index + 1} · ${card.question}`} aria-pressed={selected === card.id}
            onPointerDown={event => { gesture.current = { id: card.id, start: { x: event.clientX, y: event.clientY }, origin: card.position, moved: false }; event.currentTarget.setPointerCapture(event.pointerId); }}
            onClick={() => { if (gesture.current?.moved) return; setSelected(card.id); onLocate(sourceId, card); }}>
            <span className="waygoal-turn-number">{String(index + 1).padStart(2, "0")}</span>
            <strong>{card.question || "图片消息"}</strong><p>{card.answer || (card.active && busy ? "正在回复…" : "…")}</p>
          </button>
          {mode !== "read" && <button type="button" className={`waygoal-turn-port${from === card.id ? " selected" : ""}`} aria-label={`从 ${index + 1} 连线`} draggable
            onDragStart={event => { event.dataTransfer.setData("text/plain", card.id); setFrom(card.id); }}
            onClick={() => mode === "link" ? connect(card.id) : setFrom(card.id)}>●</button>}
        </article>)}
        {sourceId === sessionId && <button type="button" className="waygoal-next-turn" data-next-turn style={{ left: next.x, top: next.y, width: WIDTH }}
          disabled={busy || capturing || mode !== "reference" || !from}
          onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); const id = event.dataTransfer.getData("text/plain"); if (mode === "reference" && cards.some(card => card.id === id)) void reference(id); }}
          onClick={() => from && void reference(from)}>下一轮{capturing ? " · 正在读取材料…" : " · 在右侧继续聊"}</button>}
      </div>
    </div>
    {sourceId !== sessionId && mode === "reference" && <button type="button" className="waygoal-next-turn-external" disabled={!from || busy || capturing} onClick={() => from && void reference(from)}>连到当前对话的下一轮</button>}
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
