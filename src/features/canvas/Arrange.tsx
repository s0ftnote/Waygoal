"use client";
import { useState } from "react";

interface Props {
  /** The cards the user picked, in the order they picked them. */
  picked: { id: string; title: string }[];
  onGroup: (name: string) => Promise<void>;
  onLink: (note: string) => Promise<void>;
  onLayout: () => Promise<void>;
  onClear: () => void;
}

/** The one place manual arranging is offered: pick cards, then name a group or
 *  draw one relation between two of them. Both are the user's own words — no
 *  chat is read and no model is asked what these cards have in common. */
export function WaygoalArrange({ picked, onGroup, onLink, onLayout, onClear }: Props) {
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  if (picked.length === 0) return null;
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try { await action(); setName(""); setNote(""); } finally { setBusy(false); }
  };
  return <div className="waygoal-arrange" data-arrange>
    <span className="waygoal-count" data-picked={picked.length} title={picked.map(card => card.title).join("、")}>已选 {picked.length} 个</span>
    <button type="button" data-layout-selected className="waygoal-button outlined small" disabled={busy || picked.length < 2}
      onClick={() => void run(onLayout)}>整理所选</button>
    <form onSubmit={e => { e.preventDefault(); void run(() => onGroup(name)); }}>
      <input data-group-name value={name} onChange={e => setName(e.target.value)} placeholder="分组名" aria-label="分组名" />
      <button type="submit" data-group-create className="waygoal-button outlined small" disabled={busy || !name.trim()}>建一个分组</button>
    </form>
    {/* A relation is between two cards, so it waits until exactly two are picked. */}
    <form onSubmit={e => { e.preventDefault(); void run(() => onLink(note)); }}>
      <input data-link-note value={note} onChange={e => setNote(e.target.value)} placeholder="关联说明（可选）" aria-label="关联说明" />
      <button type="submit" data-link-create className="waygoal-button outlined small" disabled={busy || picked.length !== 2}>连一条关联</button>
    </form>
    <button type="button" data-picked-clear className="waygoal-button outlined small" onClick={onClear}>取消选择</button>
  </div>;
}
