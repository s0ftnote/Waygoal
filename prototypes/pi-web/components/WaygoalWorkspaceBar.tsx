"use client";
import { useState } from "react";
import type { WaygoalWorkspaceView } from "@/lib/waygoal-types";

interface Props {
  workspace: WaygoalWorkspaceView | null;
  /** Open another working directory. The canvas it was last on comes back. */
  onOpen: (cwd: string) => void | Promise<void>;
  onSwitchCanvas: (canvasId: string) => void | Promise<void>;
  onError: (message: string) => void;
}

/** Which working directory this is, and which of its canvases is open.
 *  Opening a directory and making a canvas are two separate buttons: neither
 *  writes a ticket, calls a skill or sends a message. Making one does take the
 *  user to it — that is the step they just asked for. */
export function WaygoalWorkspaceBar({ workspace, onOpen, onSwitchCanvas, onError }: Props) {
  const [picking, setPicking] = useState(false);
  const [path, setPath] = useState("");
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  const open = (cwd: string) => {
    const wanted = cwd.trim();
    if (!wanted) return;
    setPicking(false);
    setPath("");
    void onOpen(wanted);
  };

  const create = async () => {
    if (!workspace || creating) return;
    setCreating(true);
    try {
      const res = await fetch("/api/waygoal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd: workspace.cwd, name }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setNaming(false);
      setName("");
      await onSwitchCanvas(body.canvas.id);
    } catch (e) {
      onError(`新建画布没有成功：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setCreating(false);
    }
  };

  return <div className="waygoal-workspace">
    <span>工作目录</span>
    <code title={workspace?.cwd}>{workspace?.cwd ?? "…"}</code>
    <div className="waygoal-switch-box">
      <button type="button" data-workspace-switch className="waygoal-button outlined small" aria-expanded={picking}
        onClick={() => setPicking(o => !o)}>换一个目录</button>
      {picking && <div className="waygoal-switch" role="dialog" aria-label="换一个工作目录">
        <form onSubmit={e => { e.preventDefault(); open(path); }}>
          <input autoFocus data-workspace-input aria-label="工作目录路径" placeholder="输入一个目录路径" value={path}
            onChange={e => setPath(e.target.value)} onKeyDown={e => { if (e.key === "Escape") setPicking(false); }} />
          <button type="submit" data-workspace-open className="waygoal-button action small">打开</button>
        </form>
        {/* Directories opened before. One that has been moved away stays on
            the list saying so, rather than disappearing without a word. */}
        {(workspace?.recent.length ?? 0) > 0 && <>
          <p className="waygoal-find-label">开过的目录</p>
          <ul>
            {workspace?.recent.map(entry => <li key={entry.cwd}>
              <button type="button" data-workspace-recent={entry.cwd} disabled={entry.missing}
                onClick={() => open(entry.cwd)} title={entry.cwd}>
                {entry.cwd}{entry.missing ? "（这个目录不在了）" : ""}
              </button>
            </li>)}
          </ul>
        </>}
      </div>}
    </div>
    <span>画布</span>
    <div className="waygoal-canvas-list" role="group" aria-label="这个工作目录的画布">
      {workspace?.canvases.map(canvas => <button key={canvas.id} type="button" data-canvas={canvas.id}
        className={`waygoal-button small ${canvas.id === workspace.canvasId ? "action" : "outlined"}`}
        aria-current={canvas.id === workspace.canvasId || undefined}
        onClick={() => void onSwitchCanvas(canvas.id)}>{canvas.name}</button>)}
    </div>
    <div className="waygoal-switch-box">
      <button type="button" data-canvas-new className="waygoal-button outlined small" aria-expanded={naming}
        disabled={!workspace} onClick={() => setNaming(o => !o)}>新建画布</button>
      {naming && <div className="waygoal-switch" role="dialog" aria-label="新建画布">
        <form onSubmit={e => { e.preventDefault(); void create(); }}>
          <input autoFocus data-canvas-name aria-label="画布名字" placeholder="这张画布叫什么" value={name}
            onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === "Escape") setNaming(false); }} />
          <button type="submit" data-canvas-create className="waygoal-button action small" disabled={creating}>建一张</button>
        </form>
        {/* A new canvas is empty on purpose: nothing is moved onto it, and the
            chats already here stay where they are. */}
        <p className="waygoal-find-label">新画布是空的；已有的会话还留在原来那张上。</p>
      </div>}
    </div>
  </div>;
}
