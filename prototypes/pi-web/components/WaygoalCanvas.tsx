"use client";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { rekeyDraft } from "@/lib/draft-store";
import { cardBounds, cardCenter, thumbnail, viewCenteredOn, worldPoint, type WaygoalCard } from "@/lib/waygoal-locate";
import type { SessionInfo } from "@/lib/types";
import type { WaygoalBranchChoice, WaygoalBranchPoint, WaygoalSessionTreeResponse } from "@/lib/waygoal-branches";
import { mapKind, ticketKind } from "@/lib/waygoal-labels";
import { CHIP_HEIGHT, NODE_HEIGHT, NODE_WIDTH, canOpen, needsCheck, ticketCardHeight, ticketChipTop, type WaygoalCanvasPatch, type WaygoalNode, type WaygoalReference, type WaygoalPoint, type WaygoalSnapshotResponse, type WaygoalTicketCard, type WaygoalView } from "@/lib/waygoal-types";
import { ChatWindow } from "./ChatWindow";
import { FileViewer } from "./FileViewer";
import { WaygoalPaths } from "./WaygoalPaths";
import { WaygoalArrange } from "./WaygoalArrange";
import { WaygoalFind } from "./WaygoalFind";
import { WaygoalPathView } from "./WaygoalPathView";
import { WaygoalRename } from "./WaygoalRename";
import { WaygoalWorkspaceBar } from "./WaygoalWorkspaceBar";
import { stateClass, WaygoalTicketPanel } from "./WaygoalTicketPanel";

const NODE_W = NODE_WIDTH;
const NODE_H = NODE_HEIGHT;
const DEFAULT_VIEW: WaygoalView = { x: 48, y: 48, scale: 1 };
/** The thumbnail's own size in screen pixels. */
const THUMB = { width: 168, height: 112 };
const MIN_SCALE = 0.35;
const MAX_SCALE = 1.8;
/** The composer a ticket opens is a new-session composer, and the host clears a
 *  new-session draft as soon as that composer unmounts. An unsent ticket draft
 *  has to outlive closing the panel, so it is parked under the ticket's own key
 *  while no composer holds it, and handed back when the ticket is opened again. */
const liveTicketDraft = (ticket: string, cwd: string) => `waygoal-ticket:${ticket}:${cwd}`;
const parkedTicketDraft = (ticket: string, cwd: string) => `waygoal-ticket-parked:${ticket}:${cwd}`;
const CHIP_GAP = 16;

function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next = { ...record };
  delete next[key];
  return next;
}

type Drag = { id?: string; start: WaygoalPoint; origin: WaygoalPoint; moved: boolean; pointerId: number };
/** A read-only reading position. `entryId` is the entry being displayed and is
 *  null when the position is only known as a session — a fork whose origin
 *  message was never recorded. `leafId` is the separate id continuing here would
 *  navigate to: Pi moves the leaf to a user entry's PARENT and puts its text in
 *  the editor, so the displayed entry is not what you continue from. Null means
 *  there is nothing here to continue from. */
