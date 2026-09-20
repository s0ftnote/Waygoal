import type { LayoutBox } from "./layout";

/** Dock on the facing sides, so vertically stacked tickets don't send a
 * dependency out of the right edge and back through the target's left edge. */
export function relationPath(from: LayoutBox, to: LayoutBox) {
  const a = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  const b = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
  const gapX = Math.max(to.x - from.x - from.width, from.x - to.x - to.width);
  const gapY = Math.max(to.y - from.y - from.height, from.y - to.y - to.height);
  // Choose a genuinely open corridor. Center distance alone can select the
  // side of overlapping columns and send the arrow backwards into a card.
  const horizontal = gapX > 0 || gapY > 0 ? gapX > gapY : Math.abs(b.x - a.x) > Math.abs(b.y - a.y);
  const direction = (horizontal ? b.x - a.x : b.y - a.y) >= 0 ? 1 : -1;
  const gap = 8;
  const start = horizontal
    ? { x: a.x + direction * (from.width / 2 + gap), y: a.y }
    : { x: a.x, y: a.y + direction * (from.height / 2 + gap) };
  const end = horizontal
    ? { x: b.x - direction * (to.width / 2 + gap), y: b.y }
    : { x: b.x, y: b.y - direction * (to.height / 2 + gap) };
  const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const controls = horizontal
    ? `${mid.x} ${start.y}, ${mid.x} ${end.y}`
    : `${start.x} ${mid.y}, ${end.x} ${mid.y}`;
  return { start, end, mid, horizontal, d: `M ${start.x} ${start.y} C ${controls}, ${end.x} ${end.y}` };
}
