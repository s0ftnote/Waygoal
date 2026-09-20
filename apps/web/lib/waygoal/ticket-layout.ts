import { placeExpandedSessions } from "./session-expansion";
import { arrangeCards, type LayoutBox } from "./layout";
import { NODE_HEIGHT, NODE_WIDTH, ticketCardHeight, type WaygoalTicketMapCard } from "./types";

/** Source mirrors are metadata. Only real maps and issues occupy the board. */
export function ticketCards(maps: readonly WaygoalTicketMapCard[]) {
  return maps.flatMap(map => [
    ...(!map.remote ? [{ id: map.path, position: map.position, height: NODE_HEIGHT, originId: undefined as string | undefined }] : []),
    ...map.tickets.map(ticket => ({ id: ticket.id, position: ticket.position,
      height: ticket.expanded ? ticketCardHeight(ticket.discussions.length) : 152,
      originId: ticket.parentTicketId ?? (map.remote ? undefined : map.path) })),
  ]);
}
export function ticketRelations(maps: readonly WaygoalTicketMapCard[]) {
  return maps.flatMap(map => map.tickets.flatMap(ticket => [
    ...(ticket.parentTicketId || !map.remote ? [{ from: ticket.parentTicketId ?? map.path, to: ticket.id, kind: "membership" as const }] : []),
    ...ticket.blockers.flatMap(blocker => blocker.path ? [{ from: blocker.path, to: ticket.id, kind: "dependency" as const }] : []),
  ]));
}

/** Layout is explicit and undoable. Parentage groups cards; dependencies do
 * not masquerade as parents. Unselected conversation bounds are obstacles. */
export function arrangeTickets(maps: readonly WaygoalTicketMapCard[], obstacles: readonly LayoutBox[]) {
  const cards = ticketCards(maps);
  if (cards.length < 2) return {};
  const x = Math.max(Math.min(...cards.map(c => c.position.x)), ...obstacles.map(b => b.x + b.width + 56));
  const y = Math.min(...cards.map(c => c.position.y));
  return arrangeCards(cards.map((card, index) => ({...card, position: {x, y}, created: String(index).padStart(12, "0")})), obstacles);
}

/** The same collision pass handles sessions and ticket families. Only explicit
 * parentage joins a family; sharing a GitHub repository does not. */
export function placeTicketMaps(maps: readonly WaygoalTicketMapCard[], obstacles: readonly (LayoutBox & { sessionId?: string })[], headerHeights: Record<string, number> = {}) {
  const owners = new Map(maps.flatMap(map => map.tickets.flatMap(ticket => ticket.discussions.map(talk => [talk.sessionId, ticket.id] as const))));
  const cards = ticketCards(maps);
  const frames = new Map(ticketClusters(maps).map(cluster => {
    const contents = cards.filter(card => card.id !== cluster.id && cluster.members.includes(card.id)).map(card => ({...card.position, width: NODE_WIDTH, height: card.height}));
    const rootTalks = new Set(maps.flatMap(map => map.tickets).find(ticket => ticket.id === cluster.id)?.discussions.map(talk => talk.sessionId) ?? []);
    contents.push(...obstacles.filter(box => box.sessionId && cluster.sessionIds.includes(box.sessionId)).map(box => rootTalks.has(box.sessionId!)
      ? {...box, x: box.x - 14, y: box.y - 52, width: box.width + 28, height: box.height + 66} : box));
    if (!contents.length) return [cluster.id, null] as const;
    const x = Math.min(...contents.map(box => box.x)) - 20;
    const height = headerHeights[cluster.id] ?? 132;
    return [cluster.id, {x, y: Math.min(...contents.map(box => box.y)) - height - 16,
      width: Math.max(720, Math.max(...contents.map(box => box.x + box.width)) - x + 20), height}] as const;
  }));
  // Collision bounds include the actual Map header; the saved Map anchor is
  // still translated by the family's offset, never replaced by header geometry.
  const projected = cards.map(card => ({...card, position: frames.get(card.id) ?? card.position,
    origin: card.originId ? {sessionId: card.originId} : null}));
  const placed = placeExpandedSessions(projected,
    Object.fromEntries(cards.map(card => [card.id, frames.get(card.id) ?? {width: NODE_WIDTH, height: card.height}])),
    obstacles.map(box => ({...box, ownerId: box.sessionId ? owners.get(box.sessionId) : undefined})));
  const positions = new Map(placed.map((card, index) => [card.id, {
    x: cards[index].position.x + card.position.x - projected[index].position.x,
    y: cards[index].position.y + card.position.y - projected[index].position.y,
  }]));
  return maps.map(map => ({...map, position: positions.get(map.path) ?? map.position,
    tickets: map.tickets.map(ticket => ({...ticket, position: positions.get(ticket.id) ?? ticket.position})),
  }));
}

/** Frames follow actual parentage, never a shared repository. Nested maps
 * belong to their outer map; malformed cycles terminate without duplicating. */
export function ticketClusters(maps: readonly WaygoalTicketMapCard[]) {
  return maps.flatMap(map => {
    const byId = new Map(map.tickets.map(ticket => [ticket.id, ticket]));
    const roots = map.remote ? map.tickets.filter(ticket => {
      if (ticket.type !== "map") return false;
      const seen = new Set([ticket.id]);
      let parent = ticket.parentTicketId;
      while (parent && !seen.has(parent)) {
        seen.add(parent);
        const ancestor = byId.get(parent);
        if (ancestor?.type === "map") return false;
        parent = ancestor?.parentTicketId;
      }
      return !parent;
    }).map(ticket => ({id: ticket.id, title: ticket.title, position: ticket.position}))
      : [{id: map.path, title: map.title, position: map.position}];
    return roots.flatMap(root => {
      const members = new Set([root.id]);
      const visit = (id: string) => {
        for (const ticket of map.tickets) {
          if ((ticket.parentTicketId === id || (!map.remote && id === map.path && !ticket.parentTicketId)) && !members.has(ticket.id)) {
            members.add(ticket.id); visit(ticket.id);
          }
        }
      };
      visit(root.id);
      const sessionIds = [...new Set(map.tickets.filter(ticket => members.has(ticket.id)).flatMap(ticket => ticket.discussions.filter(talk => !talk.missing).map(talk => talk.sessionId)))];
      return members.size > 1 || sessionIds.length ? [{...root, members: [...members], sessionIds}] : [];
    });
  });
}
