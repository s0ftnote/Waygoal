import { NODE_WIDTH, type WaygoalPoint, type WaygoalView } from "./waygoal-types";

/** One card on the canvas as finding and the thumbnail see it: something to
 *  match a title against, a place, and how much room it takes. A ticket's
 *  title comes from its source file and is not renamed here. */
export interface WaygoalCard {
  id: string;
  title: string;
  kind: "session" | "ticket" | "map" | "group";
  position: WaygoalPoint;
  height: number;
  /** When the session last changed. Tickets and maps have no such time — the
   *  file's read time says when it was read, not when the work moved. */
  modified: string | null;
}

export interface WaygoalBox { x: number; y: number; width: number; height: number }
export interface WaygoalSize { width: number; height: number }

export const cardCenter = (card: WaygoalCard): WaygoalPoint =>
  ({ x: card.position.x + NODE_WIDTH / 2, y: card.position.y + card.height / 2 });

/** Everything the canvas holds, as one box. Null when it holds nothing. */
export function cardBounds(cards: readonly WaygoalCard[]): WaygoalBox | null {
  if (cards.length === 0) return null;
  const x = Math.min(...cards.map(c => c.position.x));
  const y = Math.min(...cards.map(c => c.position.y));
  return {
    x, y,
    width: Math.max(...cards.map(c => c.position.x + NODE_WIDTH)) - x,
    height: Math.max(...cards.map(c => c.position.y + c.height)) - y,
  };
}

/** Newest first, and anything without a time after everything with one. */
const byRecency = (a: WaygoalCard, b: WaygoalCard): number =>
  a.modified && b.modified ? b.modified.localeCompare(a.modified) : a.modified ? -1 : b.modified ? 1 : 0;

/** Cards whose title contains what was typed. Plain substring, ignoring case:
 *  a near miss is not a match, so nothing the user did not name shows up.
 *  Every match is returned — a card dropped to keep the list short is a card
 *  that cannot be found at all. */
export function findByTitle(cards: readonly WaygoalCard[], query: string): WaygoalCard[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return cards.filter(card => card.title.toLowerCase().includes(needle)).sort(byRecency);
}

/** What the list shows with nothing typed: the discussions last said something
 *  in. Only sessions — a ticket does not have a "last talked in". */
export function recentSessions(cards: readonly WaygoalCard[], limit = 5): WaygoalCard[] {
  return cards.filter(card => card.kind === "session" && card.modified).sort(byRecency).slice(0, limit);
}

/** The view that puts one place on the canvas in the middle of the viewport,
 *  at the scale the user is already at. Locating moves the view: it opens
 *  nothing, sends nothing, and does not change which path a session continues. */
export function viewCenteredOn(point: WaygoalPoint, view: WaygoalView, viewport: WaygoalSize): WaygoalView {
  return { x: viewport.width / 2 - point.x * view.scale, y: viewport.height / 2 - point.y * view.scale, scale: view.scale };
}

export interface WaygoalThumbnail {
  /** Canvas point the thumbnail's top-left corner stands for. */
  origin: WaygoalPoint;
  scale: number;
  cards: ({ id: string; kind: WaygoalCard["kind"] } & WaygoalBox)[];
  /** Where what the user is looking at now sits on the thumbnail. */
  view: WaygoalBox;
}

/** Every card and the current viewport, drawn small. The viewport is part of
 *  what has to fit: panned off the cards, the user still has to see where they
 *  are relative to them. */
export function thumbnail(cards: readonly WaygoalCard[], view: WaygoalView, viewport: WaygoalSize, size: WaygoalSize): WaygoalThumbnail | null {
  const cardsBox = cardBounds(cards);
  if (!cardsBox) return null;
  const shown: WaygoalBox = {
    x: -view.x / view.scale, y: -view.y / view.scale,
    width: viewport.width / view.scale, height: viewport.height / view.scale,
  };
  const x = Math.min(cardsBox.x, shown.x), y = Math.min(cardsBox.y, shown.y);
  const width = Math.max(cardsBox.x + cardsBox.width, shown.x + shown.width) - x;
  const height = Math.max(cardsBox.y + cardsBox.height, shown.y + shown.height) - y;
  const scale = Math.min(size.width / width, size.height / height);
  const place = (box: WaygoalBox): WaygoalBox =>
    ({ x: (box.x - x) * scale, y: (box.y - y) * scale, width: box.width * scale, height: box.height * scale });
  return {
    origin: { x, y },
    scale,
    cards: cards.map(card => ({
      id: card.id, kind: card.kind,
      ...place({ x: card.position.x, y: card.position.y, width: NODE_WIDTH, height: card.height }),
    })),
    view: place(shown),
  };
}

/** The place on the canvas a point on the thumbnail stands for. */
export const worldPoint = (thumb: WaygoalThumbnail, point: WaygoalPoint): WaygoalPoint =>
  ({ x: thumb.origin.x + point.x / thumb.scale, y: thumb.origin.y + point.y / thumb.scale });
