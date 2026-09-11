"use client";
import { useMemo, useState } from "react";
import { findByTitle, recentSessions, type WaygoalCard } from "@/lib/waygoal/locate";

interface Props {
  /** Everything on the canvas right now, so a hit is always somewhere to go. */
  cards: readonly WaygoalCard[];
  onGo: (card: WaygoalCard) => void;
}

const KIND_LABEL = { session: "会话", ticket: "票据", map: "地图", group: "分组" } as const;

/** Finding a discussion by the name it was given. It opens over the canvas and
 *  closes again: the canvas stays the main view, and this only says where to
 *  go. Matching is on the title alone — the sessions' text is not read. */
export function WaygoalFind({ cards, onGo }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searching = query.trim().length > 0;
  const found = useMemo(() => (searching ? findByTitle(cards, query) : recentSessions(cards)), [cards, query, searching]);
  return <div className="waygoal-find-box">
    <button type="button" data-find className="waygoal-button outlined small" aria-expanded={open}
      onClick={() => { setOpen(o => !o); setQuery(""); }}>查找</button>
    {open && <div className="waygoal-find" role="group" aria-label="按标题查找会话">
      <input autoFocus data-find-input aria-label="按标题查找" placeholder="按标题查找" value={query}
        onChange={e => setQuery(e.target.value)}
        onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } }} />
      <p className="waygoal-find-label">{searching
        ? (found.length ? "标题里带这几个字的" : "没有标题里带这几个字的。查找只按标题，不改动任何会话。")
        : "最近聊过的"}</p>
      <ul>
        {found.map(card => <li key={card.id}>
          <button type="button" data-find-hit={card.id} onClick={() => { setOpen(false); onGo(card); }}>
            <span className="waygoal-find-title">{card.title}</span>
            <span className="waygoal-tag">{KIND_LABEL[card.kind]}</span>
          </button>
        </li>)}
      </ul>
    </div>}
  </div>;
}
