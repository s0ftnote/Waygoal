"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BeaconSnapshot, BeaconTicket } from "@/lib/beacon-types";
import type { SessionInfo } from "@/lib/types";
import { ChatWindow } from "./ChatWindow";
import { FileViewer } from "./FileViewer";

type Point = { x: number; y: number };
const labels: Record<string, string> = { grilling: "一起想清楚", research: "查证", prototype: "做个样子", task: "准备" };
const stateLabel = (t: BeaconTicket) => t.status === "resolved" ? "已找到答案" : t.blocked ? "等待前面的答案" : t.running ? "正在探索" : t.status === "claimed" ? "等你继续" : "可以从这里出发";
export function BeaconCanvas() {
  const [data, setData] = useState<BeaconSnapshot | null>(null);
  const [cwd, setCwd] = useState("");
  const [directory, setDirectory] = useState("");
  const [mapId, setMapId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [selected, setSelected] = useState("");
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [running, setRunning] = useState(false);
  const [file, setFile] = useState<string | null>(null);
  const [idea, setIdea] = useState("");
  const [view, setView] = useState({ x: 60, y: 70, scale: 0.85 });
  const [positions, setPositions] = useState<Record<string, Point>>({});
  const drag = useRef<{ id?: string; start: Point; origin: Point; moved: boolean } | null>(null);
  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/beacon${cwd ? `?cwd=${encodeURIComponent(cwd)}` : ""}`, { cache: "no-store" });
      const next = await res.json();
      if (!res.ok) throw new Error(next.error);
      setData(next);
      if (!cwd) { setCwd(next.cwd); setDirectory(next.cwd); }
    } catch (e) { setError(String(e)); }
  }, [cwd]);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 2500);
    window.addEventListener("focus", refresh);
    return () => { clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [refresh]);
  useEffect(() => {
    if (!session) return;
    const source = new EventSource(`/api/agent/${session.id}/events`);
    source.onmessage = event => {
      try { const e = JSON.parse(event.data); if (e.type === "entry_appended" || e.type === "agent_end") void refresh(); } catch { /* heartbeat */ }
    };
    return () => source.close();
  }, [session, refresh]);
  const map = data?.maps.find(m => m.id === mapId) ?? data?.maps[0];
  const positionKey = `beacon:positions:${cwd}:${map?.id ?? ""}`;
  useEffect(() => {
    try { setPositions(JSON.parse(localStorage.getItem(positionKey) || "{}")); } catch { setPositions({}); }
  }, [positionKey]);
  const nodes = useMemo(() => {
    const tickets = map?.tickets ?? [];
    const depth = (t: BeaconTicket, seen = new Set<string>()): number => {
      if (seen.has(t.id)) return 1;
      const next = new Set(seen).add(t.id);
      return 1 + Math.max(0, ...t.blockers.map(n => tickets.find(p => String(Number(p.number)) === n)).filter((p): p is BeaconTicket => Boolean(p)).map(p => depth(p, next)));
    };
    const rows: Record<number, number> = {};
    return tickets.map(t => {
      const level = depth(t); const row = rows[level] ?? 0; rows[level] = row + 1;
      return { ...t, point: positions[t.id] ?? { x: level * 350, y: row * 225 } };
    });
  }, [map, positions]);
  const activeTicket = map?.tickets.find(t => t.id === selected);
  async function openTicket(ticket?: BeaconTicket) {
    if (busy || !data) return;
    setSelected(ticket?.id ?? "origin"); setFile(null); setSession(null); setError("");
    setView({ x: 30, y: 65, scale: 0.58 });
    if (ticket && ((ticket.blocked || ticket.status === "resolved") && !ticket.binding)) return;
    setBusy(ticket?.id ?? "origin");
    try {
      const res = await fetch("/api/beacon", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: ticket ? "open" : "start", cwd: data.cwd, mapId: map?.id, ticketId: ticket?.id, idea }) });
      const result = await res.json(); if (!res.ok) throw new Error(result.error);
      setSession(result.session); setRunning(result.running); await refresh();
    } catch (e) { setError(String(e)); } finally { setBusy(""); }
  }
  const rootPoint = positions.root ?? { x: 0, y: 40 };
  return <main className="beacon-app">
    <header className="beacon-top"><div className="beacon-brand"><span>▣</span> BEACON <small>把模糊的想法，一点点走清楚</small></div><div className="beacon-meta">Pi × Wayfinder <span>接入实验</span> gpt-5.6-luna</div></header>
    <form className="beacon-directory" onSubmit={e => { e.preventDefault(); setCwd(directory); setSession(null); setSelected(""); setMapId(""); }}>
      <label htmlFor="cwd">工作目录</label><input id="cwd" value={directory} onChange={e => setDirectory(e.target.value)} /><button>切换</button><a href="/" target="_blank">Pi 原始界面 ↗</a>
    </form>
    {error && <div role="alert" className="beacon-error">{error}</div>}
    <div className="beacon-workspace">
      <section className="beacon-map-area">
        <div className="beacon-map-heading"><div><span className="beacon-eyebrow">你的方向</span><h1>{map?.title ?? "一个想法，从哪里开始？"}</h1></div>{data && data.maps.length > 1 && <select value={map?.id} onChange={e => { setMapId(e.target.value); setSession(null); setSelected(""); }}>{data.maps.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}</select>}</div>
        {map?.warnings.map(w => <div className="beacon-error" role="alert" key={w}>{w}</div>)}
        {!map ? <div className="beacon-empty"><p>先说说脑子里那个还没有形状的想法。我们一起找到方向，再让地图长出来。</p><textarea aria-label="你的想法" value={idea} onChange={e => setIdea(e.target.value)} placeholder="我想……但还没想清楚……" /><button disabled={Boolean(busy) || (!idea.trim() && !data?.origin)} onClick={() => void openTicket()}>{data?.origin ? "继续找方向 →" : "开始聊聊 →"}</button></div> : <>
        <div className="beacon-viewport" aria-label="想法地图" onWheel={e => setView(v => ({ ...v, scale: Math.min(1.5, Math.max(0.3, v.scale * (e.deltaY > 0 ? 0.92 : 1.08))) }))}
          onPointerDown={e => { if ((e.target as HTMLElement).closest("button")) return; e.currentTarget.setPointerCapture(e.pointerId); drag.current = { start: { x: e.clientX, y: e.clientY }, origin: { x: view.x, y: view.y }, moved: false }; }}
          onPointerMove={e => { const d = drag.current; if (!d) return; const dx = e.clientX - d.start.x, dy = e.clientY - d.start.y; if (Math.abs(dx) + Math.abs(dy) > 5) d.moved = true; if (d.id) setPositions(p => ({ ...p, [d.id!]: { x: d.origin.x + dx / view.scale, y: d.origin.y + dy / view.scale } })); else setView(v => ({ ...v, x: d.origin.x + dx, y: d.origin.y + dy })); }}
          onPointerUp={() => { if (drag.current?.id) localStorage.setItem(positionKey, JSON.stringify(positions)); setTimeout(() => { drag.current = null; }, 0); }}>
          <div className="beacon-world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}>
            <svg className="beacon-lines">{nodes.flatMap(node => {
              const parents = node.blockers.length ? nodes.filter(n => node.blockers.includes(String(Number(n.number)))).map(n => n.point) : [rootPoint];
              return parents.map((p, i) => <path key={`${node.id}:${i}`} d={`M ${p.x + 275} ${p.y + 75} C ${p.x + 320} ${p.y + 75}, ${node.point.x - 45} ${node.point.y + 75}, ${node.point.x} ${node.point.y + 75}`} className={node.blockers.length ? "dependency" : "origin"} />);
            })}</svg>
            <article className="beacon-root" style={{ left: rootPoint.x, top: rootPoint.y }}><span className="beacon-eyebrow">想去的地方</span><h2>{map.title}</h2><p>{map.destination}</p><button onClick={() => setFile(`${cwd}/${map.id}`)}>读地图 ↗</button>{data?.origin && <button onClick={() => void openTicket()}>回到最初的对话</button>}</article>
            {nodes.map(node => <button key={node.id} data-ticket={node.number} className={`beacon-node ${node.status === "resolved" ? "resolved" : node.blocked ? "blocked" : "ready"} ${selected === node.id ? "selected" : ""}`} style={{ left: node.point.x, top: node.point.y }}
              onPointerDown={e => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); drag.current = { id: node.id, start: { x: e.clientX, y: e.clientY }, origin: node.point, moved: false }; }}
              onClick={() => { if (!drag.current?.moved) void openTicket(node); }}>
              <span className="beacon-node-kind">{labels[node.type] ?? node.type}<span>#{node.number}</span></span><h2>{node.title}</h2><p>{node.answer || node.question}</p><span className="beacon-node-state">{busy === node.id ? "正在接入 Pi…" : stateLabel(node)}<span>{node.binding ? "继续 ↗" : "→"}</span></span>
            </button>)}
          </div>
        </div>
        <div className="beacon-map-footer"><span>拖动画布或节点 · 滚轮缩放</span><div><button onClick={() => setView({ x: 35, y: 35, scale: session ? 0.6 : 0.85 })}>回到全景</button><span>{Math.round(view.scale * 100)}%</span></div></div>
        {map.fog && <aside className="beacon-fog"><span>还在雾中</span><p>{map.fog}</p></aside>}
        </>}
      </section>
      {(selected || file) && <aside className="beacon-conversation">
        <div className="beacon-conversation-title"><div><span className="beacon-eyebrow">{file ? "地图与成果" : "你在这里"}</span><strong>{file ? file.split("/").at(-1) : activeTicket?.title ?? "为这个想法找方向"}</strong></div><button aria-label="关闭对话" onClick={() => { if (file) setFile(null); else { setSelected(""); setSession(null); } }}>×</button></div>
        {file ? <FileViewer filePath={file} cwd={cwd} sourceSessionId={session?.id} onOpenFile={setFile} initialDisplayMode="preview" /> : session ? <ChatWindow key={session.id} session={session} sessionRunning={running} newSessionCwd={null} newSessionDraftKey={null} onAgentEnd={() => { setRunning(false); void refresh(); }} onOpenFile={setFile} onOpenSession={id => window.open(`/?session=${encodeURIComponent(id)}`, "_blank")} soundEnabled={false} /> : <div className="beacon-inspector"><p>{busy ? "正在打开真实的 Pi 对话…" : activeTicket?.answer || activeTicket?.question}</p>{activeTicket?.blocked && <><h3>先找到这些答案</h3>{map?.tickets.filter(t => activeTicket.blockers.includes(String(Number(t.number)))).map(t => <button key={t.id} onClick={() => void openTicket(t)}>{t.title} · {stateLabel(t)}</button>)}</>}{activeTicket && <button onClick={() => setFile(`${cwd}/${activeTicket.id}`)}>阅读原始票据 ↗</button>}</div>}
      </aside>}
    </div>
  </main>;
}
