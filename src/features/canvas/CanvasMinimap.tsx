"use client";
import { useMemo, useRef, useState } from "react";
import { thumbnail, viewCenteredOn, worldPoint, type WaygoalThumbnail, type WaygoalCard } from "./locate";
import type { BoardEdge } from "./turn-board";
import type { WaygoalPoint, WaygoalView } from "@/shared/waygoal-types";

const THUMB = { width: 200, height: 126 };

type Props = {
  cards: WaygoalCard[];
  edges: BoardEdge[];
  view: WaygoalView;
  viewportSize: { width: number; height: number };
  selectedId: string | null;
  onGrab: () => WaygoalView;
  onPan: (view: WaygoalView) => void;
  onFit: () => void;
};

/** A read-only navigation control: dragging changes the view, never the session. */
export function CanvasMinimap({ cards, edges, view, viewportSize, selectedId, onGrab, onPan, onFit }: Props) {
  const [thumbnailFrame, setThumbnailFrame] = useState<WaygoalThumbnail | null>(null);
  const thumbnailDrag = useRef<{ pointerId: number; frame: WaygoalThumbnail; camera: WaygoalView; offset: WaygoalPoint } | null>(null);
  const liveThumb = useMemo(() => viewportSize.width > 0 ? thumbnail(cards, view, viewportSize, THUMB) : null,
    [cards, view, viewportSize]);
  // Freeze the map projection for the gesture. Only its viewport moves; fitting
  // the thumbnail again on every pan would move the world beneath the pointer.
  const thumb = thumbnailFrame ? { ...thumbnailFrame, view: {
    x: (-view.x / view.scale - thumbnailFrame.origin.x) * thumbnailFrame.scale,
    y: (-view.y / view.scale - thumbnailFrame.origin.y) * thumbnailFrame.scale,
    width: viewportSize.width / view.scale * thumbnailFrame.scale,
    height: viewportSize.height / view.scale * thumbnailFrame.scale,
  } } : liveThumb;
  const thumbnailPoint = (event: React.PointerEvent<HTMLButtonElement>, frame: WaygoalThumbnail) => {
    const box = event.currentTarget.getBoundingClientRect();
    return worldPoint(frame, { x: (event.clientX - box.left) * THUMB.width / box.width, y: (event.clientY - box.top) * THUMB.height / box.height });
  };
  const panThumbnail = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = thumbnailDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const point = thumbnailPoint(event, drag.frame);
    onPan(viewCenteredOn({ x: point.x + drag.offset.x, y: point.y + drag.offset.y }, drag.camera, viewportSize));
  };
  const startThumbnail = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || !thumb || thumbnailDrag.current) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    const camera = onGrab();
    const point = thumbnailPoint(event, thumb);
    const left = -camera.x / camera.scale, top = -camera.y / camera.scale;
    const width = viewportSize.width / camera.scale, height = viewportSize.height / camera.scale;
    const inside = point.x >= left && point.x <= left + width && point.y >= top && point.y <= top + height;
    thumbnailDrag.current = { pointerId: event.pointerId, frame: thumb, camera,
      offset: inside ? { x: left + width / 2 - point.x, y: top + height / 2 - point.y } : { x: 0, y: 0 } };
    setThumbnailFrame(thumb);
    event.currentTarget.setPointerCapture(event.pointerId);
    panThumbnail(event);
  };
  const endThumbnail = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (thumbnailDrag.current?.pointerId !== event.pointerId) return;
    if (event.type === "pointerup") panThumbnail(event);
    thumbnailDrag.current = null;
    setThumbnailFrame(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  if (!thumb) return null;
  return <details className="waygoal-thumb-box">
          <summary className="waygoal-thumb-heading"><span>画布导航</span><span>{Math.round(view.scale * 100)}%</span></summary>
          {/* Where everything sits and where the user is looking. Clicking only
              moves the view: no session is opened and nothing is sent. */}
          <button type="button" data-thumb className="waygoal-thumb" aria-label="画布缩略图：点击或拖动来移动视野，用键盘按下则显示整张画布"
            style={{ width: THUMB.width, height: THUMB.height }}
            onPointerDown={startThumbnail} onPointerMove={panThumbnail}
            onPointerUp={endThumbnail} onPointerCancel={endThumbnail} onLostPointerCapture={endThumbnail}
            onClick={event => { if (event.detail === 0) onFit(); }}>
            <svg className="waygoal-thumb-links" width={THUMB.width} height={THUMB.height} aria-hidden="true">
              {edges.filter(edge => edge.kind !== "history" || (thumb.cards.some(card => card.id === edge.from) && thumb.cards.some(card => card.id === edge.to))).map(edge => {
                const from = thumb.cards.find(card => card.id === edge.from) ?? thumb.cards.find(card => card.id === edge.fromSession);
                const to = thumb.cards.find(card => card.id === edge.to) ?? thumb.cards.find(card => card.id === edge.toSession);
                return from && to && from.id !== to.id ? <path key={edge.key} className={edge.kind} d={`M ${from.x + from.width / 2} ${from.y + from.height / 2} L ${to.x + to.width / 2} ${to.y + to.height / 2}`} /> : null;
              })}
            </svg>
            {thumb.cards.map(card => <span key={card.id} className={`waygoal-thumb-card ${card.kind}${card.id === selectedId ? " current" : ""}`} aria-hidden="true"
              style={{ left: card.x, top: card.y, width: Math.max(2, card.width), height: Math.max(2, card.height) }} />)}
            <span className="waygoal-thumb-view" data-thumb-view aria-hidden="true"
              style={{ left: thumb.view.x, top: thumb.view.y, width: thumb.view.width, height: thumb.view.height }} />
          </button>
        </details>;
}