type Viewing = { sessionId: string; entryId: string | null; leafId: string | null; label: string };

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff)) return "";
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} 天前`;
  return new Date(iso).toLocaleDateString("zh-CN");
}

function nodeToSession(node: WaygoalNode, cwd: string): SessionInfo {
  return {
    id: node.id,
    path: "",
    cwd,
    name: node.titleSource === "name" ? node.title : undefined,
    created: node.created,
    modified: node.modified,
    messageCount: node.messageCount,
    firstMessage: node.title,
    transient: node.transient,
  };
}

/** One CJK character of the link label at its 10px canvas size. */
const LINK_LABEL_CHAR_W = 10;

/** Where a link between two cards should touch each card's border, so the
 *  line and its label stay in the gap instead of running under a card. */
function borderAnchor(from: WaygoalPoint, to: WaygoalPoint): { x: number; y: number } {
  const cx = from.x + NODE_W / 2, cy = from.y + NODE_H / 2;
  const dx = to.x - from.x, dy = to.y - from.y;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const t = Math.min(
    Math.abs(dx) > 0.001 ? (NODE_W / 2) / Math.abs(dx) : Infinity,
    Math.abs(dy) > 0.001 ? (NODE_H / 2) / Math.abs(dy) : Infinity,
  );
  return { x: cx + dx * t, y: cy + dy * t };
}

/** Every branch choice of a session, flattened for the canvas chips. The order
 *  is kept per branch point so a path is called the same thing on the canvas
 *  and in the panel. */
function flattenChoices(branchPoints: WaygoalBranchPoint[]): { choice: WaygoalBranchChoice; order: number }[] {
  return branchPoints.flatMap(point => point.choices.map((choice, order) => ({ choice, order })));
}

export function WaygoalCanvas() {
  const isMobile = useIsMobile();
  const [cwd, setCwd] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("cwd") ?? "";
  });
  // The canvas being shown. Null means the one this working directory was
  // left on, which is what the record remembers.
  const [canvasId, setCanvasId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("canvas");
  });
  const [snapshot, setSnapshot] = useState<WaygoalSnapshotResponse | null>(null);
  // The local ticket the panel is showing, by source path; a map's own path
  // when the map itself is open. Tickets are files, never Pi sessions.
  const [openTicket, setOpenTicket] = useState<string | null>(null);
  // A file the open ticket or map points at, read inside the same panel. It is
  // shown with the viewer the app already has, read-only: nothing is edited
  // here and no session is touched by looking.
  const [openFile, setOpenFile] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [view, setView] = useState<WaygoalView>(DEFAULT_VIEW);
  const [dragging, setDragging] = useState<Record<string, WaygoalPoint>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Cards the user picked with ⌘/Ctrl-click, to group or to link. Picking is
  // not opening: it changes nothing until 建一个分组 or 连一条关联 is pressed.
  const [picked, setPicked] = useState<string[]>([]);
  const [draftKey, setDraftKey] = useState<string | null>(null);
  // The ticket a discussion being started belongs to. Nothing is written until
  // the user actually sends: an unsent draft holds no session and no ticket.
  const [pendingTicket, setPendingTicket] = useState<string | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [createdSession, setCreatedSession] = useState<SessionInfo | null>(null);
  const [panelKey, setPanelKey] = useState(0);
  const [trust, setTrust] = useState<{ requiresTrust: boolean; trusted: boolean } | null>(null);
  const [tree, setTree] = useState<WaygoalSessionTreeResponse | null>(null);
  // Text typed while reading a path: sending it is what moves the session onto
  // that path, so ChatWindow sends it once it has reopened there.
  const [pending, setPending] = useState<string | undefined>(undefined);
  const [viewing, setViewing] = useState<Viewing | null>(null);
  const [forkingEntryId, setForkingEntryId] = useState<string | null>(null);
  const restoredFor = useRef<string | null>(null);
  // Set only by user interaction (wheel, drag, buttons, keys). Restoring the
  // saved view or revealing a node never writes the record back.
  const viewDirty = useRef(false);
  const viewSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drag = useRef<Drag | null>(null);
  /** Drop whatever the panel was on: an unsent draft, a session created from
   *  one, a read-only reading position. Every way of opening something else
   *  starts here; what it opens instead is that caller's own business. */
  const leavePanel = useCallback(() => { setDraftKey(null); setCreatedSession(null); setViewing(null); }, []);

  const viewportRef = useRef<HTMLDivElement>(null);
  // The session ChatWindow is showing, so a fork it reports can be attributed.
  const chatSessionId = useRef<string | null>(null);
  const pendingRestoreEntry = useRef<string | null>(null);
  // Whether the error on screen came from reading the canvas.
  const readError = useRef(false);

  const patch = useCallback(async (body: WaygoalCanvasPatch) => {
    if (!snapshot?.cwd) return;
    try {
      // The canvas comes from the snapshot, not from the URL: a patch belongs
      // to the canvas that is actually on screen.
      const res = await fetch("/api/waygoal", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd: snapshot.cwd, canvas: snapshot.workspace.canvasId, ...body }) });
      if (!res.ok) throw new Error((await res.json()).error);
    } catch (e) { setError(`画布记录没有保存：${e instanceof Error ? e.message : String(e)}`); }
  }, [snapshot?.cwd, snapshot?.workspace.canvasId]);

  /** Ask the host to read that remote ticket's raw result again. Nothing is
   *  sent to the source and nothing is written to it: this only retries the
   *  read of a result the Agent already produced. */
  const retryRemote = useCallback(async (ticket: WaygoalTicketCard) => {
    if (!snapshot?.cwd) return;
    try {
      const res = await fetch("/api/waygoal/remote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd: snapshot.cwd, ticket: ticket.id }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      if (!body.captured) setNotice(body.note ?? "还是没读到这次交付的原始结果。");
    } catch (e) { setError(`没能重新取得：${e instanceof Error ? e.message : String(e)}`); }
  }, [snapshot?.cwd]);

  const refresh = useCallback(async (force = false) => {
    try {
      const params = new URLSearchParams();
      if (cwd) params.set("cwd", cwd);
      if (canvasId) params.set("canvas", canvasId);
      if (force) params.set("force", "1");
      const res = await fetch(`/api/waygoal${params.size ? `?${params}` : ""}`, { cache: "no-store" });
      const next = await res.json();
      if (!res.ok) throw new Error(next.error);
      setSnapshot(next as WaygoalSnapshotResponse);
      // Only what reading the canvas reported is taken back by reading it
      // again; something the user was told about their own last action stays
      // on screen until they close it.
      if (readError.current) { readError.current = false; setError(""); }
    } catch (e) { readError.current = true; setError(e instanceof Error ? e.message : String(e)); }
  }, [canvasId, cwd]);

  useEffect(() => {
    void refresh(true);
    const timer = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 2500);
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [refresh]);

  // Keep the URL on the real workspace and canvas so a reload lands in the
  // same place.
  useEffect(() => {
    if (!snapshot) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("cwd") === snapshot.cwd && url.searchParams.get("canvas") === snapshot.workspace.canvasId) return;
    url.searchParams.set("cwd", snapshot.cwd);
    url.searchParams.set("canvas", snapshot.workspace.canvasId);
    window.history.replaceState(null, "", url);
  }, [snapshot]);

  /** Leave the canvas on screen: nothing of it stays open over the next one.
   *  Only the display is put down — no Pi session is closed or stopped. A
   *  view moved just before leaving is saved on the way out rather than
   *  dropped with the timer that was still waiting to save it. */
  const leaveCanvas = useCallback(async () => {
    if (viewSaveTimer.current) {
      clearTimeout(viewSaveTimer.current);
      viewSaveTimer.current = null;
      await patch({ view });
    }
    setSnapshot(null);
    leavePanel(); setSelectedId(null); setOpenTicket(null); setPendingTicket(null); setTree(null); setPicked([]);
    setPanelKey(k => k + 1);
    setError(""); setNotice("");
  }, [leavePanel, patch, view]);

  /** Open another working directory. Which canvas it shows is that
   *  directory's own business: it comes back to the one it was left on. The
   *  directory is read before anything moves, so a path that is not there
   *  says so and leaves the canvas on screen where it was. */
  const openWorkspace = useCallback(async (next: string) => {
    try {
      const res = await fetch(`/api/waygoal?cwd=${encodeURIComponent(next)}&force=1`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      await leaveCanvas();
      setCwd(next);
      setCanvasId(null);
      setSnapshot(body as WaygoalSnapshotResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [leaveCanvas]);

  const switchCanvas = useCallback(async (next: string) => {
    await leaveCanvas();
    setCanvasId(next);
  }, [leaveCanvas]);

  useEffect(() => {
    if (!snapshot?.cwd) return;
    const controller = new AbortController();
    fetch(`/api/project-trust?cwd=${encodeURIComponent(snapshot.cwd)}`, { signal: controller.signal })
      .then(r => r.ok ? r.json() : null).then(data => { if (data) setTrust(data); }).catch(() => {});
    return () => controller.abort();
  }, [snapshot?.cwd]);

  // Restore view, the last viewed session and the position inside it, once per
  // workspace. Reading only: opening a panel loads history and never sends.
  useEffect(() => {
    if (!snapshot) return;
    const place = `${snapshot.cwd}|${snapshot.workspace.canvasId}`;
    if (restoredFor.current === place) return;
    restoredFor.current = place;
    viewDirty.current = false;
    setView(snapshot.view ?? DEFAULT_VIEW);
    leavePanel(); setTree(null);
    if (snapshot.lastViewed && !snapshot.lastViewedMissing) {
      setSelectedId(snapshot.lastViewed);
      pendingRestoreEntry.current = snapshot.lastViewedEntry;
      setPanelKey(k => k + 1);
    } else {
      setSelectedId(null);
      pendingRestoreEntry.current = null;
      if (snapshot.lastViewedMissing) setNotice("上次查看的会话已不在这个工作目录里，没有自动绑定到其他会话。");
    }
  }, [leavePanel, snapshot]);

  useEffect(() => {
    if (!viewDirty.current || !snapshot?.cwd) return;
    if (viewSaveTimer.current) clearTimeout(viewSaveTimer.current);
    viewSaveTimer.current = setTimeout(() => { void patch({ view }); }, 500);
    return () => { if (viewSaveTimer.current) clearTimeout(viewSaveTimer.current); };
  }, [view, patch, snapshot?.cwd]);

  // The real branch structure of the open session, read straight from its Pi
  // tree. Polled so a message sent in the panel moves the continue marker.
  const loadTree = useCallback(async (sessionId: string) => {
    try {
      const res = await fetch(`/api/waygoal/session/${encodeURIComponent(sessionId)}`, { cache: "no-store" });
      if (!res.ok) { setTree(null); return; }
      setTree(await res.json() as WaygoalSessionTreeResponse);
    } catch { setTree(null); }
  }, []);

  const openSessionId = selectedId ?? createdSession?.id ?? null;
  useEffect(() => {
    if (!openSessionId) { setTree(null); return; }
    setTree(t => t?.sessionId === openSessionId ? t : null);
    void loadTree(openSessionId);
    const timer = setInterval(() => { if (document.visibilityState === "visible") void loadTree(openSessionId); }, 2500);
    return () => clearInterval(timer);
  }, [openSessionId, loadTree]);

  // A restored reading position must still exist in this session's real tree.
  // A position that is gone stays gone — a similar title is not the same history.
  useEffect(() => {
    const entryId = pendingRestoreEntry.current;
    if (!entryId || !openSessionId) return;
    pendingRestoreEntry.current = null;
    const sessionId = openSessionId;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/waygoal/session/${encodeURIComponent(sessionId)}?entry=${encodeURIComponent(entryId)}`, { cache: "no-store" });
        const body = await res.json() as WaygoalSessionTreeResponse & { entryFound?: boolean };
        if (cancelled) return;
        if (res.ok && body.entryFound) {
          const choice = flattenChoices(body.branchPoints ?? []).find(c => c.choice.entryId === entryId)?.choice;
          setViewing({ sessionId, entryId, leafId: choice?.leafId ?? null, label: "上次看的这条" });
        }
        else {
          setNotice("上次看的那条消息在这段会话里已经找不到了，画布没有按标题绑到别的历史，面板停在这段会话现在在聊的那条路径。");
          void patch({ lastViewedEntry: null });
        }
      } catch { /* the panel still opens at the continue position */ }
    })();
    return () => { cancelled = true; };
  }, [openSessionId, patch]);


  const nodes = useMemo(() => (snapshot?.nodes ?? []).map(node => ({ ...node, position: dragging[node.id] ?? node.position })), [snapshot, dragging]);
  // Map and ticket cards, laid out from the same record as the session cards
  // and dragged by the same handlers.
  const ticketMaps = useMemo(() => (snapshot?.tickets.maps ?? []).map(map => ({
    ...map,
    position: dragging[map.path] ?? map.position,
    tickets: map.tickets.map(ticket => ({ ...ticket, position: dragging[ticket.id] ?? ticket.position })),
  })), [snapshot, dragging]);
  const ticketCount = ticketMaps.reduce((total, map) => total + map.tickets.length, 0);
  const groups = useMemo(() => (snapshot?.groups ?? []).map(group => ({ ...group, position: dragging[group.id] ?? group.position })), [snapshot, dragging]);
  // A collapsed group stands in for its members: they are not drawn, and
  // neither is any line that would end on one. Nothing about them changes.
  const tucked = useMemo(() => new Set(groups.filter(group => group.collapsed).flatMap(group => group.members)), [groups]);
  // Directories under .scratch/ that were not read as maps. Saying so on the
  // canvas is the point: a silently skipped directory looks like an empty one.
  const skipped = [...(snapshot?.tickets.unsupported ?? []), ...(snapshot?.tickets.unreadable ?? [])];
  // Which ticket a discussion is held under, read from the same snapshot.
  const ticketOfSession = useMemo(() => new Map(ticketMaps.flatMap(map =>
    map.tickets.flatMap(ticket => ticket.discussions.map(talk => [talk.sessionId, ticket.id] as const)))), [ticketMaps]);
  // Every card on the canvas, in the one shape finding, 回到全景 and the
  // thumbnail all read. A ticket's title comes from its source file: renaming
  // happens to Pi sessions only, never to a ticket.
  const cards = useMemo<WaygoalCard[]>(() => {
    // A card inside a collapsed group is not drawn on its own, so finding it,
    // 回到全景 and the thumbnail all point at the group card standing there
    // instead. It is still findable under its own title: it is still here.
    const standIn = new Map(groups.filter(group => group.collapsed).flatMap(group => group.members.map(member => [member, group] as const)));
    const placed = (card: WaygoalCard): WaygoalCard => {
      const group = standIn.get(card.id);
      return group ? { ...card, position: group.position, height: NODE_H } : card;
    };
    return [
      ...nodes.map(node => placed({ id: node.id, title: node.title, kind: "session" as const, position: node.position, height: NODE_H, modified: node.modified })),
      ...ticketMaps.flatMap(map => [
        placed({ id: map.path, title: map.title, kind: "map" as const, position: map.position, height: NODE_H, modified: null }),
        ...map.tickets.map(ticket => placed({
          id: ticket.id, title: ticket.title, kind: "ticket" as const, position: ticket.position,
          height: ticket.expanded ? ticketCardHeight(ticket.discussions.length) : NODE_H, modified: null,
        })),
      ]),
      ...groups.filter(group => group.collapsed).map(group => ({
        id: group.id, title: group.name, kind: "group" as const, position: group.position, height: NODE_H, modified: null,
      })),
    ];
  }, [nodes, ticketMaps, groups]);
  const cardById = useMemo(() => new Map(cards.map(card => [card.id, card])), [cards]);
  // The card the record was left on, while it is still here.
  const continueCard = useMemo(() => (snapshot?.lastViewed && !snapshot.lastViewedMissing
    ? cards.find(card => card.id === snapshot.lastViewed) ?? null
    : null), [cards, snapshot]);

  // Whatever the panel just opened, brought back into view when opening the
  // panel — or going there before it had taken its room — left it outside. It
  // reads the viewport element rather than the tracked size: the panel takes
  // its room in the same commit, and the observer only reports it afterwards.
  const revealedFor = useRef<string | null>(null);
  useEffect(() => {
    const id = selectedId ?? openTicket;
    const el = viewportRef.current;
    if (!id || revealedFor.current === id || !el) return;
    const card = cards.find(c => c.id === id);
    if (!card) return;
    revealedFor.current = id;
    const viewport = { width: el.clientWidth, height: el.clientHeight };
    setView(v => {
      const left = card.position.x * v.scale + v.x, top = card.position.y * v.scale + v.y;
      const right = left + NODE_W * v.scale, bottom = top + card.height * v.scale;
      const margin = 24;
      if (left >= margin && top >= margin && right <= viewport.width - margin && bottom <= viewport.height - margin) return v;
      return viewCenteredOn(cardCenter(card), v, viewport);
    });
  }, [selectedId, openTicket, cards]);

  const openTicketMap = openTicket ? ticketMaps.find(map => map.path === openTicket || map.tickets.some(t => t.id === openTicket)) ?? null : null;
  const openTicketCard = openTicketMap?.tickets.find(t => t.id === openTicket) ?? null;
  const pendingTicketTitle = pendingTicket
    ? ticketMaps.flatMap(map => map.tickets).find(ticket => ticket.id === pendingTicket)?.title ?? null
    : null;
  const nodeById = useMemo(() => new Map(nodes.map(node => [node.id, node])), [nodes]);
  const selectedNode = nodes.find(n => n.id === selectedId) ?? null;
  const panelSession: SessionInfo | null = selectedNode ? nodeToSession(selectedNode, snapshot!.cwd) : createdSession;
  const panelOpen = Boolean(panelSession || draftKey || openTicketMap);

  // Kept in a ref, not read from the closure: ChatWindow reports a fork
  // asynchronously, and the panel may already show something else by then.
  useEffect(() => { chatSessionId.current = panelSession?.id ?? null; }, [panelSession]);

  // Real fork relations between nodes of this workspace, as drawn edges.
  const originEdges = useMemo(() => nodes.flatMap(node => {
    const from = node.origin?.inWorkspace ? nodeById.get(node.origin.sessionId) : undefined;
    if (!from || from.id === node.id || tucked.has(node.id) || tucked.has(from.id)) return [];
    return [{ id: node.id, from: from.position, to: node.position, exact: Boolean(node.origin?.entryId) }];
  }), [nodes, nodeById, tucked]);

  // A ticket and its discussions, drawn so the relation survives dragging one
  // of them away. It is an association, not a fork and not a dependency.
  const ticketEdges = useMemo(() => ticketMaps.flatMap(map => map.tickets.flatMap(ticket =>
    ticket.discussions.flatMap(talk => {
      const node = nodeById.get(talk.sessionId);
      // Collapsed means this ticket is not spread out on the canvas: its lines
      // go quiet with its chips. The discussions are still held under it.
      const hidden = tucked.has(talk.sessionId) || tucked.has(ticket.id);
      return node && ticket.expanded && !hidden ? [{ id: `${ticket.id}->${talk.sessionId}`, from: ticket.position, to: node.position }] : [];
    }))), [ticketMaps, nodeById, tucked]);

  // Relations the user drew by hand. They are read from the record as written,
  // never derived: no fork history and no `Blocked by:` line produces one, and
  // removing one takes nothing else with it.
  const manualEdges = useMemo(() => (snapshot?.links ?? []).flatMap(link => {
    // A member of a collapsed group is drawn at the group's card, so the line
    // ends there rather than disappearing: the note on it is the only place the
    // relation can be read and removed, and it must stay reachable. Both ends
    // inside the same collapsed group is the one case with nothing to draw.
    const from = cardById.get(link.from), to = cardById.get(link.to);
    if (!from || !to || (from.position.x === to.position.x && from.position.y === to.position.y)) return [];
    const start = borderAnchor(from.position, to.position);
    const end = borderAnchor(to.position, from.position);
    return [{ id: link.id, note: link.note, start, end, mid: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 } }];
  }), [snapshot, cardById]);

  // A group is drawn as a frame around wherever its members currently sit, so
  // dragging a member reshapes the frame instead of breaking the grouping.
  const groupFrames = useMemo(() => groups.filter(group => !group.collapsed).flatMap(group => {
    const box = cardBounds(group.members.flatMap(id => { const card = cardById.get(id); return card ? [card] : []; }));
    // Room for the frame, and above it for the header carrying the name.
    return box ? [{ ...group, left: box.x - 18, top: box.y - 46, width: box.width + 36, height: box.height + 64 }] : [];
  }), [groups, cardById]);

  // The card grows when it carries origin or branch marks, so the chip stack
  // is placed under its measured height rather than the nominal one.
  const selectedElRef = useRef<HTMLButtonElement | null>(null);
  const [chipTop, setChipTop] = useState(NODE_H + CHIP_GAP);
  useEffect(() => {
    const el = selectedElRef.current;
    if (!el) { setChipTop(NODE_H + CHIP_GAP); return; }
    const update = () => setChipTop(el.offsetHeight + CHIP_GAP);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [selectedId, snapshot]);

  // The thumbnail and 定位 both need the viewport in screen pixels, and it
  // changes whenever the panel opens or the window is resized.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const update = () => setViewportSize({ width: el.clientWidth, height: el.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const selectedChoices = useMemo(
    () => (tree && tree.sessionId === selectedId ? flattenChoices(tree.branchPoints) : []),
    [tree, selectedId],
  );

  const busyReason = nodes.find(n => n.id === openSessionId)?.running
    ? "这段会话正在运行。分叉和在别的路径里接着说都要等它结束，Waygoal 不打断正在进行的任务；看历史不受影响。"
    : null;

  const openNode = useCallback((node: WaygoalNode) => {
    leavePanel(); setOpenTicket(null);
    setSelectedId(node.id);
    setPanelKey(k => k + 1);
    setNotice("");
    setPendingTicket(null);
    const ticket = ticketOfSession.get(node.id);
    void patch({ lastViewed: node.id, lastViewedEntry: null, ...(ticket ? { ticketLast: { ticket, sessionId: node.id, entryId: null } } : {}) });
  }, [leavePanel, patch, ticketOfSession]);

  /** Open one local map or ticket: a file this workspace already has. Reading
   *  it starts nothing — it is not a Pi session and has none of its own. */
  const openLocalTicket = useCallback((path: string) => {
    leavePanel(); setPendingTicket(null);
    setSelectedId(null);
    setOpenTicket(path);
    setOpenFile(null);
    setNotice("");
  }, [leavePanel]);

  /** Open a read-only reading position. Display only — no navigation.
   *  `leafId` is where a message sent from here would land, null when this
   *  position is not one to send from. */
  const viewPath = useCallback((sessionId: string, entryId: string | null, label: string, leafId: string | null) => {
    setNotice("");
    if (sessionId !== selectedId) {
      setDraftKey(null); setCreatedSession(null);
      setSelectedId(sessionId);
      setPanelKey(k => k + 1);
    }
    setViewing({ sessionId, entryId, leafId, label });
    // Reading is not talking: the ticket keeps pointing at the discussion the
    // user last talked in, not at whatever history they are looking through.
    void patch({ lastViewed: sessionId, lastViewedEntry: entryId });
  }, [patch, selectedId]);

  const stopViewing = useCallback(() => {
    setViewing(null);
    if (openSessionId) void patch({ lastViewed: openSessionId, lastViewedEntry: null });
  }, [openSessionId, patch]);

  const startNewChat = useCallback(() => {
    if (!snapshot) return;
    leavePanel(); setSelectedId(null); setOpenTicket(null); setPendingTicket(null);
    setDraftKey(`waygoal-new:${crypto.randomUUID()}:${snapshot.cwd}`);
    setPanelKey(k => k + 1);
    setNotice("");
  }, [leavePanel, snapshot]);

  /** Start a discussion under one ticket. Like the plain new chat, this only
   *  opens a composer: the draft is kept under the ticket's own key, so coming
   *  back — or clicking twice — lands on the same unsent draft instead of a
   *  second session, and nothing is held under the ticket until it is sent. */
  const startTicketChat = useCallback((ticketPath: string) => {
    if (!snapshot) return;
    leavePanel(); setSelectedId(null); setOpenTicket(null);
    setPendingTicket(ticketPath);
    // Hand the parked draft back before the composer mounts: it reads the
    // stored draft while rendering, so an effect would be a render too late.
    rekeyDraft(parkedTicketDraft(ticketPath, snapshot.cwd), liveTicketDraft(ticketPath, snapshot.cwd));
    setDraftKey(liveTicketDraft(ticketPath, snapshot.cwd));
    setPanelKey(k => k + 1);
    setNotice("");
  }, [leavePanel, snapshot]);

  const pendingCwd = snapshot?.cwd;
  useEffect(() => {
    if (!pendingTicket || !pendingCwd) return;
    const live = liveTicketDraft(pendingTicket, pendingCwd);
    const parked = parkedTicketDraft(pendingTicket, pendingCwd);
    return () => { rekeyDraft(live, parked); };
  }, [pendingTicket, pendingCwd]);

  const toggleTicket = useCallback((ticketPath: string, expanded: boolean) => {
    void patch({ ticketExpanded: { ticket: ticketPath, expanded } });
  }, [patch]);

  const closePanel = useCallback(() => {
    leavePanel(); setSelectedId(null); setOpenTicket(null); setOpenFile(null); setPendingTicket(null);
    viewportRef.current?.focus();
  }, [leavePanel]);

  const onSessionCreated = useCallback((session: SessionInfo) => {
    setCreatedSession(session);
    setSelectedId(session.id);
    const ticket = pendingTicket;
    setPendingTicket(null);
    void patch({
      // A chat started here belongs to this canvas and no other.
      registerSession: session.id,
      lastViewed: session.id, lastViewedEntry: null,
      ...(ticket ? { ticketSession: { sessionId: session.id, ticket }, ticketLast: { ticket, sessionId: session.id, entryId: null } } : {}),
    });
    void refresh(true);
  }, [patch, pendingTicket, refresh]);

  /** Land on a session that was just branched off, keeping where it came from. */
  const landOnFork = useCallback(async (newSessionId: string, originSessionId: string, originEntryId?: string) => {
    // The ticket comes along either way: with a message position the store
    // carries it over with the origin, and without one it is said outright, so
    // a fork Pi can only trace back to the session does not leave the ticket.
    const ticket = ticketOfSession.get(originSessionId);
    await patch({
      registerSession: newSessionId,
      ...(originEntryId ? { origin: { sessionId: newSessionId, originSessionId, originEntryId } }
        : ticket ? { ticketSession: { sessionId: newSessionId, ticket } } : {}),
    });
    leavePanel();
    setSelectedId(newSessionId);
    setPanelKey(k => k + 1);
    await patch({ lastViewed: newSessionId, lastViewedEntry: null });
    setNotice(originEntryId
      ? "已分出一段新会话。原来的讨论还在画布上，连线指向它分出的那条消息。"
      : "已分出一段新会话。这次没有记下具体消息位置，画布只显示来源会话。");
    await refresh(true);
  }, [leavePanel, patch, refresh, ticketOfSession]);

  /** The real Pi fork, from a message in the read-only view. */
  const forkFrom = useCallback(async (sessionId: string, entryId: string) => {
    setForkingEntryId(entryId);
    try {
      const res = await fetch(`/api/agent/${encodeURIComponent(sessionId)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "fork", entryId }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      const newSessionId = (body.data as { newSessionId?: string } | undefined)?.newSessionId;
      if (!newSessionId) throw new Error("这段历史还没有保存，暂时不能从这里分叉。");
      await landOnFork(newSessionId, sessionId, entryId);
    } catch (e) {
      setError(`分叉没有完成：${e instanceof Error ? e.message : String(e)}`);
    } finally { setForkingEntryId(null); }
  }, [landOnFork]);

  /** The one action that moves the agent: continue this session in one path. */
  const continueAt = useCallback(async (sessionId: string, entryId: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/agent/${encodeURIComponent(sessionId)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "navigate_tree", targetId: entryId }),
      });
      const body = await res.json() as { error?: string; data?: { cancelled?: boolean } };
      if (!res.ok) throw new Error(body.error);
      // Pi can refuse the move (an extension cancelled it, a summary aborted).
      if (body.data?.cancelled) { setNotice("没能接着这条聊，Pi 取消了这次切换。"); return false; }
      setViewing(null);
      setSelectedId(sessionId);
      setPanelKey(k => k + 1);
      setNotice("现在在这条路径里继续，其他路径都还留着。");
      await patch({ lastViewed: sessionId, lastViewedEntry: null });
      await loadTree(sessionId);
      await refresh(true);
      return true;
    } catch (e) {
      setError(`没能接着这条聊：${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }, [loadTree, patch, refresh]);

  /** Sending from a path being read is the explicit choice: move the session
   *  onto it, then let ChatWindow send the message there. Nothing is sent if
   *  the move fails, so a message cannot land on the path the user left. */
  const continueAndSend = useCallback(async (sessionId: string, leafId: string, text: string) => {
    if (!(await continueAt(sessionId, leafId))) return;
    // Sending is what makes this the discussion — and the path — being talked in.
    const ticket = ticketOfSession.get(sessionId);
    if (ticket) await patch({ ticketLast: { ticket, sessionId, entryId: leafId } });
    setPending(text);
  }, [continueAt, patch, ticketOfSession]);

  const zoomBy = useCallback((factor: number, center?: WaygoalPoint) => {
    viewDirty.current = true;
    setView(v => {
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor));
      if (!center) return { ...v, scale };
      const ratio = scale / v.scale;
      return { x: center.x - (center.x - v.x) * ratio, y: center.y - (center.y - v.y) * ratio, scale };
    });
  }, []);

  /** 回到全景 means the whole canvas: session cards and ticket cards alike, and
   *  a ticket takes as much room as the discussions shown under it. */
  const fitAll = useCallback(() => {
    viewDirty.current = true;
    const box = cardBounds(cards);
    if (!box || viewportSize.width === 0) { setView(DEFAULT_VIEW); return; }
    const scale = Math.min(1, Math.max(MIN_SCALE, Math.min((viewportSize.width - 96) / box.width, (viewportSize.height - 96) / box.height)));
    setView(viewCenteredOn({ x: box.x + box.width / 2, y: box.y + box.height / 2 }, { ...DEFAULT_VIEW, scale }, viewportSize));
  }, [cards, viewportSize]);

  /** Move the view so a place on the canvas sits in the middle. Locating is
   *  only that: no session is opened, nothing is sent, and which path a
   *  session would continue on does not change. */
  const moveTo = useCallback((point: WaygoalPoint) => {
    viewDirty.current = true;
    setView(v => viewCenteredOn(point, v, viewportSize));
  }, [viewportSize]);

  /** A hit in 查找: go to it and open it. Opening reads — it does not send. */
  const goToCard = useCallback((card: WaygoalCard) => {
    moveTo(cardCenter(card));
    if (card.kind === "session") {
      const node = nodes.find(n => n.id === card.id);
      if (node) openNode(node);
    } else openLocalTicket(card.id);
  }, [moveTo, nodes, openNode, openLocalTicket]);

  const thumb = useMemo(
    () => (viewportSize.width > 0 ? thumbnail(cards, view, viewportSize, THUMB) : null),
    [cards, view, viewportSize],
  );

  const nudge = useCallback((id: string, from: WaygoalPoint, dx: number, dy: number) => {
    const position = { x: from.x + dx, y: from.y + dy };
    setDragging(d => ({ ...d, [id]: position }));
    void patch({ positions: { [id]: position } }).then(() => refresh()).then(() => setDragging(d => without(d, id)));
  }, [patch, refresh]);
  /** Arrow keys move a card the way dragging does, for every kind of card. */
  const onCardKeyDown = (id: string, position: WaygoalPoint) => (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 50 : 10;
    const moves: Record<string, WaygoalPoint> = { ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 }, ArrowUp: { x: 0, y: -step }, ArrowDown: { x: 0, y: step } };
    if (moves[e.key]) { e.preventDefault(); e.stopPropagation(); nudge(id, position, moves[e.key].x, moves[e.key].y); }
    else if (e.key === "Escape" && panelOpen) { e.preventDefault(); closePanel(); }
  };

  const togglePick = useCallback((id: string) => {
    setPicked(current => (current.includes(id) ? current.filter(other => other !== id) : [...current, id]));
  }, []);
  /** Group the picked cards under a name the user typed. It writes one line of
   *  the canvas record: no session is started and no context is shared. */
  const createGroup = useCallback(async (name: string) => {
    await patch({ addGroup: { name, members: picked } });
    setPicked([]);
    await refresh(true);
  }, [patch, picked, refresh]);
  const createLink = useCallback(async (note: string) => {
    const [from, to] = picked;
    if (!from || !to) return;
    await patch({ addLink: { from, to, note } });
    setPicked([]);
    await refresh(true);
  }, [patch, picked, refresh]);
  /** Go where the source itself says to go. A ticket in this map opens its own
   *  card; a file in this working directory is read in the panel. Nothing is
   *  looked up by name or by likeness: only what the source wrote as a link
   *  gets here, and a place that cannot be reached never becomes a button. */
  const openReference = useCallback((reference: WaygoalReference) => {
    if (!canOpen(reference) || !reference.path) return;
    if (reference.kind === "ticket") openLocalTicket(reference.path);
    else if (snapshot?.cwd) setOpenFile(`${snapshot.cwd}/${reference.path}`);
  }, [openLocalTicket, snapshot?.cwd]);

  /** Everything a group frame or a manual link offers is one patch and a read;
   *  Pi's history, the active leaf and the tracker files are never touched. */
  const arrange = useCallback(async (body: WaygoalCanvasPatch) => {
    await patch(body);
    await refresh(true);
  }, [patch, refresh]);

  const onViewportPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("[data-node], [data-chip]")) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { start: { x: e.clientX, y: e.clientY }, origin: { x: view.x, y: view.y }, moved: false, pointerId: e.pointerId };
  };
  /** Take hold of one card to drag it. The drag ends in the same handlers
   *  as a viewport pan, so the three kinds of card share this one start. */
  const onCardPointerDown = (id: string, origin: WaygoalPoint) => (e: React.PointerEvent<HTMLElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id, start: { x: e.clientX, y: e.clientY }, origin, moved: false, pointerId: e.pointerId };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const dx = e.clientX - d.start.x, dy = e.clientY - d.start.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
    if (d.id) setDragging(p => ({ ...p, [d.id!]: { x: d.origin.x + dx / view.scale, y: d.origin.y + dy / view.scale } }));
    else { viewDirty.current = true; setView(v => ({ ...v, x: d.origin.x + dx, y: d.origin.y + dy })); }
  };
  const onPointerUp = (e: React.PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    if (d.id && d.moved) {
      const id = d.id;
      const position = dragging[id];
      if (position) void patch({ positions: { [id]: { x: Math.round(position.x), y: Math.round(position.y) } } }).then(() => refresh()).then(() => setDragging(p => without(p, id)));
    } else if (d.id) {
      setDragging(p => without(p, d.id!));
    }
    // Let the click that follows a drag see `moved` before clearing.
    setTimeout(() => { drag.current = null; }, 0);
  };

  const onViewportKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const step = e.shiftKey ? 160 : 40;
    const moves: Record<string, WaygoalPoint> = { ArrowLeft: { x: step, y: 0 }, ArrowRight: { x: -step, y: 0 }, ArrowUp: { x: 0, y: step }, ArrowDown: { x: 0, y: -step } };
    if (moves[e.key]) { e.preventDefault(); viewDirty.current = true; setView(v => ({ ...v, x: v.x + moves[e.key].x, y: v.y + moves[e.key].y })); }
    else if (e.key === "+" || e.key === "=") { e.preventDefault(); zoomBy(1.15); }
    else if (e.key === "-") { e.preventDefault(); zoomBy(1 / 1.15); }
    else if (e.key === "0") { e.preventDefault(); fitAll(); }
    else if (e.key === "Escape" && panelOpen) { e.preventDefault(); closePanel(); }
  };

  const cwdName = snapshot?.cwd.split("/").filter(Boolean).at(-1) ?? "";
  const runningCount = nodes.filter(n => n.running).length;
  const branchNodeCount = nodes.filter(n => n.branchPointCount > 0).length;
  const panelOrigin = selectedNode?.origin ?? null;

  return <main className="waygoal-app" data-panel-open={panelOpen || undefined}>
    <header className="waygoal-top">
      <div className="waygoal-brand">waygoal<span>.</span></div>
      <WaygoalWorkspaceBar workspace={snapshot?.workspace ?? null} onOpen={openWorkspace} onSwitchCanvas={switchCanvas} onError={setError} />
      <div className="waygoal-top-right">
        <button type="button" className="waygoal-button action" onClick={startNewChat} disabled={!snapshot}>新开聊天</button>
      </div>
    </header>
    {error && <div role="alert" className="waygoal-alert">{error}<button type="button" aria-label="关闭错误" onClick={() => setError("")}>×</button></div>}
    {notice && <div role="status" className="waygoal-notice">{notice}<button type="button" aria-label="关闭提示" onClick={() => setNotice("")}>×</button></div>}
    {trust?.requiresTrust && !trust.trusted && snapshot && <div role="status" className="waygoal-notice">这个目录带有项目级 skills 或扩展；Pi 需要你确认信任后才会加载它们。
      <button type="button" className="waygoal-button outlined small" onClick={() => void fetch("/api/project-trust", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd: snapshot.cwd }) }).then(r => r.json()).then(setTrust)}>信任此目录</button></div>}
    <div className="waygoal-stage">
      <section className="waygoal-canvas-area" aria-label="会话画布区域">
        <div className="waygoal-toolbar">
          <h1>{cwdName || "会话画布"}</h1>
          <span className="waygoal-count">{snapshot ? `${nodes.length} 段会话${ticketCount ? ` · ${ticketCount} 张本地票据` : ""}${branchNodeCount ? ` · ${branchNodeCount} 段有会话内分叉` : ""}${runningCount ? ` · ${runningCount} 段正在运行` : ""}` : "正在读取…"}</span>
          {skipped.length > 0 && <span className="waygoal-count waygoal-skipped" title={skipped.map(s => `${s.path}：${s.reason}`).join("\n")}>
            {skipped.length} 个目录没有读成地图：{skipped.map(s => s.path).join("、")}
          </span>}
          <WaygoalFind cards={cards} onGo={goToCard} />
          <WaygoalArrange picked={picked.flatMap(id => { const card = cardById.get(id); return card ? [{ id, title: card.title }] : []; })}
            onGroup={createGroup} onLink={createLink} onClear={() => setPicked([])} />
          {picked.length === 0 && cards.length >= 2 && <span className="waygoal-count">按住 ⌘/Ctrl 点卡片，可以圈成分组或连一条关联</span>}
          {/* One step back to what the canvas restores on load. 看 and 在聊 are
              two different things (票 #3), and this entry is the 看 one. */}
          {continueCard && <button type="button" data-continue className="waygoal-button outlined small"
            onClick={() => goToCard(continueCard)}>回到上次看的地方</button>}
          <div className="waygoal-zoom" role="group" aria-label="缩放">
            <button type="button" aria-label="缩小" onClick={() => zoomBy(1 / 1.15)}>−</button>
            <span aria-live="polite">{Math.round(view.scale * 100)}%</span>
            <button type="button" aria-label="放大" onClick={() => zoomBy(1.15)}>+</button>
            <button type="button" onClick={fitAll}>回到全景</button>
          </div>
        </div>
        <div ref={viewportRef} className="waygoal-viewport" tabIndex={0} aria-label="会话画布：方向键平移，+ − 缩放，0 回到全景" role="region"
          onWheel={e => zoomBy(e.deltaY > 0 ? 0.92 : 1.08, { x: e.clientX - e.currentTarget.getBoundingClientRect().left, y: e.clientY - e.currentTarget.getBoundingClientRect().top })}
          onPointerDown={onViewportPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onKeyDown={onViewportKeyDown}>
          <div className={`waygoal-world${drag.current ? " dragging" : ""}`} style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}>
            <svg className="waygoal-links" width="1" height="1" aria-hidden="true">
              {originEdges.map(edge => {
                const start = borderAnchor(edge.from, edge.to);
                const end = borderAnchor(edge.to, edge.from);
                const mx = (start.x + end.x) / 2, my = (start.y + end.y) / 2;
                const label = edge.exact ? "分叉自这条消息" : "分叉自这段会话";
                // Cards the user dragged close together leave no room between
                // them; a label that would run under a card is dropped, and the
                // card's own 「分叉自「…」」 mark still says where it came from.
                const gap = Math.hypot(end.x - start.x, end.y - start.y);
                return <g key={`origin-${edge.id}`} className="waygoal-link">
                  <path d={`M ${start.x} ${start.y} L ${end.x} ${end.y}`} />
                  <circle cx={end.x} cy={end.y} r={4.5} />
                  {gap >= label.length * LINK_LABEL_CHAR_W + 16
                    && <text x={mx} y={my - 9} textAnchor="middle">{label}</text>}
                </g>;
              })}
              {ticketEdges.map(edge => {
                const start = borderAnchor(edge.from, edge.to);
                const end = borderAnchor(edge.to, edge.from);
                return <g key={`ticket-${edge.id}`} className="waygoal-link ticket">
                  <path d={`M ${start.x} ${start.y} L ${end.x} ${end.y}`} />
                  <circle cx={end.x} cy={end.y} r={4.5} />
                </g>;
              })}
              {/* Drawn by hand, so drawn differently: a solid line with a dot at
                  each end and no direction claimed. A fork's line says where a
                  history came from; this one says only what the user said. */}
              {manualEdges.map(edge => <g key={`manual-${edge.id}`} className="waygoal-link manual" data-link-line={edge.id}>
                <path d={`M ${edge.start.x} ${edge.start.y} L ${edge.end.x} ${edge.end.y}`} />
                <circle cx={edge.start.x} cy={edge.start.y} r={4.5} />
                <circle cx={edge.end.x} cy={edge.end.y} r={4.5} />
              </g>)}
            </svg>
            {/* The note rides on the line, and is where the relation is taken
                away again. Removing it removes the line and nothing else. */}
            {manualEdges.map(edge => <div key={`note-${edge.id}`} data-link={edge.id} className="waygoal-link-note"
              style={{ left: edge.mid.x, top: edge.mid.y }} onPointerDown={e => e.stopPropagation()}>
              <span>{edge.note || "手动关联"}</span>
              <button type="button" data-link-remove={edge.id} aria-label={`删掉这条手动关联${edge.note ? `：${edge.note}` : ""}`}
                onClick={e => { e.stopPropagation(); void arrange({ removeLink: edge.id }); }}>×</button>
            </div>)}
            {/* A frame around the cards the user said belong together. It draws
                nothing of its own: the members are the same cards as before. */}
            {groupFrames.map(frame => <div key={frame.id} data-group={frame.id} className="waygoal-group"
              style={{ left: frame.left, top: frame.top, width: frame.width, height: frame.height }}>
              <div className="waygoal-group-head" onPointerDown={e => e.stopPropagation()}>
                <strong>{frame.name}</strong>
                <span>{frame.members.length} 个</span>
                <button type="button" data-group-collapse={frame.id} className="waygoal-button outlined small"
                  onClick={() => void arrange({ groupCollapsed: { group: frame.id, collapsed: true } })}>收起</button>
                <button type="button" data-group-remove={frame.id} className="waygoal-button outlined small"
                  onClick={() => void arrange({ removeGroup: frame.id })}>解散</button>
              </div>
            </div>)}
            {/* Collapsed: one named card standing for the group. Opening it puts
                the very same cards back, at the very same places. */}
            {groups.filter(group => group.collapsed).map(group => <button key={group.id} type="button" data-node={group.id} data-group-card={group.id}
              className="waygoal-group-card" style={{ left: group.position.x, top: group.position.y }}
              aria-label={`分组：${group.name}，${group.members.length} 个节点，展开进入原节点`}
              onPointerDown={onCardPointerDown(group.id, group.position)}
              onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
              onClick={() => { if (!drag.current?.moved) void arrange({ groupCollapsed: { group: group.id, collapsed: false } }); }}
              onKeyDown={onCardKeyDown(group.id, group.position)}>
              <span className="waygoal-node-meta"><span>分组</span><span className="waygoal-node-state">{group.members.length} 个节点</span></span>
              <strong>{group.name}</strong>
              <span className="waygoal-node-foot"><span>里面的会话原样还在</span><span aria-hidden="true">展开 →</span></span>
            </button>)}
            {nodes.filter(node => !tucked.has(node.id)).map(node => <button key={node.id} type="button" data-node={node.id}
              ref={node.id === selectedId ? selectedElRef : undefined}
              className={`waygoal-node${node.id === selectedId ? " selected" : ""}${node.running ? " running" : ""}${viewing?.sessionId === node.id ? " viewing" : ""}${picked.includes(node.id) ? " picked" : ""}`}
              style={{ left: node.position.x, top: node.position.y }}
              aria-pressed={node.id === selectedId}
              aria-label={`${node.title}${node.running ? "，正在运行" : ""}${node.branchPointCount ? `，${node.branchPointCount} 处会话内分叉` : ""}${node.origin ? "，有分叉来源" : ""}`}
              onPointerDown={onCardPointerDown(node.id, node.position)}
              onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
              onClick={e => {
                if (drag.current?.moved) return;
                // Holding a modifier picks the card for grouping or linking
                // instead of opening it: picking opens nothing and sends nothing.
                if (e.metaKey || e.ctrlKey) { togglePick(node.id); return; }
                openNode(node);
              }}
              onKeyDown={onCardKeyDown(node.id, node.position)}>
              <span className="waygoal-node-meta"><span>{node.titleSource === "name" ? "会话" : node.titleSource === "fallback" ? "未命名 · 首条消息" : "未命名"}</span><span className="waygoal-node-state">{node.running ? <><i aria-hidden="true" /> 正在运行</> : relativeTime(node.modified)}</span></span>
              <strong>{node.title}</strong>
              {(node.origin || node.branchPointCount > 0) && <span className="waygoal-node-marks">
                {node.origin && <span className="waygoal-tag origin">{node.origin.inWorkspace ? `分叉自「${node.origin.title}」` : "分叉自其他工作目录"}</span>}
                {node.branchPointCount > 0 && <span className="waygoal-tag branch">{node.branchPointCount} 处会话内分叉</span>}
              </span>}
              <span className="waygoal-node-foot"><span>{node.messageCount ? `${node.messageCount} 条消息` : "还没有消息"}</span><span aria-hidden="true">{node.id === selectedId ? "正在查看" : "打开 →"}</span></span>
            </button>)}
            {/* Local maps and their tickets, read from this workspace's own
                files. Opening one only reads it: no Pi session is started. */}
            {ticketMaps.map(map => <div key={map.path} className="waygoal-ticket-group">
              {[{ id: map.path, title: map.title, position: map.position, stale: map.stale, kind: mapKind(map.remote),
                  extra: " map", label: mapKind(map.remote), state: "", ticketState: null, lit: false, marks: null, foot: `${map.tickets.length} 张票据` },
                ...map.tickets.map(ticket => ({
                  id: ticket.id, title: ticket.title, position: ticket.position, stale: ticket.stale, kind: ticketKind(Boolean(ticket.remote)),
                  extra: "", label: `票据 ${ticket.number}`, state: ticket.type,
                  ticketState: ticket.state,
                  // Only the snapshot that first sees it stop waiting says so;
                  // what the card reads then is what it goes on reading.
                  lit: ticket.justUnblocked,
                  marks: <>
                    <span className={`waygoal-tag ${stateClass(ticket.state)}`}>{ticket.status}</span>
                    {/* What the source concluded and what its relations say are
                        two facts, shown as two marks: a ticket closed while it
                        still names an unmet premise says both. */}
                    {ticket.blocked && <span className="waygoal-tag waiting">{ticket.blockers.some(needsCheck) ? "依赖要核对" : "被依赖挡着"}</span>}
                    {ticket.state === "unblocked" && ticket.blockers.length > 0 && <span className="waygoal-tag unblocked">前提都满足了</span>}
                    {/* Delivered but never read: the card stays, and says so
                        rather than showing anything as the source's own. */}
                    {ticket.remote && !ticket.remote.capturedAt && <span className="waygoal-tag unknown" data-unsynced>未同步</span>}
                  </>,
                  foot: ticket.question.slice(0, 28) || "还没写下要解决的问题",
                }))]
                .filter(card => !tucked.has(card.id))
                .map(card => <button key={card.id} type="button" data-node={card.id}
                  data-state={card.ticketState ?? undefined} data-unblocked={card.lit ? "true" : undefined}
                  className={`waygoal-ticket-card${card.extra}${openTicket === card.id ? " selected" : ""}${card.stale ? " stale" : ""}${card.lit ? " unblocked" : ""}${picked.includes(card.id) ? " picked" : ""}`}
                  style={{ left: card.position.x, top: card.position.y }}
                  aria-pressed={openTicket === card.id}
                  aria-label={`${card.kind}：${card.title}${card.stale ? "，读不到来源文件" : ""}`}
                  onPointerDown={onCardPointerDown(card.id, card.position)}
                  onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
                  onClick={e => {
                    if (drag.current?.moved) return;
                    if (e.metaKey || e.ctrlKey) { togglePick(card.id); return; }
                    openLocalTicket(card.id);
                  }}>
                  <span className="waygoal-node-meta">
                    <span>{card.label}</span>
                    <span className="waygoal-node-state">{card.stale ? "读不到来源" : card.state}</span>
                  </span>
                  <strong>{card.title}</strong>
                  {card.marks && <span className="waygoal-node-marks">{card.marks}</span>}
                  <span className="waygoal-node-foot"><span>{card.foot}</span><span aria-hidden="true">{openTicket === card.id ? "正在看" : "打开 →"}</span></span>
                </button>)}
              {/* Every ticket of this map has been read and closed. That is a
                  moment to check the map against its own destination, not proof
                  that the map is done: the note asks, opens nothing by itself,
                  sends nothing and writes nothing to the source. */}
              {map.check && !map.check.dismissed && !tucked.has(map.path) && <div className="waygoal-map-check" role="note"
                data-map-check={map.path} style={{ left: map.position.x + NODE_W + 16, top: map.position.y }}
                onPointerDown={e => e.stopPropagation()}>
                <p>这张地图的决策票都已关闭。可以检查一下：还有未澄清的问题吗？通往目的地的路是否已经清楚？</p>
                <p className="waygoal-map-check-note">如果目的地是形成方案，可以主动使用 /to-spec；也可以确认决策，或按原定目的地选择下一步。</p>
                {map.check.cancelled > 0 && <p className="waygoal-map-check-note">
                  其中 {map.check.cancelled} 张是取消或移出范围的。全部关闭只是检查的时机，取消不算做成的结论。
                </p>}
                <div className="waygoal-map-check-acts">
                  <button type="button" className="waygoal-button outlined small" data-map-check-view={map.path}
                    onClick={e => { e.stopPropagation(); openLocalTicket(map.path); }}>查看地图</button>
                  <button type="button" className="waygoal-button outlined small" data-map-check-dismiss={map.path}
                    onClick={e => { e.stopPropagation(); void arrange({ mapCheck: { map: map.path, dismissed: true } }); }}>知道了</button>
                </div>
              </div>}
              {/* The discussions held under each ticket, right below it: the
                  tickets stay laid out flat, no container wraps them. */}
              {map.tickets.filter(ticket => !tucked.has(ticket.id)).map(ticket => <Fragment key={`talks-${ticket.id}`}>
                {ticket.discussions.length > 0 && <button type="button" data-talk-toggle={ticket.id}
                  className="waygoal-chip toggle" style={{ left: ticket.position.x, top: ticket.position.y + ticketChipTop(0), width: NODE_W }}
                  onPointerDown={e => e.stopPropagation()}
                  onClick={e => { e.stopPropagation(); toggleTicket(ticket.id, !ticket.expanded); }}>
                  <span className="waygoal-chip-label">{ticket.discussions.length} 段讨论</span>
                  <span className="waygoal-chip-preview">{ticket.expanded ? "收起" : "展开"}</span>
                </button>}
                {ticket.expanded && ticket.discussions.map((talk, index) => <button key={talk.sessionId} type="button" data-talk={talk.sessionId}
                  className={`waygoal-chip${selectedId === talk.sessionId ? " viewing" : ""}${talk.missing ? " missing" : ""}`}
                  style={{ left: ticket.position.x, top: ticket.position.y + ticketChipTop(index + 1), width: NODE_W }}
                  onPointerDown={e => e.stopPropagation()}
                  disabled={talk.missing}
                  title={talk.missing ? "这段讨论已经不在了" : "打开这段讨论"}
                  onClick={e => { e.stopPropagation(); const node = nodeById.get(talk.sessionId); if (node) openNode(node); }}>
                  <span className="waygoal-chip-label">{talk.missing ? "打不开" : "讨论"}</span>
                  <span className="waygoal-chip-preview">{talk.title}</span>
                </button>)}
                {ticket.expanded && <button type="button" data-talk-start={ticket.id}
                  className="waygoal-chip start"
                  style={{ left: ticket.position.x, top: ticket.position.y + ticketChipTop(ticket.discussions.length ? ticket.discussions.length + 1 : 0), width: NODE_W }}
                  onPointerDown={e => e.stopPropagation()}
                  onClick={e => { e.stopPropagation(); startTicketChat(ticket.id); }}>
                  <span className="waygoal-chip-label">＋</span>
                  <span className="waygoal-chip-preview">{ticket.discussions.length ? "另开一段讨论" : "还没有讨论，开始聊"}</span>
                </button>}
              </Fragment>)}
            </div>)}
            {/* In-session paths of the open node, so branches stay findable on the
                canvas and not only inside the chat panel. Clicking one reads it. */}
            {selectedNode && selectedChoices.map(({ choice, order }, index) => <button key={`chip-${choice.entryId}`} type="button" data-chip={choice.entryId}
              className={`waygoal-chip${choice.active ? " active" : ""}${viewing?.entryId === choice.entryId ? " viewing" : ""}`}
              style={{ left: selectedNode.position.x, top: selectedNode.position.y + chipTop + index * CHIP_HEIGHT, width: NODE_W }}
              onPointerDown={e => e.stopPropagation()}
              onClick={e => { e.stopPropagation(); viewPath(selectedNode.id, choice.entryId, `会话内路径 ${order + 1}`, choice.leafId); }}
              title="点开这段历史，直接接着说">
              <span className="waygoal-chip-label">路径 {order + 1}</span>
              <span className="waygoal-chip-preview">{choice.preview}</span>
              {viewing?.entryId === choice.entryId && <span className="waygoal-tag reading">正在看</span>}
              {choice.active && <span className="waygoal-tag continuing">在聊这条</span>}
            </button>)}
            {/* Only when there is nothing at all to look at: with tickets on the
                canvas this box would sit on top of them. */}
            {snapshot && nodes.length === 0 && ticketMaps.length === 0 && <div className="waygoal-empty" style={{ left: 0, top: 0 }}>
              <strong>这个目录还没有 Pi 会话。</strong>
              <p>点「新开聊天」开始一段讨论；已有的 Pi 会话会按真实身份出现在这里。不需要 Git 仓库、票据或特定 skill。</p>
            </div>}
          </div>
        </div>
        {thumb && <div className="waygoal-thumb-box">
          {/* Where everything sits and where the user is looking. Clicking only
              moves the view: no session is opened and nothing is sent. */}
          <button type="button" data-thumb className="waygoal-thumb" aria-label="画布缩略图：点一下把视野移过去，用键盘按下则显示整张画布"
            style={{ width: THUMB.width, height: THUMB.height }}
            onClick={e => {
              // Activated from the keyboard there is no point to read, so it
              // means the whole canvas — the same as 回到全景 and the 0 key.
              if (e.detail === 0) { fitAll(); return; }
              const box = e.currentTarget.getBoundingClientRect();
              moveTo(worldPoint(thumb, { x: e.clientX - box.left, y: e.clientY - box.top }));
            }}>
            {thumb.cards.map(card => <span key={card.id} className={`waygoal-thumb-card ${card.kind}`} aria-hidden="true"
              style={{ left: card.x, top: card.y, width: Math.max(2, card.width), height: Math.max(2, card.height) }} />)}
            <span className="waygoal-thumb-view" data-thumb-view aria-hidden="true"
              style={{ left: thumb.view.x, top: thumb.view.y, width: thumb.view.width, height: thumb.view.height }} />
          </button>
        </div>}
        <div className="waygoal-statusline"><span>拖动卡片摆放 · 拖动空白处平移 · 滚轮缩放 · 点开路径只是看，说一句才在那条里继续</span><span className="waygoal-id">{snapshot?.workspaceId}</span></div>
      </section>
      {panelOpen && snapshot && <aside className="waygoal-panel" aria-label="讨论面板">
        <div className="waygoal-panel-head">
          {isMobile && <button type="button" className="waygoal-button outlined small" onClick={closePanel}>← 回到画布</button>}
          <div className="waygoal-panel-title">
            <span className="waygoal-eyebrow">{openTicketMap ? (openTicketCard ? ticketKind(Boolean(openTicketCard.remote)) : mapKind(openTicketMap.remote)) : viewing ? "正在看这条路径" : panelSession ? (selectedNode?.running ? "正在运行" : "已有会话") : pendingTicket ? "这张票下的新讨论" : "新的会话"}</span>
            <strong>{openTicketMap ? (openTicketCard?.title ?? openTicketMap.title)
              : panelSession ? (selectedNode?.title ?? createdSession?.firstMessage ?? "会话")
              : pendingTicket ? `${pendingTicketTitle ?? pendingTicket}：写下第一句，发送后这段讨论就挂在这张票下`
              : "先写下第一句，发送后这段会话才会出现在画布上"}</strong>
          </div>
          {/* A ticket keeps the name its source file gives it, and a path
              inside a session is not named at all: only a session gets these. */}
          {selectedNode && !viewing && <WaygoalRename key={selectedNode.id}
            sessionId={selectedNode.id} title={selectedNode.title} titleSource={selectedNode.titleSource}
            onRenamed={() => refresh(true)} onError={setError} onNotice={setNotice} />}
          {viewing && <button type="button" className="waygoal-button outlined small" onClick={stopViewing}>回到在聊的那条</button>}
          {!isMobile && <button type="button" className="waygoal-icon" aria-label="关闭面板" onClick={closePanel}>×</button>}
        </div>
        {openTicketMap && openFile && <div className="waygoal-file-view">
          <button type="button" className="waygoal-button outlined small" data-file-back
            onClick={() => setOpenFile(null)}>← 回到{openTicketCard ? "这张票" : "这张地图"}</button>
          <FileViewer filePath={openFile} cwd={snapshot.cwd} initialDisplayMode="preview" />
        </div>}
        {openTicketMap && !openFile && <WaygoalTicketPanel map={openTicketMap} ticket={openTicketCard} readAt={snapshot.tickets.readAt}
          onStart={ticket => startTicketChat(ticket.id)}
          onOpenDiscussion={id => { const node = nodes.find(n => n.id === id); if (node) openNode(node); }}
          onOpenReference={openReference}
          onReopenCheck={() => void arrange({ mapCheck: { map: openTicketMap.path, dismissed: false } })}
          onRetryRemote={ticket => void retryRemote(ticket).then(() => refresh(true))} />}
        {panelSession && <WaygoalPaths
          origin={panelOrigin}
          branchPoints={tree?.sessionId === panelSession.id ? tree.branchPoints : []}
          viewingEntryId={viewing?.sessionId === panelSession.id ? viewing.entryId : null}
          busyReason={busyReason}
          loading={!tree || tree.sessionId !== panelSession.id}
          onViewOrigin={() => {
            if (!panelOrigin) return;
            if (!panelOrigin.inWorkspace) { setNotice("来源会话不在这个工作目录里，画布不会替你打开另一段历史。"); return; }
            // Nothing to continue from here: this is the source discussion, and
            // its own paths are chosen from its own panel.
            viewPath(panelOrigin.sessionId, panelOrigin.entryId, panelOrigin.entryId ? "来源讨论的这条消息" : "来源讨论", null);
          }}
          onView={choice => panelSession && viewPath(panelSession.id, choice.entryId, "这条路径", choice.leafId)}
        />}
        {!openTicketMap && <div className="waygoal-panel-body">
          {viewing
            ? <WaygoalPathView key={`${viewing.sessionId}:${viewing.entryId}`} sessionId={viewing.sessionId}
                // Read the whole path, down to its deepest entry: what is on
                // display has to be what a message sent from here follows.
                leafId={viewing.leafId ?? viewing.entryId} cwd={snapshot.cwd}
                label={viewing.label} busyReason={busyReason} forkingEntryId={forkingEntryId}
                onSend={viewing.leafId ? text => void continueAndSend(viewing.sessionId, viewing.leafId!, text) : null}
                onFork={entryId => void forkFrom(viewing.sessionId, entryId)} />
            : <ChatWindow key={panelKey} session={panelSession} sessionRunning={selectedNode?.running ?? false}
                initialPrompt={pending} onInitialPromptConsumed={() => setPending(undefined)}
                newSessionCwd={panelSession ? null : snapshot.cwd} newSessionDraftKey={panelSession ? null : draftKey}
                onSessionCreated={onSessionCreated}
                onSessionForked={(newSessionId, originEntryId) => {
                  const from = chatSessionId.current;
                  if (from) void landOnFork(newSessionId, from, originEntryId);
                }}
                forkLabel="从这里分叉"
                onAgentEnd={() => { void refresh(true); if (openSessionId) void loadTree(openSessionId); }} soundEnabled={false}
                onOpenSession={id => { const node = snapshot.nodes.find(n => n.id === id); if (node) openNode(node); }} />}
        </div>}
      </aside>}
    </div>
  </main>;
}
