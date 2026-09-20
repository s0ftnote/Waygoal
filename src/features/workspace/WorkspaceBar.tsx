"use client";
import { useEffect, useRef, useState } from "react";
import { DirectoryPicker } from "@/features/workspace/DirectoryPicker";
import { DEFAULT_CANVAS_ID, type WaygoalWorkspaceView } from "@/shared/waygoal-types";

interface Props {
  workspace: WaygoalWorkspaceView | null;
  onOpen: (cwd: string) => void | Promise<void>;
  onSwitchCanvas: (canvasId: string) => void | Promise<void>;
  onError: (message: string) => void;
  onImported: () => void | Promise<void>;
  onOverview: () => void;
}

/** Canvas selection is the primary action; directory and import each have
 * their own view. The legacy default bucket remains intact behind its label. */
export function WaygoalWorkspaceBar({ workspace, onOpen, onSwitchCanvas, onError, onImported, onOverview }: Props) {
  const menu = useRef<HTMLDetailsElement>(null);
  const [view, setView] = useState<"canvases" | "directory" | "import">("canvases");
  const [browsing, setBrowsing] = useState(false);
  const [pickerContainer, setPickerContainer] = useState<HTMLDivElement | null>(null);
  const [path, setPath] = useState("");
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const canvasName = (id: string) => id === DEFAULT_CANVAS_ID ? "未归类会话" : workspace?.canvases.find(canvas => canvas.id === id)?.name ?? "画布";
  const close = () => { if (menu.current) menu.current.open = false; };
  useEffect(close, [workspace?.cwd, workspace?.canvasId]);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => { if (menu.current && !menu.current.contains(event.target as Node)) menu.current.open = false; };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, []);
  const candidates = (workspace?.sessions ?? []).filter(session => session.canvasId !== workspace?.canvasId && session.title.toLowerCase().includes(query.toLowerCase()));
  const count = (id: string) => (workspace?.sessions ?? []).filter(session => session.canvasId === id).length;
  const canvases = workspace?.canvases.filter(canvas => canvas.id !== DEFAULT_CANVAS_ID) ?? [];
  const importSession = async (sessionId: string) => {
    if (!workspace || importing) return;
    setImporting(sessionId);
    try {
      const response = await fetch("/api/waygoal", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd: workspace.cwd, canvas: workspace.canvasId, registerSession: sessionId }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      await onImported();
    } catch (error) { onError(`加入没有成功：${error instanceof Error ? error.message : String(error)}`); }
    finally { setImporting(null); }
  };
  const open = (cwd: string) => {
    const wanted = cwd.trim();
    if (!wanted) return;
    setBrowsing(false); setView("canvases"); setPath(""); close();
    void onOpen(wanted);
  };
  const create = async () => {
    if (!workspace || creating) return;
    setCreating(true);
    // A distinguishable name without making naming a prerequisite to writing.
    let number = 1;
    while (canvases.some(canvas => canvas.name === `画布 ${number}`)) number++;
    try {
      const response = await fetch("/api/waygoal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd: workspace.cwd, name: `画布 ${number}` }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      await onSwitchCanvas(body.canvas.id);
    } catch (error) { onError(`新建画布没有成功：${error instanceof Error ? error.message : String(error)}`); }
    finally { setCreating(false); }
  };
  const choose = async (id: string) => {
    close();
    await onSwitchCanvas(id);
    if (id === DEFAULT_CANVAS_ID) onOverview();
  };

  return <div className="waygoal-workspace" ref={setPickerContainer}>
    <details className="waygoal-workspace-menu" ref={menu}
      onToggle={event => { if (event.currentTarget.open) { setView("canvases"); setQuery(""); } }}
      onKeyDown={event => { if (event.key === "Escape") { close(); menu.current?.querySelector("summary")?.focus(); } }}>
      <summary aria-label="工作区与画布" title={workspace?.cwd} data-canvas-id={workspace?.canvasId}><span>{workspace?.cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? "工作区"}</span><span aria-hidden="true">/</span><span>{workspace ? canvasName(workspace.canvasId) : "画布"}</span><span aria-hidden="true">⌄</span></summary>
      <div className="waygoal-workspace-controls waygoal-workspace-picker">
        {view === "canvases" && <>
          <header className="waygoal-picker-heading"><span>画布</span><button type="button" data-canvas-new disabled={!workspace || creating} onClick={() => void create()}>{creating ? "创建中…" : "＋ 新建"}</button></header>
          <div className="waygoal-picker-list" role="group" aria-label="这个工作目录的画布">
            {canvases.map(canvas => <button key={canvas.id} type="button" data-canvas={canvas.id} aria-current={canvas.id === workspace?.canvasId || undefined} onClick={() => void choose(canvas.id)}>
              <span className="waygoal-picker-row-title">{canvas.name}</span><small>{count(canvas.id) ? `${count(canvas.id)} 段会话` : "还没开始"}</small><span className="waygoal-picker-check" aria-hidden="true">{canvas.id === workspace?.canvasId ? "✓" : ""}</span>
            </button>)}
            {!canvases.length && <p className="waygoal-picker-empty">从一张空白画布开始，或接着聊已有会话。</p>}
          </div>
          <div className="waygoal-picker-section">
            <button type="button" className="waygoal-picker-action" data-canvas={workspace ? DEFAULT_CANVAS_ID : undefined} disabled={!workspace} aria-current={workspace?.canvasId === DEFAULT_CANVAS_ID || undefined} onClick={() => void choose(DEFAULT_CANVAS_ID)}><span>未归类会话</span><small>{count(DEFAULT_CANVAS_ID)}</small></button>
            <button type="button" data-session-import-open className="waygoal-picker-action" onClick={() => setView("import")}><span>加入已有会话</span><span aria-hidden="true">＋</span></button>
            <button type="button" className="waygoal-picker-action" onClick={() => { onOverview(); close(); }}><span>查看会话与票据</span><span aria-hidden="true">↗</span></button>
          </div>
          <div className="waygoal-picker-section"><button type="button" data-workspace-switch className="waygoal-picker-action waygoal-picker-directory" title={workspace?.cwd} onClick={() => setView("directory")}><span>切换工作目录</span><span aria-hidden="true">›</span></button></div>
        </>}
        {view === "directory" && <>
          <header className="waygoal-picker-heading"><button type="button" onClick={() => setView("canvases")}>← 返回</button><span>工作目录</span></header>
          <code className="waygoal-picker-path">{workspace?.cwd}</code>
          <button type="button" data-workspace-browse className="waygoal-picker-action" onClick={() => { close(); setBrowsing(true); }}>浏览文件夹…</button>
          <form className="waygoal-picker-path-form" onSubmit={event => { event.preventDefault(); open(path); }}>
            <input autoFocus data-workspace-input aria-label="工作目录路径" placeholder="或粘贴目录路径" value={path} onChange={event => setPath(event.target.value)} />
            <button type="submit" data-workspace-open disabled={!path.trim()}>打开</button>
          </form>
          {(workspace?.recent.length ?? 0) > 0 && <div className="waygoal-picker-section"><p className="waygoal-picker-caption">最近打开</p><div className="waygoal-picker-list">{workspace?.recent.map(entry => <button key={entry.cwd} type="button" data-workspace-recent={entry.cwd} disabled={entry.missing} onClick={() => open(entry.cwd)} title={entry.cwd}><span className="waygoal-picker-row-title">{entry.cwd.split(/[\\/]/).filter(Boolean).at(-1)}{entry.missing ? "（目录不在了）" : ""}</span><small>{entry.cwd}</small></button>)}</div></div>}
        </>}
        {view === "import" && <>
          <header className="waygoal-picker-heading"><button type="button" onClick={() => setView("canvases")}>← 返回</button><span>加入已有会话</span></header>
          <p className="waygoal-picker-caption">移到「{workspace && canvasName(workspace.canvasId)}」，保留完整对话。</p>
          <input autoFocus className="waygoal-picker-search" aria-label="搜索已有会话" placeholder="搜索会话" value={query} onChange={event => setQuery(event.target.value)} />
          <ul className="waygoal-picker-imports">{candidates.map(session => <li key={session.id}><span><b>{session.title}</b><small>{canvasName(session.canvasId)}</small></span><button type="button" data-import-session={session.id} disabled={Boolean(importing)} onClick={() => void importSession(session.id)}>{importing === session.id ? "加入中…" : "加入"}</button></li>)}</ul>
          {!candidates.length && <p className="waygoal-picker-empty">没有找到可加入的会话。</p>}
        </>}
      </div>
    </details>
    {browsing && <DirectoryPicker initialPath={workspace?.cwd} portalContainer={pickerContainer} onSelect={open} onCancel={() => setBrowsing(false)} />}
  </div>;
}
