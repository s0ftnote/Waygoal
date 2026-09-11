import { NODE_HEIGHT, NODE_WIDTH, type WaygoalPoint } from "./types";

const GAP_X = 70;
const GAP_Y = 60;
const STEP_X = NODE_WIDTH + GAP_X;
const STEP_Y = NODE_HEIGHT + GAP_Y;
export interface LayoutBox extends WaygoalPoint { width: number; height: number }
export interface LayoutCard {
  id: string;
  position: WaygoalPoint;
  height: number;
  originId?: string;
  groupId?: string;
  created?: string;
}

const overlaps = (a: LayoutBox, b: LayoutBox) => a.x < b.x + b.width + 20
  && b.x < a.x + a.width + 20 && a.y < b.y + b.height + 20 && b.y < a.y + a.height + 20;

/** Search from a requested place without moving anything already there. */
function freeNear(taken: readonly LayoutBox[], box: LayoutBox): WaygoalPoint {
  for (let radius = 0; ; radius++) {
    // Prefer the requested row, then nearby rows, before going farther away.
    for (let dx = 0; dx <= radius; dx++) {
      const dy = radius - dx;
      for (const [x, y] of [[dx, dy], [dx, -dy], [-dx, dy], [-dx, -dy]]) {
        const candidate = { ...box, x: box.x + x * STEP_X, y: box.y + y * STEP_Y };
        if (!taken.some(other => overlaps(candidate, other))) return { x: candidate.x, y: candidate.y };
      }
    }
  }
}

/** Independent cards fill an expanding grid instead of an endless three-column
 *  strip. A new fork starts immediately to the right of its known source. */
export function nextFreePosition(taken: Iterable<WaygoalPoint & { height: number }>, height: number, source?: WaygoalPoint): WaygoalPoint {
  const boxes = [...taken].map(point => ({ ...point, width: NODE_WIDTH }));
  if (source) return freeNear(boxes, { x: source.x + STEP_X, y: source.y, width: NODE_WIDTH, height });
  for (let edge = 0; ; edge++) {
    const cells = [
      ...Array.from({ length: edge }, (_, row) => [edge, row]),
      ...Array.from({ length: edge + 1 }, (_, col) => [col, edge]),
    ];
    for (const [col, row] of cells) {
      const candidate = { x: col * STEP_X, y: row * STEP_Y, width: NODE_WIDTH, height };
      if (!boxes.some(other => overlaps(candidate, other))) return { x: candidate.x, y: candidate.y };
    }
  }
}

/** Arrange only the supplied cards. Explicit groups and real forks make
 *  connected regions; titles and conversation content never affect placement. */
export function arrangeCards(selected: readonly LayoutCard[], obstacles: readonly LayoutBox[]): Record<string, WaygoalPoint> {
  if (selected.length < 2) return {};
  const cards = [...selected].sort((a, b) => (a.created ?? "").localeCompare(b.created ?? "")
    || a.position.y - b.position.y || a.position.x - b.position.x || a.id.localeCompare(b.id));
  const byId = new Map(cards.map(card => [card.id, card]));
  const neighbors = new Map(cards.map(card => [card.id, new Set<string>()]));
  const connect = (a: string, b: string) => { neighbors.get(a)?.add(b); neighbors.get(b)?.add(a); };
  const groupFirst = new Map<string, string>();
  for (const card of cards) {
    if (card.originId && byId.has(card.originId)) connect(card.id, card.originId);
    if (card.groupId) {
      const first = groupFirst.get(card.groupId);
      if (first) connect(card.id, first);
      else groupFirst.set(card.groupId, card.id);
    }
  }
  const seen = new Set<string>();
  const regions: { positions: Record<string, WaygoalPoint>; width: number; height: number }[] = [];
  for (const card of cards) {
    if (seen.has(card.id)) continue;
    const pending = [card.id];
    const members = new Set<string>();
    while (pending.length) {
      const id = pending.pop()!;
      if (seen.has(id)) continue;
      seen.add(id); members.add(id);
      pending.push(...neighbors.get(id)!);
    }
    const positions: Record<string, WaygoalPoint> = {};
    const columnBottom = new Map<number, number>();
    let width = 0, height = 0;
    for (const member of cards.filter(item => members.has(item.id))) {
      let depth = 0, parent = member.originId;
      const ancestors = new Set([member.id]);
      while (parent && byId.has(parent) && !ancestors.has(parent)) {
        ancestors.add(parent); depth++; parent = byId.get(parent)!.originId;
      }
      const point = { x: depth * STEP_X, y: columnBottom.get(depth) ?? 0 };
      positions[member.id] = point;
      columnBottom.set(depth, point.y + member.height + GAP_Y);
      width = Math.max(width, point.x + NODE_WIDTH);
      height = Math.max(height, point.y + member.height);
    }
    regions.push({ positions, width, height });
  }
  const anchor = { x: Math.min(...cards.map(card => card.position.x)), y: Math.min(...cards.map(card => card.position.y)) };
  const targetWidth = Math.max(...regions.map(region => region.width), Math.sqrt(regions.reduce((area, region) => area + (region.width + GAP_X) * (region.height + GAP_Y), 0) * 1.6));
  const occupied = [...obstacles];
  const result: Record<string, WaygoalPoint> = {};
  let x = 0, y = 0, rowHeight = 0;
  for (const region of regions) {
    if (x > 0 && x + region.width > targetWidth) { x = 0; y += rowHeight + GAP_Y; rowHeight = 0; }
    const point = freeNear(occupied, { x: anchor.x + x, y: anchor.y + y, width: region.width, height: region.height });
    for (const [id, offset] of Object.entries(region.positions)) result[id] = { x: Math.round(point.x + offset.x), y: Math.round(point.y + offset.y) };
    occupied.push({ ...point, width: region.width, height: region.height });
    x += region.width + GAP_X; rowHeight = Math.max(rowHeight, region.height);
  }
  return result;
}
