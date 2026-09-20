"use client";
import { useEffect, useRef, useState } from "react";
import type { BoardCard } from "@/features/canvas/turn-board";
import { takeawayChanged, type TurnTakeaway } from "@/features/materials/takeaways";

export function TakeawayEditor({ card, initial, busy, onSave, onClose }: {
  card: BoardCard; initial?: TurnTakeaway; busy: boolean;
  onSave: (value: TurnTakeaway | null) => Promise<boolean>; onClose: () => void;
}) {
  const [text, setText] = useState(initial?.text ?? "");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [fingerprint, setFingerprint] = useState(card.turn.fingerprint ?? "");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const save = async (value: TurnTakeaway | null) => {
    setWorking(true); setError("");
    try { if (await onSave(value)) onClose(); else setError("没有保存成功，你写的文字仍在这里，请重试。"); }
    finally { setWorking(false); }
  };
  const generate = async () => {
    const controller = new AbortController(); request.current = controller;
    setWorking(true); setError("");
    try {
      const response = await fetch(`/api/waygoal/session/${encodeURIComponent(card.sessionId)}/takeaway`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ turnId: card.turn.id }), signal: controller.signal,
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      if (controller.signal.aborted) return;
      setText(body.text); setFingerprint(body.fingerprint);
      if (!await onSave(body)) setError("提炼已完成，但没能保存。文字仍在这里，请重试。");
    } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : String(error)); }
    finally { if (!controller.signal.aborted) setWorking(false); }
  };
  return <section className="waygoal-takeaway-editor" aria-label="编辑这轮所得" onKeyDown={event => {
    if (event.key === "Escape") { event.stopPropagation(); onClose(); }
  }}>
    <header><strong>这轮值得记住什么</strong><button type="button" aria-label="关闭所得编辑" onClick={onClose}>×</button></header>
    <p className="waygoal-takeaway-source">{card.turn.question}</p>
    {initial && takeawayChanged(initial, card.turn.fingerprint) && <p>原文已有变化，请对照后再确认。</p>}
    <label htmlFor="waygoal-takeaway-text">画布上的一句话</label>
    <textarea id="waygoal-takeaway-text" value={text} maxLength={80} rows={3} disabled={working}
      placeholder="记下发现、待解问题，或你认可的方向…" onChange={event => setText(event.target.value)} />
    <small>只整理画布，不改原文或下一轮输入。</small>
    {error && <p role="alert" className="waygoal-takeaway-error">{error}</p>}
    <div className="waygoal-takeaway-buttons">
      <button type="button" disabled={working || busy || !card.turn.answer.trim()} onClick={() => void generate()}>{working ? "正在处理…" : "请 Pi 提炼"}</button>
      <button type="button" className="waygoal-takeaway-confirm" disabled={working || !text.trim() || !fingerprint}
        onClick={() => void save({ text: text.trim(), status: "confirmed", fingerprint })}>确认并保存</button>
    </div>
    {initial && <button type="button" className="waygoal-takeaway-remove" disabled={working} onClick={() => void save(null)}>移除这句所得</button>}
  </section>;
}
