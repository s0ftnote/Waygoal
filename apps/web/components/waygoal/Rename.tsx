"use client";
import { useState } from "react";
import type { WaygoalTitleSource } from "@/lib/waygoal/types";

interface Props {
  sessionId: string;
  title: string;
  titleSource: WaygoalTitleSource;
  /** Read the session back after Pi has changed its name. */
  onRenamed: () => Promise<void> | void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}

/** Naming one discussion, through Pi's own rename and title generation. Both
 *  happen because the user asked: nothing here names a session in the
 *  background, and Waygoal keeps no name of its own beside Pi's. */
export function WaygoalRename({ sessionId, title, titleSource, onRenamed, onError, onNotice }: Props) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [naming, setNaming] = useState(false);

  /** An empty box is not a name: a fallback title stays a fallback rather than
   *  being written in as though the user had chosen it. */
  const commit = async () => {
    const name = value.trim();
    if (!name) { setEditing(false); return; }
    try {
      const res = await fetch(`/api/sessions/${sessionId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? res.statusText);
      setEditing(false);
      await onRenamed();
    } catch (e) {
      // The box stays open with what was typed still in it: a failed rename
      // should not also lose the name the user just wrote.
      onError(`改名没有成功：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const askPi = async () => {
    setNaming(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/auto-name`, { method: "POST" });
      const body = await res.json().catch(() => ({})) as { title?: string; error?: string };
      if (!res.ok) throw new Error(body.error ?? res.statusText);
      await onRenamed();
      onNotice(`Pi 起的名字是「${body.title}」。不合适就点「改名」自己写。`);
    } catch (e) { onError(`起名字没有成功：${e instanceof Error ? e.message : String(e)}`); }
    finally { setNaming(false); }
  };

  if (!editing) return <div className="waygoal-rename">
    <button type="button" data-rename className="waygoal-button outlined small"
      onClick={() => { setValue(titleSource === "name" ? title : ""); setEditing(true); }}>改名</button>
    <button type="button" data-autoname className="waygoal-button outlined small" disabled={naming}
      onClick={() => void askPi()}>{naming ? "正在起名…" : "请 Pi 起个名字"}</button>
  </div>;

  return <div className="waygoal-rename">
    <input autoFocus data-rename-input aria-label="会话名称" value={value}
      placeholder={titleSource === "name" ? undefined : title}
      onChange={e => setValue(e.target.value)}
      onKeyDown={e => {
        if (e.key === "Enter") void commit();
        if (e.key === "Escape") { e.stopPropagation(); setEditing(false); }
      }} />
    <button type="button" data-rename-save className="waygoal-button action small" onClick={() => void commit()}>保存</button>
    <button type="button" className="waygoal-button outlined small" onClick={() => setEditing(false)}>取消</button>
  </div>;
}
