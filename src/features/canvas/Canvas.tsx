"use client";
import { forkFamily } from "@/features/sessions/fork-family";
import "../materials/SelectionPopover.css";
import { Fragment, useCallback, useEffect, useLayoutEffect, useId, useMemo, useRef, useState } from "react";
import { useIsMobile } from "@/shared/hooks/useIsMobile";
import { rekeyDraft, getDraft, setDraft, clearDraft, restoreDraftSubmission } from "@/features/chat/draft-store";
import { cardBounds, cardCenter, viewCenteredOn, type WaygoalCard } from "@/features/canvas/locate";
import type { SessionInfo, UserMessage } from "@/shared/types";
import type { WaygoalBranchChoice, WaygoalBranchPoint, WaygoalSessionTreeResponse } from "@/features/sessions/branches";
import { mapKind, ticketKind } from "@/features/tickets/labels";
import { placeNewFork, placeExpandedSessions, SESSION_HEADER, type SessionSize } from "@/features/canvas/session-expansion";
import { TURN_WIDTH, TURN_HEIGHT, type BoardCard, type BoardEdge } from "@/features/canvas/turn-board";
import { arrangeTickets, placeTicketMaps, ticketCards, ticketClusters, ticketRelations } from "@/features/tickets/ticket-layout";
import { arrangeCards } from "@/features/canvas/layout";
import { relationPath } from "@/features/canvas/relation-path";
import { NODE_HEIGHT, NODE_WIDTH, canOpen, needsCheck, ticketCardHeight, ticketChipTop, type WaygoalCanvasPatch, type WaygoalNode, type WaygoalReference, type WaygoalPoint, type WaygoalSnapshotResponse, type WaygoalTicketCard, type WaygoalView } from "@/shared/waygoal-types";
import { getUserMessageText, getUserMessageDraftImages, type ChatInputHandle } from "../chat/ChatInput";
import { ChatWindow } from "../chat/ChatWindow";
import { FileWorkspace, useFileWorkspace } from "../workspace/FileWorkspace";
import { WaygoalTurnCanvas } from "./TurnCanvas";
import { WaygoalMaterialTray, type MaterialArrival } from "../materials/MaterialTray";
import { feedbackIntent } from "./feedback-motion";
import { useBoardFeedback } from "./useBoardFeedback";
import { addMaterial, consumeMaterials, type MaterialSnapshot } from "@/features/materials/materials";
import type { WaygoalTurns } from "@/features/sessions/turns";
import { WaygoalPaths } from "../sessions/Paths";
import { WaygoalArrange } from "./Arrange";
import { WaygoalFind } from "./Find";
import { WaygoalPathView } from "../sessions/PathView";
import { WaygoalRename } from "../sessions/Rename";
import { WaygoalWorkspaceBar } from "../workspace/WorkspaceBar";
import { useCanvasMotion } from "./useCanvasMotion";
import { useCanvasViewport } from "./useCanvasViewport";
import { CanvasMinimap } from "./CanvasMinimap";
import { WaygoalPanelResize } from "./PanelResize";
import { stateClass, WaygoalTicketPanel } from "../tickets/TicketPanel";

const NODE_W = NODE_WIDTH;
const NODE_H = NODE_HEIGHT;
const DEFAULT_VIEW: WaygoalView = { x: 48, y: 96, scale: 1 };
const MIN_SCALE = 0.2;
const MAX_SCALE = 1.8;
/** The composer a ticket opens is a new-session composer, and the host clears a
 *  new-session draft as soon as that composer unmounts. An unsent ticket draft
 *  has to outlive closing the panel, so it is parked under the ticket's own key
 *  while no composer holds it, and handed back when the ticket is opened again. */
const liveTicketDraft = (ticket: string, cwd: string) => `waygoal-ticket:${ticket}:${cwd}`;
const parkedTicketDraft = (ticket: string, cwd: string) => `waygoal-ticket-parked:${ticket}:${cwd}`;

function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next = { ...record };
  delete next[key];
  return next;
}

/** Include the ownership label and quiet discussion boundary in Map bounds. */
function mapContentBounds(cards: WaygoalCard[], discussions: Set<string>) {
  return cardBounds(cards.map(card => discussions.has(card.id) ? {...card,
    position: {x: card.position.x - 14, y: card.position.y - 52},
    width: (card.width ?? NODE_W) + 28, height: card.height + 66,
  } : card));
}

type Drag = { id?: string; start: WaygoalPoint; origin: WaygoalPoint; moved: boolean; pointerId: number; members?: Record<string, WaygoalPoint>; scale?: number };
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
  const ticketArrowId = useId();
  const isMobile = useIsMobile();
  const [navigationCollapsed, setNavigationCollapsed] = useState(false);
  const navigationMenu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (navigationMenu.current && !navigationMenu.current.contains(event.target as Node)) navigationMenu.current.open = false;
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, []);
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
  const canvasEpoch = useRef(0);
  const continuationEpoch = useRef(0);
  const readScope = JSON.stringify([cwd, canvasId]);
  const readScopeRef = useRef(readScope); readScopeRef.current = readScope;
  useEffect(() => () => { canvasEpoch.current++; continuationEpoch.current++; }, []);
  // The local ticket the panel is showing, by source path; a map's own path
  // when the map itself is open. Tickets are files, never Pi sessions.
  const [openTicket, setOpenTicket] = useState<string | null>(null);
  const fileWorkspace = useFileWorkspace(cwd || snapshot?.cwd || "");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [view, updateView] = useState<WaygoalView>(DEFAULT_VIEW);
  const [dragging, setDragging] = useState<Record<string, WaygoalPoint>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Cards the user picked with ⌘/Ctrl-click, to group or to link. Picking is
  // not opening: it changes nothing until 建一个分组 or 连一条关联 is pressed.
  const [picked, setPicked] = useState<string[]>([]);
  const [layoutBusy, setLayoutBusy] = useState(false);
  const [draftKey, setDraftKey] = useState<string | null>(null);
  // The ticket a discussion being started belongs to. Nothing is written until
  // the user actually sends: an unsent draft holds no session and no ticket.
  const [pendingTicket, setPendingTicket] = useState<string | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [createdSession, setCreatedSession] = useState<SessionInfo | null>(null);
  const [overviewRequested, setOverviewRequested] = useState(false);
  const [entranceSession, setEntranceSession] = useState<string | null>(null);
  const chatPanel = useRef<HTMLElement>(null);
  const previousPanelRect = useRef<{ rect: DOMRect; entering: boolean } | null>(null);
  const [panelKey, setPanelKey] = useState(0);
  const [manageOpen, setManageOpen] = useState(false);
  const [expandedSessions, setExpandedSessions] = useState<string[]>([]);
  const [clusterHeaderHeights, setClusterHeaderHeights] = useState<Record<string, number>>({});
  const [worldHost, setWorldHost] = useState<HTMLDivElement | null>(null);
  const motion = useCanvasMotion(worldHost, view, updateView);
  const boardFeedback = useBoardFeedback(worldHost, `${snapshot?.workspaceId}:${snapshot?.workspace.canvasId}`);
  const { navigate: setView, direct: setViewDirect } = motion;
  const [turnGeometry, setTurnGeometry] = useState<{ sizes: Record<string, SessionSize>; cards: BoardCard[]; edges: BoardEdge[] }>({ sizes: {}, cards: [], edges: [] });
  const geometryRef = useRef(turnGeometry);
  const receiveGeometry = useCallback((sizes: Record<string, SessionSize>, cards: BoardCard[], edges: BoardEdge[]) => {
    const current = geometryRef.current;
    // Translation changes turn positions, not session dimensions. Keep those
    // dimensions stable so reporting positions cannot restart session layout.
    const next = { sizes: JSON.stringify(current.sizes) === JSON.stringify(sizes) ? current.sizes : sizes, cards, edges };
    // Do not schedule another state update from the geometry effect when
    // nothing changed, even while pointer events keep the parent rendering.
    if (JSON.stringify(current) === JSON.stringify(next)) return;
    geometryRef.current = next;
    setTurnGeometry(next);
  }, []);
  const [searchTarget, setSearchTarget] = useState<{ sessionId: string; entryId: string } | null>(null);
  const [locateEntry, setLocateEntry] = useState<{ entryId: string; serial: number } | null>(null);
  const [inspectEntry, setInspectEntry] = useState<{ entryId: string; serial: number } | null>(null);
  const [locateMaterial, setLocateMaterial] = useState<{ sessionId: string; turnId: string; serial: number } | null>(null);
  const materialLocateRequest = useRef<AbortController | null>(null);
  const [explorationPrompt, setExplorationPrompt] = useState<{ sessionId: string; text: string } | null>(null);
  const [materials, setMaterials] = useState<MaterialSnapshot[]>([]);
  const [materialArrival, setMaterialArrival] = useState<MaterialArrival | null>(null);
  const materialDrafts = useRef(new Map<string, MaterialSnapshot[]>());
  const materialsRef = useRef(materials); materialsRef.current = materials;
  const [navigating, setNavigating] = useState(false);
  const clearSearchTarget = useCallback(() => setSearchTarget(null), []);
  const [trust, setTrust] = useState<{ requiresTrust: boolean; trusted: boolean } | null>(null);
  const [tree, setTree] = useState<WaygoalSessionTreeResponse | null>(null);
  const [viewing, setViewing] = useState<Viewing | null>(null);
  const forkInFlight = useRef(false);
  // A failed landing is not a failed Pi fork. Retry the read/registration,
  // rather than create another session from the same explicit submission.
  const pendingForks = useRef(new Map<string, string>());
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
  const leavePanel = useCallback(() => {
    continuationEpoch.current++;
    setForkingEntryId(null);
    materialLocateRequest.current?.abort();
    if (chatSessionId.current) materialDrafts.current.set(`session:${chatSessionId.current}`, materialsRef.current);
    setDraftKey(null); setCreatedSession(null); setViewing(null); setMaterials([]);
  }, []);

  const viewportRef = useRef<HTMLDivElement>(null);
  useCanvasViewport(motion.app, viewportRef);
  // The session ChatWindow is showing, so a fork it reports can be attributed.
  const chatSessionId = useRef<string | null>(null);
  const chatInput = useRef<ChatInputHandle | null>(null);
  const recoverForkPrompt = useCallback((sessionId: string, prompt: string) => {
    // Repeated landing failures need not prepend the same submitted text
    // again. If the user opened the fork meanwhile, update its live input as
    // well as the store, merging their new draft without stealing focus.
    if (getDraft(sessionId)?.value.includes(prompt)) return;
    if (chatInput.current) chatInput.current.restoreSubmission(prompt, undefined, sessionId, { focus: false });
    else restoreDraftSubmission(sessionId, prompt);
  }, []);
  const pendingRestoreEntry = useRef<string | null>(null);
  const pendingRestoreSession = useRef<string | null>(null);
  // Whether the error on screen came from reading the canvas.
  const readError = useRef(false);

  /** One PATCH: the canvas's own patch, plus — for a session that was just
   *  started here — the workspace's note of which canvas it belongs on. */
  const patch = useCallback(async (body: WaygoalCanvasPatch & { registerSession?: string }, report: () => boolean = () => true) => {
    if (!snapshot?.cwd) return false;
    try {
      // The canvas comes from the snapshot, not from the URL: a patch belongs
      // to the canvas that is actually on screen.
      const res = await fetch("/api/waygoal", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd: snapshot.cwd, canvas: snapshot.workspace.canvasId, ...body }) });
      if (!res.ok) throw new Error((await res.json()).error);
      return true;
    } catch (e) { if (report()) setError(`画布记录没有保存：${e instanceof Error ? e.message : String(e)}`); return false; }
  }, [snapshot?.cwd, snapshot?.workspace.canvasId]);

  const expandedRef = useRef(expandedSessions); expandedRef.current = expandedSessions;
  const setSessionExpanded = useCallback((id: string, open: boolean, animate = true) => {
    if (expandedRef.current.includes(id) === open) return;
    if (animate) boardFeedback(open ? "expand" : "collapse", id);
    const next = open ? [...new Set([...expandedRef.current, id])] : expandedRef.current.filter(item => item !== id);
    expandedRef.current = next; setExpandedSessions(next);
    void patch({ expandedSessions: next });
  }, [patch, boardFeedback]);
  const expandSession = useCallback((id: string) => setSessionExpanded(id, true), [setSessionExpanded]);

  /** Ask the host to read that remote ticket's raw result again. Nothing is
   *  written to the source: ordinary capture retries are offline, while an
   *  explicit relationship refresh reads GitHub through the host gh login. */
  const retryRemote = useCallback(async (ticket: WaygoalTicketCard, action?: "relations") => {
    if (!snapshot?.cwd) return;
    try {
      const res = await fetch("/api/waygoal/remote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd: snapshot.cwd, ticket: ticket.id, action }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      if (action) setNotice(body.refreshed ? "已刷新父子与依赖关系。" : body.note);
      else if (!body.captured) setNotice(body.note ?? "还是没读到这次交付的原始结果。");
    } catch (e) { setError(`没能重新取得：${e instanceof Error ? e.message : String(e)}`); }
  }, [snapshot?.cwd]);

  const refreshGeneration = useRef(0);
  const lastSnapshotRead = useRef<{ scope: string; text: string; value: WaygoalSnapshotResponse } | null>(null);
  const refresh = useCallback(async (force = false, allowed: () => boolean = () => true) => {
    const epoch = canvasEpoch.current;
    const current = () => epoch === canvasEpoch.current && readScopeRef.current === readScope && allowed();
    if (!current()) return;
    const generation = ++refreshGeneration.current;
    try {
      const params = new URLSearchParams();
      if (cwd) params.set("cwd", cwd);
      if (canvasId) params.set("canvas", canvasId);
      if (force) params.set("force", "1");
      const res = await fetch(`/api/waygoal${params.size ? `?${params}` : ""}`, { cache: "no-store" });
      const text = await res.text();
      if (!current()) return;
      const cached = lastSnapshotRead.current;
      const next = cached?.scope === readScope && cached.text === text ? cached.value : JSON.parse(text);
      if (!res.ok) throw new Error(next.error);
      lastSnapshotRead.current = { scope: readScope, text, value: next };
      if (generation !== refreshGeneration.current) return next as WaygoalSnapshotResponse;
      setSnapshot(next as WaygoalSnapshotResponse);
      // Only what reading the canvas reported is taken back by reading it
      // again; something the user was told about their own last action stays
      // on screen until they close it.
      if (readError.current) { readError.current = false; setError(""); }
      return next as WaygoalSnapshotResponse;
    } catch (e) { if (current() && generation === refreshGeneration.current) { readError.current = true; setError(e instanceof Error ? e.message : String(e)); } }
  }, [canvasId, cwd, readScope]);

  useEffect(() => {
    let stopped = false, reading = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async (force = false) => {
      if (stopped || reading) return;
      clearTimeout(timer);
      reading = true;
      try { if (document.visibilityState === "visible") await refresh(force); }
      finally { reading = false; if (!stopped) timer = setTimeout(() => void poll(), 2500); }
    };
    void poll(true);
    const onVisible = () => { if (document.visibilityState === "visible") void poll(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { stopped = true; clearTimeout(timer); document.removeEventListener("visibilitychange", onVisible); };
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
    canvasEpoch.current++; continuationEpoch.current++;
    if (viewSaveTimer.current) {
      clearTimeout(viewSaveTimer.current);
      viewSaveTimer.current = null;
      await patch({ view });
    }
    setOverviewRequested(false); setEntranceSession(null); setExpandedSessions([]); setTurnGeometry({ sizes: {}, cards: [], edges: [] });
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
    continuationEpoch.current++;
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
    setViewDirect(snapshot.view ?? DEFAULT_VIEW);
    setExpandedSessions(snapshot.expandedSessions ?? []);
    leavePanel(); setTree(null);
    if (snapshot.lastViewed && !snapshot.lastViewedMissing) {
      setSelectedId(snapshot.lastViewed);
      pendingRestoreEntry.current = snapshot.preview?.entryId ?? snapshot.lastViewedEntry;
      pendingRestoreSession.current = snapshot.preview?.sessionId ?? snapshot.lastViewed;
      setPanelKey(k => k + 1);
    } else {
      setSelectedId(null);
      pendingRestoreEntry.current = null;
      if (snapshot.lastViewedMissing) setNotice("上次查看的会话已不在这个工作目录里，没有自动绑定到其他会话。");
    }
  }, [leavePanel, snapshot, setViewDirect]);

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
    const sessionId = pendingRestoreSession.current ?? openSessionId;
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
          void patch({ lastViewedEntry: null, preview: null });
        }
      } catch { /* the panel still opens at the continue position */ }
    })();
    return () => { cancelled = true; };
  }, [openSessionId, patch]);


  const nodes = useMemo(() => {
    const source = (snapshot?.nodes ?? []).map(node => ({ ...node, position: dragging[node.id] ?? node.position }));
    const hidden = new Set((snapshot?.groups ?? []).filter(group => group.collapsed).flatMap(group => group.members));
    const sizes = Object.fromEntries(Object.entries(turnGeometry.sizes).filter(([id]) => expandedSessions.includes(id) && !hidden.has(id)));
    const visible = placeExpandedSessions(source.filter(node => !hidden.has(node.id)), sizes);
    return source.map(node => dragging[node.id] ? node : visible.find(item => item.id === node.id) ?? node);
  }, [snapshot, dragging, turnGeometry.sizes, expandedSessions]);
  // Map and ticket cards, laid out from the same record as the session cards
  // and dragged by the same handlers.
  const placedTickets = useMemo(() => placeTicketMaps(snapshot?.tickets.maps ?? [], nodes.map(node => ({
    ...node.position, sessionId: node.id, width: expandedSessions.includes(node.id) ? turnGeometry.sizes[node.id]?.width ?? NODE_W : NODE_W,
    height: expandedSessions.includes(node.id) ? turnGeometry.sizes[node.id]?.height ?? NODE_H : NODE_H,
  })), clusterHeaderHeights), [snapshot, nodes, expandedSessions, turnGeometry.sizes, clusterHeaderHeights]);
  const ticketMaps = useMemo(() => placedTickets.map(map => ({
    ...map, position: dragging[map.path] ?? map.position,
    tickets: map.tickets.map(ticket => ({ ...ticket, position: dragging[ticket.id] ?? ticket.position })),
  })), [placedTickets, dragging]);
  const clusters = useMemo(() => ticketClusters(ticketMaps).map(cluster => ({...cluster,
    ticketCount: cluster.members.length - 1,
    completedCount: ticketMaps.flatMap(map => map.tickets).filter(ticket => ticket.id !== cluster.id && cluster.members.includes(ticket.id) && ticket.state === "resolved").length,
    rootTicket: ticketMaps.flatMap(map => map.tickets).find(ticket => ticket.id === cluster.id),
    members: [...cluster.members, ...cluster.sessionIds.filter(id => nodes.some(node => node.id === id))],
    collapsed: snapshot?.collapsedTicketClusters?.includes(cluster.id) ?? false,
  })), [ticketMaps, nodes, snapshot?.collapsedTicketClusters]);
  const mapDiscussionIds = useMemo(() => new Set(clusters.flatMap(cluster =>
    (cluster.rootTicket?.discussions ?? []).filter(talk => !talk.missing).map(talk => talk.sessionId))), [clusters]);
  const clusterHeaderKey = clusters.map(cluster => `${cluster.id}:${cluster.collapsed}`).join("|");
  useLayoutEffect(() => {
    if (!worldHost) return;
    const observer = new ResizeObserver(entries => {
      setClusterHeaderHeights(previous => {
        const next = {...previous};
        let changed = false;
        for (const entry of entries) {
          const el = entry.target as HTMLElement, id = el.dataset.clusterHead!;
          const height = Math.ceil(el.offsetHeight);
          if (height && previous[id] !== height) { next[id] = height; changed = true; }
        }
        return changed ? next : previous;
      });
    });
    worldHost.querySelectorAll('[data-cluster-head][data-collapsed="false"]').forEach(el => observer.observe(el));
    return () => observer.disconnect();
  }, [worldHost, clusterHeaderKey]);
  const ticketCount = ticketMaps.reduce((total, map) => total + map.tickets.length, 0);
  const groups = useMemo(() => (snapshot?.groups ?? []).map(group => ({ ...group, position: dragging[group.id] ?? group.position })), [snapshot, dragging]);
  // A collapsed group stands in for its members: they are not drawn, and
  // neither is any line that would end on one. Nothing about them changes.
  const tucked = useMemo(() => new Set([...groups.filter(group => group.collapsed).flatMap(group => group.members), ...clusters.filter(c => c.collapsed).flatMap(c => c.members.filter(id => id !== c.id))]), [groups, clusters]);
  // Keep cluster-owned sessions in the tree graph for message navigation;
  // only their visual expansion is folded. The active Pi path stays intact.
  const turnSessions = useMemo(() => {
    const hidden = new Set(groups.filter(group => group.collapsed).flatMap(group => group.members));
    return nodes.filter(node => !hidden.has(node.id));
  }, [nodes, groups]);
  const visibleExpandedSessions = useMemo(() => expandedSessions.filter(id => !tucked.has(id)), [expandedSessions, tucked]);
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
    for (const cluster of clusters.filter(c => c.collapsed)) for (const member of cluster.members) if (member !== cluster.id && !standIn.has(member)) standIn.set(member, { ...cluster, name: cluster.title });
    const placed = (card: WaygoalCard): WaygoalCard => {
      const group = standIn.get(card.id);
      return group ? { ...card, position: group.position, height: NODE_H, width: NODE_W } : card;
    };
    const result: WaygoalCard[] = [
      ...nodes.map(node => placed({ id: node.id, title: node.title, kind: "session" as const, position: node.position, height: expandedSessions.includes(node.id) ? turnGeometry.sizes[node.id]?.height ?? NODE_H : NODE_H, width: expandedSessions.includes(node.id) ? turnGeometry.sizes[node.id]?.width ?? NODE_W : NODE_W, modified: node.modified })),
      ...ticketMaps.flatMap(map => [
        ...(!map.remote ? [placed({ id: map.path, title: map.title, kind: "map" as const, position: map.position, height: NODE_H, modified: null })] : []),
        ...map.tickets.map(ticket => placed({
          id: ticket.id, title: ticket.title, kind: "ticket" as const, position: ticket.position,
          height: ticket.expanded ? ticketCardHeight(ticket.discussions.length) : 152, modified: null,
        })),
      ]),
      ...groups.filter(group => group.collapsed).map(group => ({
        id: group.id, title: group.name, kind: "group" as const, position: group.position, height: NODE_H, modified: null,
      })),
    ];
    // An expanded Map is its frame header, not a duplicate card inside it.
    // Keep its identity in navigation and external links at the visible header.
    for (const cluster of clusters.filter(item => !item.collapsed && !standIn.has(item.id))) {
      const root = result.find(card => card.id === cluster.id);
      const box = mapContentBounds(result.filter(card => card.id !== cluster.id && cluster.members.includes(card.id)), mapDiscussionIds);
      if (root && box) Object.assign(root, {position: {x: box.x - 20, y: box.y - (clusterHeaderHeights[cluster.id] ?? 132) - 16}, width: Math.max(720, box.width + 40), height: clusterHeaderHeights[cluster.id] ?? 132});
    }
    for (const cluster of clusters.filter(item => item.collapsed)) {
      const root = result.find(card => card.id === cluster.id);
      if (root) Object.assign(root, {width: 320, height: 200});
    }
    return result;
  }, [nodes, ticketMaps, groups, clusters, expandedSessions, turnGeometry.sizes, clusterHeaderHeights, mapDiscussionIds]);
  const sceneCards = useMemo(() => [...cards, ...turnGeometry.cards.map(card => ({ id: card.key, title: card.turn.question, kind: "session" as const, position: card.position, width: TURN_WIDTH, height: TURN_HEIGHT, modified: null }))], [cards, turnGeometry.cards]);
  const workRelations = useMemo(() => ticketRelations(ticketMaps), [ticketMaps]);
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
    const found = cards.find(c => c.id === id);
    if (!found) return;
    const card = found.kind === "session" ? { ...found, height: NODE_H } : found;
    revealedFor.current = id;
    const viewport = { width: el.clientWidth, height: el.clientHeight };
    setView(v => {
      const left = card.position.x * v.scale + v.x, top = card.position.y * v.scale + v.y;
      const right = left + NODE_W * v.scale, bottom = top + card.height * v.scale;
      const margin = 24;
      if (left >= margin && top >= margin && right <= viewport.width - margin && bottom <= viewport.height - margin) return v;
      return viewCenteredOn(cardCenter(card), v, viewport);
    });
  }, [selectedId, openTicket, cards, setView]);

  const openTicketMap = openTicket ? ticketMaps.find(map => map.path === openTicket || map.tickets.some(t => t.id === openTicket)) ?? null : null;
  const openTicketCard = openTicketMap?.tickets.find(t => t.id === openTicket) ?? null;
  const pendingTicketTitle = pendingTicket
    ? ticketMaps.flatMap(map => map.tickets).find(ticket => ticket.id === pendingTicket)?.title ?? null
    : null;
  const nodeById = useMemo(() => new Map(nodes.map(node => [node.id, node])), [nodes]);
  const selectedNode = nodes.find(n => n.id === selectedId) ?? null;
  const panelSession: SessionInfo | null = selectedNode ? nodeToSession(selectedNode, snapshot!.cwd) : createdSession;
  const panelOpen = Boolean(panelSession || draftKey || openTicketMap || viewing);
  const emptyCanvas = Boolean(snapshot && nodes.length === 0 && !panelSession && !openTicketMap && !pendingTicket && !overviewRequested);
  const emptyEntry = emptyCanvas || entranceSession === panelSession?.id;
  useLayoutEffect(() => {
    const panel = chatPanel.current;
    if (!panel) { previousPanelRect.current = null; return; }
    const rect = panel.getBoundingClientRect(), before = previousPanelRect.current;
    previousPanelRect.current = { rect, entering: emptyEntry };
    if (!before?.entering || emptyEntry || motion.app.current?.dataset.input !== "pointer" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const tokens = getComputedStyle(panel);
    const animation = panel.animate([
      { transform: `translate(${before.rect.x - rect.x}px, ${before.rect.y - rect.y}px)`, transformOrigin: "top left" },
      { transform: "none", transformOrigin: "top left" },
    ], { duration: parseFloat(tokens.getPropertyValue("--wg-motion-travel")), easing: tokens.getPropertyValue("--wg-ease-out").trim() });
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const cancel = () => animation.cancel();
    panel.addEventListener("pointerdown", cancel);
    reduce.addEventListener("change", cancel);
    return () => { animation.cancel(); panel.removeEventListener("pointerdown", cancel); reduce.removeEventListener("change", cancel); };
  }, [emptyEntry, panelOpen, motion.app]);

  // Kept in a ref, not read from the closure: ChatWindow reports a fork
  // asynchronously, and the panel may already show something else by then.
  useEffect(() => { chatSessionId.current = panelSession?.id ?? null; }, [panelSession]);

  // Real fork relations between nodes of this workspace, as drawn edges.
  const originEdges = useMemo(() => nodes.flatMap(node => {
    const from = node.origin?.inWorkspace ? nodeById.get(node.origin.sessionId) : undefined;
    if (!from || from.id === node.id || tucked.has(node.id) || tucked.has(from.id)) return [];
    // Once a real turn endpoint is visible, TurnCanvas owns this fork line.
    // Keep the session-level fallback only while that precise link is folded.
    if (turnGeometry.edges.some(edge => edge.kind === "fork" && edge.toSession === node.id
      && turnGeometry.cards.some(card => card.key === edge.from || card.key === edge.to))) return [];
    return [{ id: node.id, fromId: from.id, from: from.position, to: node.position, exact: Boolean(node.origin?.entryId) }];
  }), [nodes, nodeById, tucked, turnGeometry]);

  // A ticket and its discussions, drawn so the relation survives dragging one
  // of them away. It is an association, not a fork and not a dependency.
  const ticketEdges = useMemo(() => ticketMaps.flatMap(map => map.tickets.flatMap(ticket =>
    ticket.discussions.flatMap(talk => {
      const node = nodeById.get(talk.sessionId);
      // Collapsed means this ticket is not spread out on the canvas: its lines
      // go quiet with its chips. The discussions are still held under it.
      const hidden = tucked.has(talk.sessionId) || tucked.has(ticket.id);
      return node && ticket.expanded && !hidden && !clusters.some(cluster => cluster.id === ticket.id) ? [{ id: `${ticket.id}->${talk.sessionId}`, fromId: ticket.id, toId: node.id, from: cardById.get(ticket.id)?.position ?? ticket.position, to: node.position }] : [];
    }))), [ticketMaps, nodeById, tucked, cardById, clusters]);

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
    return [{ id: link.id, fromId: link.from, toId: link.to, note: link.note, start, end, mid: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 } }];
  }), [snapshot, cardById]);

  // A group is drawn as a frame around wherever its members currently sit, so
  // dragging a member reshapes the frame instead of breaking the grouping.
  const groupFrames = useMemo(() => groups.filter(group => !group.collapsed).flatMap(group => {
    const box = cardBounds(group.members.flatMap(id => { const card = cardById.get(id); return card ? [card] : []; }));
    // Room for the frame, and above it for the header carrying the name.
    return box ? [{ ...group, left: box.x - 18, top: box.y - 46, width: box.width + 36, height: box.height + 64 }] : [];
  }), [groups, cardById]);

  const clusterFrames = useMemo(() => clusters.filter(cluster => !groups.some(g => g.collapsed && g.members.includes(cluster.id))).flatMap(cluster => {
    const root = cardById.get(cluster.id);
    if (!root) return [];
    if (cluster.collapsed) return [{...cluster, left: root.position.x, top: root.position.y, width: 320, height: 200}];
    const box = mapContentBounds(cluster.members.filter(id => id !== cluster.id && !tucked.has(id)).flatMap(id => {
      const card = cardById.get(id); return card ? [card] : [];
    }), mapDiscussionIds);
    return box ? [{...cluster, left: box.x - 20, top: box.y - (clusterHeaderHeights[cluster.id] ?? 132) - 16, width: Math.max(720, box.width + 40), height: box.height + (clusterHeaderHeights[cluster.id] ?? 132) + 36}] : [];
  }), [clusters, groups, tucked, cardById, clusterHeaderHeights, mapDiscussionIds]);
  const [clusterSaving, setClusterSaving] = useState(false);
  const [movingCluster, setMovingCluster] = useState(false);
  const toggleCluster = async (id: string, collapsed: boolean) => {
    if (clusterSaving) return;
    setClusterSaving(true);
    const current = snapshot?.collapsedTicketClusters ?? [];
    try {
      if (await patch({collapsedTicketClusters: collapsed ? [...new Set([...current, id])] : current.filter(key => key !== id)})) await refresh(true);
    } finally { setClusterSaving(false); }
  };

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

  const busyReason = nodes.find(n => n.id === openSessionId)?.running
    ? "这段会话正在运行。分叉和在别的路径里接着说都要等它结束，Waygoal 不打断正在进行的任务；看历史不受影响。"
    : null;

  const revealSession = useCallback((id: string) => {
    const cluster = clusters.find(item => item.collapsed && item.members.includes(id));
    if (cluster) void patch({collapsedTicketClusters: (snapshot?.collapsedTicketClusters ?? []).filter(key => key !== cluster.id)}).then(saved => { if (saved) void refresh(true); });
    expandSession(id);
  }, [clusters, snapshot?.collapsedTicketClusters, patch, refresh, expandSession]);
  const locateTurn = useCallback((entryId: string) => {
    if (chatSessionId.current) revealSession(chatSessionId.current);
    setManageOpen(false); setLocateEntry({ entryId, serial: Date.now() });
  }, [revealSession]);
  const openNode = useCallback((node: WaygoalNode, reading: Viewing | null = null) => {
    setSearchTarget(null);
    revealSession(node.id);
    if (node.id === chatSessionId.current) {
      setViewing(reading);
      void patch({ preview: reading ? { sessionId: reading.sessionId, entryId: reading.entryId } : null });
      return;
    }
    leavePanel(); setOpenTicket(null); setViewing(reading);
    setManageOpen(false); setMaterials(materialDrafts.current.get(`session:${node.id}`) ?? []);
    setSelectedId(node.id);
    setPanelKey(k => k + 1);
    setNotice("");
    setPendingTicket(null);
    const ticket = ticketOfSession.get(node.id);
    void patch({ lastViewed: node.id, lastViewedEntry: null, preview: reading ? { sessionId: reading.sessionId, entryId: reading.entryId } : null, ...(ticket ? { ticketLast: { ticket, sessionId: node.id, entryId: null } } : {}) });
  }, [leavePanel, patch, ticketOfSession, revealSession]);

  /** Open one local map or ticket: a file this workspace already has. Reading
   *  it starts nothing — it is not a Pi session and has none of its own. */
  const openLocalTicket = useCallback((path: string) => {
    const cluster = clusters.find(item => item.collapsed && item.id !== path && item.members.includes(path));
    if (cluster) void patch({collapsedTicketClusters: (snapshot?.collapsedTicketClusters ?? []).filter(id => id !== cluster.id)}).then(saved => { if (saved) void refresh(true); });
    leavePanel(); setPendingTicket(null);
    setSelectedId(null);
    setOpenTicket(path);
    setNotice("");
  }, [leavePanel, clusters, snapshot?.collapsedTicketClusters, patch, refresh]);

  /** Open a read-only reading position. Display only — no navigation.
   *  `leafId` is where a message sent from here would land, null when this
   *  position is not one to send from. */
  const viewPath = useCallback((sessionId: string, entryId: string | null, label: string, leafId: string | null) => {
    setNotice("");
    setViewing({ sessionId, entryId, leafId, label });
    setManageOpen(false);
    // Reading is not talking: the ticket keeps pointing at the discussion the
    // user last talked in, not at whatever history they are looking through.
    void patch({ lastViewed: openSessionId ?? sessionId, lastViewedEntry: null, preview: { sessionId, entryId } });
  }, [patch, openSessionId]);

  const stopViewing = useCallback(() => {
    setViewing(null);
    if (openSessionId) void patch({ lastViewed: openSessionId, lastViewedEntry: null, preview: null });
  }, [openSessionId, patch]);

  const materialLabels = useMemo(() => Object.fromEntries(materials.map(material => {
    const member = turnGeometry.cards.flatMap(card => card.members).find(member => member.sessionId === material.sessionId && member.turn.id === material.turnId);
    return [`${material.sessionId}:${material.turnId}`, {
      title: nodes.find(node => node.id === material.sessionId)?.title ?? "来源会话不在当前画布",
      turnLabel: member?.turn.question || `轮次 ${material.turnId}`,
    }];
  })), [materials, nodes, turnGeometry.cards]);

  useEffect(() => {
    materialLocateRequest.current?.abort();
    return () => materialLocateRequest.current?.abort();
  }, [panelSession?.id, panelKey, snapshot?.workspaceId, snapshot?.workspace.canvasId]);

  useEffect(() => {
    // A late read must not replay navigation after a newer gesture, keystroke,
    // or wheel movement. This also cancels a location awaiting graph loading.
    const cancel = () => { materialLocateRequest.current?.abort(); setLocateMaterial(null); };
    document.addEventListener("pointerdown", cancel, true);
    document.addEventListener("keydown", cancel, true);
    document.addEventListener("wheel", cancel, { capture: true, passive: true });
    return () => {
      document.removeEventListener("pointerdown", cancel, true);
      document.removeEventListener("keydown", cancel, true);
      document.removeEventListener("wheel", cancel, true);
    };
  }, []);

  useEffect(() => {
    for (const [key, id] of pendingForks.current) if (id === panelSession?.id) pendingForks.current.delete(key);
  }, [panelSession?.id]);

  /** Read the source, never navigate Pi to it. Frozen material remains usable
   * even if its source can no longer be opened. */
  const locateMaterialSource = useCallback(async (material: MaterialSnapshot) => {
    materialLocateRequest.current?.abort();
    const controller = new AbortController(); materialLocateRequest.current = controller;
    try {
      const response = await fetch(`/api/waygoal/session/${encodeURIComponent(material.sessionId)}/turns`, { signal: controller.signal, cache: "no-store" });
      const body = await response.json() as WaygoalTurns & { error?: string };
      if (controller.signal.aborted) return;
      if (!response.ok) throw new Error(body.error || "来源读取失败");
      const turn = body.turns.find(turn => turn.id === material.turnId);
      if (!turn) throw new Error("来源轮次已找不到");
      setLocateMaterial({ sessionId: material.sessionId, turnId: material.turnId, serial: Date.now() });
      if (material.sessionId === panelSession?.id && turn.active) {
        setSearchTarget({ sessionId: material.sessionId, entryId: turn.id }); stopViewing();
      } else viewPath(material.sessionId, turn.endId, turn.question, turn.endId);
    } catch (error) {
      if (!controller.signal.aborted) setError(`没能打开来源：${error instanceof Error ? error.message : String(error)}。已选原文仍保留，可继续使用。`);
    }
  }, [panelSession?.id, stopViewing, viewPath]);

  const receiveMaterials = useCallback((incoming: MaterialSnapshot[], allowed: () => boolean, focus: boolean) => {
    setMaterials(current => incoming.reduce(addMaterial, current));
    if (incoming.length) setMaterialArrival({ material: incoming[incoming.length - 1], allowed });
    if (focus) stopViewing();
    setNotice("材料已加入。请在右侧写下综合目的，再发送；原来的讨论和草稿都保留。");
    if (focus) chatPanel.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus();
  }, [stopViewing]);

  const startNewChat = useCallback(() => {
    if (!snapshot) return;
    leavePanel(); setSelectedId(null); setOpenTicket(null); setPendingTicket(null);
    setMaterials([]); setManageOpen(false);
    setDraftKey(`waygoal-new:${crypto.randomUUID()}:${snapshot.cwd}`);
    setPanelKey(k => k + 1);
    setNotice("");
  }, [leavePanel, snapshot]);

  // An empty canvas opens only a local composer. Pi is created by its first send.
  useEffect(() => {
    if (emptyCanvas && !panelOpen) startNewChat();
  }, [emptyCanvas, panelOpen, startNewChat]);

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
    leavePanel(); setSelectedId(null); setOpenTicket(null); setPendingTicket(null);
    viewportRef.current?.focus();
  }, [leavePanel]);

  const onSessionCreated = useCallback((session: SessionInfo) => {
    if (emptyCanvas) setEntranceSession(session.id);
    expandSession(session.id);
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
  }, [patch, pendingTicket, refresh, emptyCanvas, expandSession]);

  /** Land on a session that was just branched off, keeping where it came from. */
  const landOnFork = useCallback(async (newSessionId: string, originSessionId: string, originEntryId?: string, allowed = feedbackIntent(worldHost), current: () => boolean = () => true) => {
    // The ticket comes along either way: with a message position the store
    // carries it over with the origin, and without one it is said outright, so
    // a fork Pi can only trace back to the session does not leave the ticket.
    const ticket = ticketOfSession.get(originSessionId);
    const registered = await patch({ registerSession: newSessionId,
      ...(ticket ? { ticketSession: { sessionId: newSessionId, ticket } } : {}),
    }, current);
    if (!registered) throw new Error("新会话已创建，但画布记录未保存；重试会继续使用这个会话。");
    if (!current()) return false;
    boardFeedback("fork", newSessionId, allowed);
    const next = await refresh(true, current);
    if (!current()) return false;
    const fork = next?.nodes.find(node => node.id === newSessionId);
    if (!fork || !next) throw new Error("新会话已创建，但暂时没能载入；重试会继续使用这个会话。");
    const recorded = await patch({ lastViewed: newSessionId, lastViewedEntry: null, preview: null }, current);
    if (!current()) return false;
    if (!recorded) throw new Error("新会话已创建，但位置未保存；请重试。");
    // Switch once the fork is available. A polling snapshot may still be old;
    // retain the real session as a fallback so the composer never opens empty.
    leavePanel();
    setCreatedSession(nodeToSession(fork, next.cwd));
    setSessionExpanded(originSessionId, true, false); setSessionExpanded(newSessionId, true, false);
    setSelectedId(newSessionId);
    if (originEntryId) setLocateEntry({ entryId: originEntryId, serial: Date.now() });
    setMaterials([]); setManageOpen(false);
    setPanelKey(k => k + 1);
    setNotice(originEntryId
      ? "已分出一段新会话。原来的讨论还在画布上，连线指向它分出的那条消息。"
      : "已分出一段新会话。这次没有记下具体消息位置，画布只显示来源会话。");
    return true;
  }, [leavePanel, patch, refresh, ticketOfSession, setSessionExpanded, worldHost, boardFeedback]);

  /** The real Pi fork, from a message in the read-only view. */
  const forkFrom = useCallback(async (sessionId: string, entryId: string, after = false, editedMessage?: UserMessage, prompt?: string) => {
    if (forkInFlight.current) { if (prompt) throw new Error("正在分叉，请稍候。"); return; }
    forkInFlight.current = true;
    const epoch = continuationEpoch.current;
    const current = () => continuationEpoch.current === epoch;
    const key = JSON.stringify([snapshot?.cwd, snapshot?.workspace.canvasId, sessionId, entryId, after]);
    let newSessionId = pendingForks.current.get(key);
    const operationKey = `waygoal-fork:${key}`;
    const storedOperation = sessionStorage.getItem(operationKey);
    const sourceCard = turnGeometry.cards.find(card => card.members.some(member => member.sessionId === sessionId && (member.turn.endId === entryId || member.turn.entryIds.includes(entryId))));
    const family = forkFamily((snapshot?.nodes ?? []).flatMap(node => node.origin ? [[node.id, node.origin.sessionId] as const] : []), [sessionId]);
    const branchPosition = sourceCard ? placeNewFork(sourceCard.position, [
      ...turnGeometry.cards.filter(card => card.members.some(member => family.has(member.sessionId))).map(card => ({ position: card.position, width: TURN_WIDTH, height: TURN_HEIGHT })),
      ...nodes.filter(node => family.has(node.id)).map(node => ({ position: node.position, width: TURN_WIDTH, height: SESSION_HEADER })),
    ]) : undefined;
    const freshOperation = { operationId: crypto.randomUUID(),
      waygoal: snapshot ? { cwd: snapshot.cwd, canvasId: snapshot.workspace.canvasId,
        position: branchPosition } : undefined };
    let operation = freshOperation;
    if (storedOperation) {
      try { operation = JSON.parse(storedOperation); }
      catch { operation = { ...freshOperation, operationId: storedOperation }; }
    }
    sessionStorage.setItem(operationKey, JSON.stringify(operation));
    const allowed = feedbackIntent(worldHost);
    setForkingEntryId(entryId);
    try {
      if (!newSessionId) {
        const res = await fetch(`/api/agent/${encodeURIComponent(sessionId)}`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: after ? "fork_branch" : "fork", entryId, ...operation }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error);
        newSessionId = (body.data as { newSessionId?: string } | undefined)?.newSessionId;
        if (newSessionId) pendingForks.current.set(key, newSessionId);
      }
      if (!newSessionId) throw new Error("这段历史还没有保存，暂时不能从这里分叉。");
      if (editedMessage) setDraft(newSessionId, { value: getUserMessageText(editedMessage), images: getUserMessageDraftImages(editedMessage) });
      const landed = await landOnFork(newSessionId, sessionId, entryId, allowed, current);
      if (!landed) {
        if (prompt) recoverForkPrompt(newSessionId, prompt);
        return;
      }
      pendingForks.current.delete(key); sessionStorage.removeItem(operationKey);
      // Only the explicit send in the selection composer authorizes this
      // prompt. The newly mounted host performs its usual send/retry flow.
      if (prompt) {
        clearDraft(newSessionId);
        setExplorationPrompt({ sessionId: newSessionId, text: prompt });
      }
    } catch (e) {
      if (newSessionId && prompt) recoverForkPrompt(newSessionId, prompt);
      if (current()) {
        setError(`分叉没有完成：${e instanceof Error ? e.message : String(e)}`);
        if (prompt) throw e;
      }
    } finally { forkInFlight.current = false; setForkingEntryId(null); }
  }, [landOnFork, worldHost, snapshot, turnGeometry.cards, nodes, recoverForkPrompt]);

  /** The one action that moves the agent: continue this session in one path. */
  const continueAt = useCallback(async (sessionId: string, entryId: string, editedMessage?: UserMessage): Promise<boolean> => {
    if (navigating) return false;
    continuationEpoch.current++;
    materialLocateRequest.current?.abort();
    setNavigating(true);
    try {
      const beforeResponse = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}?tail=1`);
      if (!beforeResponse.ok) throw new Error("无法核对当前路径。");
      const before = await beforeResponse.json() as { leafId: string | null };
      const res = await fetch(`/api/agent/${encodeURIComponent(sessionId)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "navigate_tree", targetId: entryId }),
      });
      const body = await res.json() as { error?: string; data?: { cancelled?: boolean; leafId?: string | null; editorText?: string } };
      if (!res.ok) throw new Error(body.error);
      // Pi can refuse the move (an extension cancelled it, a summary aborted).
      if (body.data?.cancelled) { setNotice("没能接着这条聊，Pi 取消了这次切换。"); return false; }
      if (openSessionId && openSessionId !== sessionId) materialDrafts.current.set(`session:${openSessionId}`, materials);
      const departureKey = `waygoal-path:${sessionId}:${before.leafId ?? "root"}`;
      const arrivalKey = `waygoal-path:${sessionId}:${body.data?.leafId ?? entryId}`;
      const currentDraft = getDraft(sessionId);
      if (currentDraft) setDraft(departureKey, currentDraft); else clearDraft(departureKey);
      // A Tree selection can enter a closed session directly on another path.
      // Park its last open composer's materials before replacing that path.
      materialDrafts.current.set(departureKey, sessionId === openSessionId
        ? materials
        : materialDrafts.current.get(`session:${sessionId}`) ?? []);
      const restored = getDraft(arrivalKey);
      if (restored) setDraft(sessionId, restored); else clearDraft(sessionId);
      if (body.data?.editorText) setDraft(sessionId, { value: body.data.editorText, images: [] });
      if (editedMessage) setDraft(sessionId, { value: getUserMessageText(editedMessage), images: getUserMessageDraftImages(editedMessage) });
      setMaterials(materialDrafts.current.get(arrivalKey) ?? (before.leafId === body.data?.leafId ? materialDrafts.current.get(`session:${sessionId}`) ?? [] : []));
      setViewing(null);
      setSelectedId(sessionId);
      setManageOpen(false);
      setPanelKey(k => k + 1);
      setNotice("现在在这条路径里继续，其他路径都还留着。");
      await patch({ lastViewed: sessionId, lastViewedEntry: null, preview: null });
      await loadTree(sessionId);
      await refresh(true);
      return true;
    } catch (e) {
      setError(`没能接着这条聊：${e instanceof Error ? e.message : String(e)}`);
      return false;
    } finally { setNavigating(false); }
  }, [loadTree, patch, refresh, navigating, materials, openSessionId]);

  const zoomBy = useCallback((factor: number, center?: WaygoalPoint, direct = false) => {
    viewDirty.current = true;
    (direct ? setViewDirect : setView)(v => {
      const box = cardBounds(sceneCards);
      const minimum = box ? Math.min(MIN_SCALE, Math.max(.001, Math.min((viewportSize.width - 96) / box.width, (viewportSize.height - 200) / box.height))) : MIN_SCALE;
      const scale = Math.min(MAX_SCALE, Math.max(minimum, v.scale * factor));
      if (!center) return { ...v, scale };
      const ratio = scale / v.scale;
      return { x: center.x - (center.x - v.x) * ratio, y: center.y - (center.y - v.y) * ratio, scale };
    });
  }, [sceneCards, viewportSize, setView, setViewDirect]);

  /** 回到全景 means the whole canvas: session cards and ticket cards alike, and
   *  a ticket takes as much room as the discussions shown under it. */
  const fitAll = useCallback(() => {
    viewDirty.current = true;
    const box = cardBounds(sceneCards);
    if (!box || viewportSize.width === 0) { setView(DEFAULT_VIEW); return; }
    const scale = Math.min(1, Math.max(.001, Math.min((viewportSize.width - 96) / box.width, (viewportSize.height - 200) / box.height)));
    setView(viewCenteredOn({ x: box.x + box.width / 2, y: box.y + box.height / 2 }, { ...DEFAULT_VIEW, scale }, viewportSize));
  }, [sceneCards, viewportSize, setView]);

  /** Move the view so a place on the canvas sits in the middle. Locating is
   *  only that: no session is opened, nothing is sent, and which path a
   *  session would continue on does not change. */
  const moveTo = useCallback((point: WaygoalPoint) => {
    viewDirty.current = true;
    setView(v => viewCenteredOn(point, v, viewportSize));
  }, [viewportSize, setView]);

  /** A hit in 查找: go to it and open it. Opening reads — it does not send. */
  const goToCard = useCallback((card: WaygoalCard) => {
    moveTo(cardCenter(card.kind === "session" ? { ...card, height: NODE_H } : card));
    if (card.kind === "session") {
      const node = nodes.find(n => n.id === card.id);
      if (node) openNode(node);
    } else openLocalTicket(card.id);
  }, [moveTo, nodes, openNode, openLocalTicket]);

  const minimapCards = useMemo(() => [
    ...cards.map(card => card.kind === "session" && expandedSessions.includes(card.id) ? { ...card, height: 58 } : card),
    ...turnGeometry.cards.map(card => ({ id: card.key, title: card.turn.question, kind: "session" as const, position: card.position, width: TURN_WIDTH, height: TURN_HEIGHT, modified: null })),
  ], [cards, expandedSessions, turnGeometry.cards]);
  const panFromMinimap = useCallback((next: WaygoalView) => {
    viewDirty.current = true;
    setViewDirect(next);
  }, [setViewDirect]);

  const ticketPositionsForMove = useCallback((id: string, position: WaygoalPoint) => {
    const map = placedTickets.find(m => m.path === id || m.tickets.some(t => t.id === id));
    return { ...(map ? Object.fromEntries(ticketCards([map]).map(c => [c.id, c.position])) : {}), [id]: position };
  }, [placedTickets]);
  const nudge = useCallback((id: string, from: WaygoalPoint, dx: number, dy: number) => {
    const position = { x: from.x + dx, y: from.y + dy };
    setDragging(d => ({ ...d, [id]: position }));
    void patch({ positions: ticketPositionsForMove(id, position) }).then(() => refresh()).then(() => setDragging(d => without(d, id)));
  }, [patch, refresh, ticketPositionsForMove]);
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
  const arrangeSelection = useCallback(async () => {
    const selected = cards.filter(card => picked.includes(card.id) && !tucked.has(card.id) && card.kind !== "group");
    if (selected.length < 2 || layoutBusy) return;
    const ids = new Set(selected.map(card => card.id));
    const obstacles = cards.filter(card => !ids.has(card.id)).map(card => ({ ...card.position, width: NODE_W, height: card.height }));
    obstacles.push(...groupFrames.filter(group => !group.members.some(id => ids.has(id)))
      .map(group => ({ x: group.left, y: group.top, width: group.width, height: group.height })));
    // Hidden members still reserve their saved space for when their group opens.
    obstacles.push(...(snapshot?.nodes ?? []).filter(node => tucked.has(node.id)).map(node => ({ ...node.position, width: NODE_W, height: NODE_H })));
    const parents = new Map(ticketCards(ticketMaps).map(card => [card.id, card.originId]));
    const after = arrangeCards(selected.map(card => {
      const node = nodes.find(item => item.id === card.id);
      return { ...card, originId: node?.origin?.sessionId ?? parents.get(card.id), created: node?.created,
        groupId: groups.find(group => group.members.includes(card.id))?.id };
    }), obstacles);
    const saved = new Map([...(snapshot?.nodes ?? []), ...ticketCards(snapshot?.tickets.maps ?? [])].map(card => [card.id, card.position]));
    const before = Object.fromEntries(selected.map(card => [card.id, saved.get(card.id) ?? card.position]));
    if (selected.every(card => before[card.id].x === after[card.id].x && before[card.id].y === after[card.id].y)) {
      setNotice("所选卡片已经排好了。"); return;
    }
    setLayoutBusy(true);
    try {
      if (await patch({ layout: { before, after } })) {
        setPicked([]);
        setNotice(`已整理 ${selected.length} 张卡片，可撤销上次整理。`);
        await refresh(true);
      }
    } finally { setLayoutBusy(false); }
  }, [cards, picked, tucked, layoutBusy, snapshot, nodes, groups, groupFrames, ticketMaps, patch, refresh]);
  const arrangeAllTickets = async () => {
    if (!snapshot || layoutBusy) return;
    const visibleMaps = ticketMaps.map(map => ({ ...map, tickets: map.tickets.filter(t => !tucked.has(t.id)) }));
    const ids = new Set(ticketCards(visibleMaps).map(c => c.id));
    const obstacles = cards.filter(c => !ids.has(c.id)).map(c => ({ ...c.position, width: c.width ?? NODE_W, height: c.height }));
    const after = arrangeTickets(visibleMaps, obstacles);
    const before = Object.fromEntries(ticketCards(snapshot.tickets.maps).filter(c => c.id in after).map(c => [c.id, c.position]));
    setLayoutBusy(true);
    try {
      if (await patch({ layout: { before, after } })) { await refresh(true); setNotice("已按票据归属整理，可撤销上次整理。"); }
    } finally { setLayoutBusy(false); }
  };
  const undoLayout = useCallback(async () => {
    if (layoutBusy) return;
    setLayoutBusy(true);
    try {
      if (await patch({ undoLayout: true })) setNotice("已恢复整理前的位置。");
      await refresh(true);
    } finally { setLayoutBusy(false); }
  }, [layoutBusy, patch, refresh]);
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
    else if (snapshot?.cwd) fileWorkspace.open({ path: `${snapshot.cwd}/${reference.path}`, cwd: snapshot.cwd });
  }, [openLocalTicket, snapshot?.cwd, fileWorkspace]);

  /** Everything a group frame or a manual link offers is one patch and a read;
   *  Pi's history, the active leaf and the tracker files are never touched. */
  const arrange = useCallback(async (body: WaygoalCanvasPatch) => {
    await patch(body);
    await refresh(true);
  }, [patch, refresh]);

  const onViewportPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || drag.current || e.button !== 0) return;
    const current = motion.grab();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { start: { x: e.clientX, y: e.clientY }, origin: { x: current.x, y: current.y }, moved: false, pointerId: e.pointerId };
  };
  /** Take hold of one card to drag it. The drag ends in the same handlers
   *  as a viewport pan, so the three kinds of card share this one start. */
  const onCardPointerDown = (id: string, origin: WaygoalPoint) => (e: React.PointerEvent<HTMLElement>) => {
    e.stopPropagation();
    if (drag.current || e.button !== 0) return;
    motion.grab();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id, start: { x: e.clientX, y: e.clientY }, origin, moved: false, pointerId: e.pointerId };
  };
  const clusterPositions = (id: string) => {
    const members = new Set(clusters.find(cluster => cluster.id === id)?.members ?? []);
    return Object.fromEntries([...ticketCards(ticketMaps), ...nodes].filter(card => members.has(card.id)).map(card => [card.id, card.position]));
  };
  const shiftedPositions = (members: Record<string, WaygoalPoint>, dx: number, dy: number) =>
    Object.fromEntries(Object.entries(members).map(([id, point]) => [id, {x: point.x + dx, y: point.y + dy}]));
  const clearClusterDrag = (members: Record<string, WaygoalPoint>) => setDragging(current =>
    Object.fromEntries(Object.entries(current).filter(([id]) => !(id in members))));
  const saveClusterMove = async (positions: Record<string, WaygoalPoint>) => {
    setMovingCluster(true);
    setDragging(current => ({...current, ...positions}));
    try { if (await patch({positions})) await refresh(true); }
    finally { clearClusterDrag(positions); setMovingCluster(false); }
  };
  const onClusterPointerDown = (id: string) => (event: React.PointerEvent<HTMLElement>) => {
    event.stopPropagation();
    if (drag.current || movingCluster || event.button !== 0) return;
    const camera = motion.grab();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {start: {x: event.clientX, y: event.clientY}, origin: {x: 0, y: 0}, moved: false,
      pointerId: event.pointerId, members: clusterPositions(id), scale: camera.scale};
  };
  const onClusterKeyDown = (id: string) => (event: React.KeyboardEvent) => {
    const step = event.shiftKey ? 50 : 10;
    const moves: Record<string, WaygoalPoint> = {ArrowLeft: {x: -step, y: 0}, ArrowRight: {x: step, y: 0}, ArrowUp: {x: 0, y: -step}, ArrowDown: {x: 0, y: step}};
    const delta = moves[event.key];
    if (!delta || movingCluster) return;
    event.preventDefault(); event.stopPropagation();
    void saveClusterMove(shiftedPositions(clusterPositions(id), delta.x, delta.y));
  };
  const onPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    e.stopPropagation();
    const dx = e.clientX - d.start.x, dy = e.clientY - d.start.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
    if (d.members) { if (d.moved) setDragging(p => ({...p, ...shiftedPositions(d.members!, dx / d.scale!, dy / d.scale!)})); }
    else if (d.id) setDragging(p => ({ ...p, [d.id!]: { x: d.origin.x + dx / view.scale, y: d.origin.y + dy / view.scale } }));
    else { viewDirty.current = true; setViewDirect(v => ({ ...v, x: d.origin.x + dx, y: d.origin.y + dy })); }
  };
  const onPointerUp = (e: React.PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    e.stopPropagation();
    if (d.members) {
      if (d.moved && e.type !== "pointercancel") void saveClusterMove(shiftedPositions(d.members, (e.clientX - d.start.x) / d.scale!, (e.clientY - d.start.y) / d.scale!));
      else clearClusterDrag(d.members);
    } else if (d.id && d.moved) {
      const id = d.id;
      const position = dragging[id];
      if (position) void patch({ positions: ticketPositionsForMove(id, { x: Math.round(position.x), y: Math.round(position.y) }) }).then(() => refresh()).then(() => setDragging(p => without(p, id)));
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

  return <main ref={motion.app} className="waygoal-app waygoal-spatial"
    onPointerDownCapture={() => motion.input("pointer")} onKeyDownCapture={() => motion.input("keyboard")}
    onClickCapture={event => { if (event.detail === 0) motion.input("keyboard"); }}
    data-panel-open={panelOpen || undefined} data-empty-entry={emptyEntry || undefined}
    data-files-visible={fileWorkspace.visible || undefined} data-files-expanded={fileWorkspace.expanded || undefined}>
    <header className="waygoal-top" data-collapsed={navigationCollapsed || undefined}>
      <div className="waygoal-top-content">
      <button type="button" className="waygoal-brand" aria-label={navigationCollapsed ? "展开导航" : "收起导航"} aria-expanded={!navigationCollapsed} title={navigationCollapsed ? "展开导航" : "收起导航"} onClick={() => setNavigationCollapsed(value => !value)}>waygoal<span>.</span></button>
      <WaygoalWorkspaceBar workspace={snapshot?.workspace ?? null} onOpen={openWorkspace} onSwitchCanvas={switchCanvas} onError={setError} onImported={async () => { await refresh(true); }} onOverview={() => { setOverviewRequested(true); setManageOpen(true); }} />
      <div className="waygoal-top-right">
        <button type="button" className="waygoal-button outlined" onClick={startNewChat} disabled={!snapshot}>新开聊天</button>
      </div>
      <nav className="waygoal-surface-switch" aria-label="工作区域">
        <button type="button" aria-pressed={!fileWorkspace.visible} onClick={fileWorkspace.hide}>画布</button>
        <button type="button" aria-pressed={fileWorkspace.visible} onClick={fileWorkspace.show}>文件{fileWorkspace.files.length ? ` · ${fileWorkspace.files.length}` : ""}</button>
      </nav>
      <details className="waygoal-navigation-menu" ref={navigationMenu}
        onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); } }}>
        <summary aria-label="工作区操作" title="工作区操作"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="4" cy="10" r="1.5" /><circle cx="10" cy="10" r="1.5" /><circle cx="16" cy="10" r="1.5" /></svg></summary>
        <nav aria-label="紧凑工作区域" onClick={event => { if ((event.target as Element).closest("button") && navigationMenu.current) navigationMenu.current.open = false; }}>
          <button type="button" onClick={startNewChat} disabled={!snapshot}>新开聊天</button>
          <button type="button" aria-pressed={!fileWorkspace.visible} onClick={fileWorkspace.hide}>画布</button>
          <button type="button" aria-pressed={fileWorkspace.visible} onClick={fileWorkspace.show}>文件{fileWorkspace.files.length ? ` · ${fileWorkspace.files.length}` : ""}</button>
        </nav>
      </details>
      </div>
    </header>
    {error && <div role="alert" className="waygoal-alert">{error}<button type="button" aria-label="关闭错误" onClick={() => setError("")}>×</button></div>}
    {notice && <div role="status" className="waygoal-notice">{notice}<button type="button" aria-label="关闭提示" onClick={() => setNotice("")}>×</button></div>}
    {trust?.requiresTrust && !trust.trusted && snapshot && <div role="status" className="waygoal-notice">这个目录带有项目级 skills 或扩展；Pi 需要你确认信任后才会加载它们。
      <button type="button" className="waygoal-button outlined small" onClick={() => void fetch("/api/project-trust", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd: snapshot.cwd }) }).then(r => r.json()).then(setTrust)}>信任此目录</button></div>}
    <div className="waygoal-stage">
      <section className="waygoal-canvas-area" aria-label="会话画布区域" aria-hidden={emptyEntry || fileWorkspace.visible || undefined} inert={emptyEntry || fileWorkspace.visible} data-managing={manageOpen || undefined}>
        <div className="waygoal-toolbar">
          <button type="button" className="waygoal-icon" aria-label="收起整理工具" onClick={() => setManageOpen(false)}>×</button>
          <h1>{cwdName || "会话画布"}</h1>
          <span className="waygoal-count">{snapshot ? `${nodes.length} 段会话${ticketCount ? ` · ${ticketCount} 张票据` : ""}${branchNodeCount ? ` · ${branchNodeCount} 段有会话内分叉` : ""}${runningCount ? ` · ${runningCount} 段正在运行` : ""}` : "正在读取…"}</span>
          {skipped.length > 0 && <span className="waygoal-count waygoal-skipped" title={skipped.map(s => `${s.path}：${s.reason}`).join("\n")}>
            {skipped.length} 个目录没有读成地图：{skipped.map(s => s.path).join("、")}
          </span>}
          <WaygoalFind cards={cards} onGo={goToCard} />
          {nodes.filter(node => !tucked.has(node.id)).length >= 2 && <button type="button" data-layout-pick-all className="waygoal-button outlined small"
            disabled={layoutBusy} title="选中可见的全部会话，再整理位置或建分组"
            onClick={() => setPicked(nodes.filter(node => !tucked.has(node.id)).map(node => node.id))}>全选会话</button>}
          {ticketCount > 1 && <button type="button" data-arrange-tickets className="waygoal-button outlined small" disabled={layoutBusy} onClick={() => void arrangeAllTickets()}>整理票据</button>}
          {snapshot?.canUndoLayout && <button type="button" data-layout-undo className="waygoal-button outlined small"
            disabled={layoutBusy} onClick={() => void undoLayout()}>撤销整理</button>}
          {picked.length === 0 && cards.length >= 2 && <span className="waygoal-count">⌘/Ctrl 点选卡片，可整理、分组或关联</span>}
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
        <WaygoalArrange picked={picked.flatMap(id => { const card = cardById.get(id); return card ? [{ id, title: card.title }] : []; })}
          onGroup={createGroup} onLink={createLink} onLayout={arrangeSelection} onClear={() => setPicked([])} />
        <div ref={viewportRef} className="waygoal-viewport" tabIndex={0} aria-label="会话画布：方向键平移，+ − 缩放，0 回到全景" role="region"
          onWheel={e => { motion.grab(); zoomBy(e.deltaY > 0 ? 0.92 : 1.08, { x: e.clientX - e.currentTarget.getBoundingClientRect().left, y: e.clientY - e.currentTarget.getBoundingClientRect().top }, true); }}
          onPointerDown={onViewportPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onKeyDown={onViewportKeyDown}>
          <div ref={setWorldHost} className="waygoal-world" data-ticket-zoom={view.scale < .72 ? "map" : "detail"} style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`, "--wg-map-text-scale": 1 / Math.max(.5, Math.min(1, view.scale)) } as React.CSSProperties}>
            <svg className="waygoal-links" width="1" height="1" aria-hidden="true">
              <defs><marker id={ticketArrowId} viewBox="0 0 12 12" refX="10" refY="6" markerUnits="userSpaceOnUse"
                markerWidth={12 / Math.max(.35, view.scale)} markerHeight={12 / Math.max(.35, view.scale)} orient="auto">
                <path className="waygoal-direction-arrow" d="M 2 2 L 10 6 L 2 10 Z" />
              </marker></defs>
              {originEdges.map(edge => {
                const start = borderAnchor(edge.from, edge.to);
                const end = borderAnchor(edge.to, edge.from);
                const mx = (start.x + end.x) / 2, my = (start.y + end.y) / 2;
                const label = edge.exact ? "分叉自这条消息" : "分叉自这段会话";
                // Cards the user dragged close together leave no room between
                // them; a label that would run under a card is dropped, and the
                // card's own 「分叉自「…」」 mark still says where it came from.
                const gap = Math.hypot(end.x - start.x, end.y - start.y);
                return <g key={`origin-${edge.id}`} data-session-origin={edge.id} data-spatial-edge={`origin:${edge.id}`} data-fork-target={edge.id} data-spatial-from={`node:${edge.fromId}`} data-spatial-to={`node:${edge.id}`} className="waygoal-link">
                  <path d={`M ${start.x} ${start.y} L ${end.x} ${end.y}`} />
                  <circle cx={end.x} cy={end.y} r={4.5} />
                  {gap >= label.length * LINK_LABEL_CHAR_W + 16
                    && <text x={mx} y={my - 9} textAnchor="middle">{label}</text>}
                </g>;
              })}
              {workRelations.map(edge => {
                if (edge.kind === "membership" && clusters.some(cluster => cluster.id === edge.from && cluster.members.includes(edge.to))) return null;
                const from = cardById.get(edge.from), to = cardById.get(edge.to);
                if (!from || !to || tucked.has(edge.from) || tucked.has(edge.to)) return null;
                const sourceTicket = ticketMaps.flatMap(map => map.tickets).find(ticket => ticket.id === edge.from);
                const sourceHeight = sourceTicket?.expanded
                  ? ticketChipTop(sourceTicket.discussions.length ? sourceTicket.discussions.length + 1 : 0) + 26
                  : sourceTicket ? 152 : from.height;
                const path = relationPath({ ...from.position, width: from.width ?? NODE_W, height: sourceHeight }, { ...to.position, width: to.width ?? NODE_W, height: to.kind === "ticket" ? 152 : to.height });
                return <g key={`${edge.kind}:${edge.from}:${edge.to}`} className={`waygoal-link ${edge.kind}`} data-ticket-relation={edge.kind}
                  data-spatial-from={`node:${edge.from}`} data-spatial-to={`node:${edge.to}`}>
                  <title>{edge.kind === "membership" ? `${from.title} 包含 ${to.title}` : `${to.title} 依赖 ${from.title}；箭头从前置票据指向后续票据`}</title>
                  <path d={path.d} markerEnd={`url(#${ticketArrowId})`} vectorEffect="non-scaling-stroke" />
                  {edge.kind === "membership" && <text x={path.mid.x} y={path.mid.y - 10} textAnchor="middle">包含</text>}
                </g>;
              })}
              {ticketEdges.map(edge => {
                const start = borderAnchor(edge.from, edge.to);
                const end = borderAnchor(edge.to, edge.from);
                return <g key={`ticket-${edge.id}`} data-spatial-from={`node:${edge.fromId}`} data-spatial-to={`node:${edge.toId}`} className="waygoal-link ticket">
                  <path d={`M ${start.x} ${start.y} L ${end.x} ${end.y}`} />
                  <circle cx={end.x} cy={end.y} r={4.5} />
                </g>;
              })}
              {/* Drawn by hand, so drawn differently: a solid line with a dot at
                  each end and no direction claimed. A fork's line says where a
                  history came from; this one says only what the user said. */}
              {manualEdges.map(edge => <g key={`manual-${edge.id}`} className="waygoal-link manual" data-link-line={edge.id} data-spatial-from={`node:${edge.fromId}`} data-spatial-to={`node:${edge.toId}`}>
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
            {clusterFrames.map(frame => <div key={frame.id} data-ticket-cluster={frame.id} data-node={frame.id}
              className={`waygoal-ticket-cluster${frame.collapsed ? " collapsed" : ""}${openTicket === frame.id ? " selected" : ""}`}
              style={{left: frame.left, top: frame.top, width: frame.width, height: frame.height}}>
              <div className="waygoal-ticket-cluster-head" data-cluster-head={frame.id} data-collapsed={frame.collapsed}>
                <div className="waygoal-ticket-cluster-title-row">
                <button type="button" className="waygoal-ticket-cluster-drag" data-cluster-drag={frame.id} data-cluster-open={frame.id} disabled={movingCluster}
                  aria-label={`移动票据集群：${frame.title}`} title={`${frame.title} · 点击查看详情，拖动整组移动，方向键微调`}
                  onPointerDown={onClusterPointerDown(frame.id)} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
                  onKeyDown={onClusterKeyDown(frame.id)}
                  onClick={event => { if (drag.current?.moved) return; if (event.metaKey || event.ctrlKey) togglePick(frame.id); else openLocalTicket(frame.id); }}>
                  <strong>{frame.rootTicket ? `#${frame.rootTicket.number} · ` : ""}{frame.title}</strong>

                </button>
                {!frame.collapsed && frame.rootTicket && <button type="button" className="waygoal-ticket-cluster-discuss" data-talk-start={frame.id}
                  onPointerDown={event => event.stopPropagation()} onClick={() => startTicketChat(frame.id)}>讨论 Map</button>}
                <button type="button" className="waygoal-ticket-cluster-toggle" data-cluster-toggle={frame.id}
                  disabled={clusterSaving || movingCluster} aria-expanded={!frame.collapsed} aria-label={`${frame.collapsed ? "展开" : "收起"}票据集群：${frame.title}`}
                  onPointerDown={event => event.stopPropagation()} onClick={() => void toggleCluster(frame.id, !frame.collapsed)}>
                  <svg viewBox="0 0 16 16" aria-hidden="true"><path d={frame.collapsed ? "m6 3 5 5-5 5" : "m3 6 5 5 5-5"} /></svg>
                </button>
                </div>
                {!frame.collapsed && <>
                  {frame.rootTicket?.question && <p className="waygoal-map-purpose">目标：{frame.rootTicket.question}</p>}
                  <div className="waygoal-map-meta"><span>{frame.ticketCount} 张票据 · {frame.completedCount} 已完成</span><span>虚线箭头：前置 → 后续</span></div>
                  {Boolean(frame.rootTicket?.discussions.length) && <div className="waygoal-map-discussions" onPointerDown={event => event.stopPropagation()}>
                    <span>Map 讨论</span>
                    {frame.rootTicket!.discussions.map(talk => <div key={talk.sessionId} className="waygoal-map-discussion">
                      <button type="button" data-map-discussion={talk.sessionId} disabled={talk.missing}
                        onClick={() => { const node = nodeById.get(talk.sessionId); if (node) openNode(node); }}>{talk.title}</button>
                      {!talk.missing && <button type="button" data-map-discussion-expand={talk.sessionId} aria-expanded={expandedSessions.includes(talk.sessionId)}
                        onClick={() => setSessionExpanded(talk.sessionId, !expandedSessions.includes(talk.sessionId))}>{expandedSessions.includes(talk.sessionId) ? "收起轮次" : "展开轮次"}</button>}
                    </div>)}
                  </div>}
                </>}
              </div>
              {frame.collapsed && <button type="button" className="waygoal-ticket-cluster-summary" onPointerDown={event => event.stopPropagation()} onClick={() => openLocalTicket(frame.id)}>
                <span>{frame.ticketCount} 张票据 · {frame.completedCount} 已完成</span>
                <span>{frame.sessionIds.length} 段讨论 <span aria-hidden="true">查看详情 →</span></span>
              </button>}
            </div>)}
            {clusters.filter(cluster => !cluster.collapsed).flatMap(cluster => (cluster.rootTicket?.discussions ?? []).flatMap(talk => {
              const card = cardById.get(talk.sessionId);
              if (!card || talk.missing || tucked.has(talk.sessionId)) return [];
              return <section key={`map-discussion:${talk.sessionId}`} data-map-session-region={talk.sessionId}
                className="waygoal-map-session-region" aria-label={`Map ${cluster.rootTicket!.number} 的讨论：${talk.title}`}
                style={{left: card.position.x - 14, top: card.position.y - 52, width: (card.width ?? NODE_W) + 28, height: card.height + 66}}>
                <span className="waygoal-map-session-owner">Map #{cluster.rootTicket!.number} 的讨论</span>
              </section>;
            }))}
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
            {nodes.filter(node => !tucked.has(node.id)).map(node => <Fragment key={node.id}><button key={node.id} type="button" data-node={node.id} data-spatial-key={`node:${node.id}`} data-spatial-owner={node.id}
              data-expanded={expandedSessions.includes(node.id) || undefined}
              className={`waygoal-node${node.id === selectedId ? " selected" : ""}${node.running ? " running" : ""}${viewing?.sessionId === node.id ? " viewing" : ""}${picked.includes(node.id) ? " picked" : ""}`}
              style={{ left: node.position.x, top: node.position.y, ...(expandedSessions.includes(node.id) ? { width: TURN_WIDTH } : {}) }}
              aria-pressed={node.id === selectedId} aria-expanded={expandedSessions.includes(node.id)}
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
              <strong data-spatial-face>{node.title}</strong>
              {(node.origin || node.branchPointCount > 0) && <span className="waygoal-node-marks">
                {node.origin && <span className="waygoal-tag origin">{node.origin.inWorkspace ? `分叉自「${node.origin.title}」` : "分叉自其他工作目录"}</span>}
                {node.branchPointCount > 0 && <span className="waygoal-tag branch">{node.branchPointCount} 处会话内分叉</span>}
              </span>}
              <span className="waygoal-node-foot"><span>{node.messageCount ? `${node.messageCount} 条消息` : "还没有消息"}</span><span aria-hidden="true">{expandedSessions.includes(node.id) ? "已展开" : "展开会话"}</span></span>
            </button>{expandedSessions.includes(node.id) && <button type="button" className="waygoal-session-collapse" data-collapse-session={node.id} data-spatial-key={`collapse:${node.id}`} data-spatial-owner={node.id} aria-label={`收起会话：${node.title}`}
              style={{ left: node.position.x + TURN_WIDTH - 54, top: node.position.y + 10 }}
              onPointerDown={event => event.stopPropagation()} onClick={() => setSessionExpanded(node.id, false)}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 10 4-4 4 4" /></svg></button>}</Fragment>)}
            {/* Local maps and their tickets, read from this workspace's own
                files. Opening one only reads it: no Pi session is started. */}
            {ticketMaps.map(map => <div key={map.path} className="waygoal-ticket-group">
              {[...(!map.remote ? [{ id: map.path, title: map.title, position: map.position, stale: map.stale, kind: mapKind(map.remote),
                  extra: " map", label: mapKind(map.remote), state: "", ticketState: null, lit: false, marks: null, foot: `${map.tickets.length} 张票据` }] : []),
                ...map.tickets.map(ticket => ({
                  id: ticket.id, title: ticket.title, position: ticket.position, stale: ticket.stale, kind: ticketKind(Boolean(ticket.remote)),
                  extra: ticket.type === "map" ? " map-ticket" : "", label: `${ticket.type === "map" ? "地图" : "票据"} ${ticket.number}`, state: ticket.type === "map" ? "" : ticket.type,
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
                  foot: ticket.question.slice(0, 80) || (ticket.remote ? "查看票据原文" : "还没写下要解决的问题"),
                }))]
                .filter(card => !tucked.has(card.id) && !clusters.some(cluster => cluster.id === card.id))
                .map(card => <button key={card.id} type="button" data-node={card.id}
                  data-state={card.ticketState ?? undefined} data-unblocked={card.lit ? "true" : undefined}
                  className={`waygoal-ticket-card${card.extra}${openTicket === card.id ? " selected" : ""}${card.stale ? " stale" : ""}${card.lit ? " unblocked" : ""}${picked.includes(card.id) ? " picked" : ""}`}
                  style={{ left: card.position.x, top: card.position.y }}
                  aria-pressed={openTicket === card.id}
                  aria-label={`${card.kind}：${card.title}${card.stale ? "，读不到来源文件" : ""}`}
                  onPointerDown={onCardPointerDown(card.id, card.position)}
                  onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
                  onKeyDown={onCardKeyDown(card.id, card.position)}
                  onClick={e => {
                    if (drag.current?.moved) return;
                    if (e.metaKey || e.ctrlKey) { togglePick(card.id); return; }
                    openLocalTicket(card.id);
                  }}>
                  <span className="waygoal-node-meta">
                    <span>{card.label}</span>
                    <span className="waygoal-node-state">{card.ticketState === "resolved" && <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 8 3 3 7-7" /></svg>}{card.stale ? "读不到来源" : card.ticketState === "resolved" ? "已完成" : card.ticketState === "cancelled" ? "已取消" : card.ticketState === "waiting" ? "等待前置" : card.ticketState ? "进行中" : card.state}</span>
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
              {map.tickets.filter(ticket => !tucked.has(ticket.id) && !clusters.some(cluster => cluster.id === ticket.id)).map(ticket => <Fragment key={`talks-${ticket.id}`}>
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
            {/* Only when there is nothing at all to look at: with tickets on the
                canvas this box would sit on top of them. */}
            {snapshot && nodes.length === 0 && ticketMaps.length === 0 && <div className="waygoal-empty" style={{ left: 0, top: 0 }}>
              <strong>这个目录还没有 Pi 会话。</strong>
              <p>点「新开聊天」开始一段讨论；已有的 Pi 会话会按真实身份出现在这里。不需要 Git 仓库、票据或特定 skill。</p>
            </div>}
          </div>
        {snapshot && <WaygoalTurnCanvas
          key={`${snapshot?.workspaceId}:${snapshot?.workspace.canvasId}`}
          sessionId={panelSession?.id ?? ""} targetVersion={panelKey} layouts={snapshot?.turnLayouts} board={snapshot?.turnBoard}
          onSaveBoard={async layout => {
            const saved = await patch({ turnBoard: layout });
            if (saved) setError(current => current.startsWith("画布记录没有保存") ? "" : current);
            return saved;
          }} sessions={turnSessions}
          expanded={visibleExpandedSessions} worldHost={worldHost} camera={view} setCamera={setView} onGrabCamera={motion.grab} setCameraDirect={next => { viewDirty.current = true; setViewDirect(next); }}
          onExpand={revealSession} onGeometry={receiveGeometry} onFit={fitAll}
          materials={materials} inspectEntry={inspectEntry} onDismissPreview={stopViewing}
          locateMaterial={locateMaterial ?? undefined} onMaterials={receiveMaterials}
          onOpenSession={id => { const node = nodes.find(node => node.id === id); if (node) openNode(node); }}
          onFork={(sessionId, entryId) => void forkFrom(sessionId, entryId, true)}
          onReady={id => { if (entranceSession === id) setEntranceSession(null); }}
          locateEntry={locateEntry} busy={Boolean(busyReason) || navigating || Boolean(forkingEntryId)}
          onOverview={() => setManageOpen(true)}
          onLocate={(sessionId, turn) => {
            const node = nodeById.get(sessionId);
            if (!node) return;
            // Opening another chat must never rewind its Pi leaf to the card.
            openNode(node, turn.active ? null : { sessionId, entryId: turn.endId, leafId: turn.endId, label: turn.question });
            setSearchTarget(turn.active ? { sessionId, entryId: turn.id } : null);
          }}
          onContinue={(sessionId, leafId) => void continueAt(sessionId, leafId)}
          onMaterial={(material, allowed) => { setMaterials(current => addMaterial(current, material)); setMaterialArrival({ material, allowed }); }} />}
        </div>
        <CanvasMinimap cards={minimapCards} view={view} viewportSize={viewportSize}
          edges={turnGeometry.edges} selectedId={selectedId} onGrab={motion.grab}
          onPan={panFromMinimap} onFit={fitAll} />
        <div className="waygoal-statusline"><span>拖动卡片摆放 · 拖动空白处平移 · 滚轮缩放 · 点击卡片定位原文 · 选择路径后继续聊天</span><span className="waygoal-id">{snapshot?.workspaceId}</span></div>

      </section>
      <FileWorkspace workspace={fileWorkspace} scope={cwd || snapshot?.cwd || ""} />
      {panelOpen && snapshot && <aside className="waygoal-panel" aria-label="讨论面板" data-session-id={panelSession?.id} aria-busy={Boolean(forkingEntryId) || navigating} ref={chatPanel}>
        {!emptyEntry && !openTicketMap && <WaygoalPanelResize />}
        <div className="waygoal-panel-head">
          {isMobile && <button type="button" className="waygoal-button outlined small" onClick={closePanel}>← 回到画布</button>}
          <div className="waygoal-panel-title">
            {!openTicketMap && <span className="waygoal-eyebrow">{navigating ? "正在切换…" : viewing ? "查看历史" : panelSession ? (selectedNode?.running ? "正在回复" : "正在继续") : pendingTicket ? "这张票下的新讨论" : "新的会话"}</span>}
            <strong>{viewing ? (nodeById.get(viewing.sessionId)?.title ?? "会话历史") : openTicketMap ? (openTicketCard?.title ?? openTicketMap.title)
              : panelSession ? (selectedNode?.title ?? createdSession?.firstMessage ?? "会话")
              : pendingTicket ? `${pendingTicketTitle ?? pendingTicket}：写下第一句，发送后这段讨论就挂在这张票下`
              : "先写下第一句，发送后这段会话才会出现在画布上"}</strong>
          </div>
          {/* A ticket keeps the name its source file gives it, and a path
              inside a session is not named at all: only a session gets these. */}
          {selectedNode && !viewing && <details className="waygoal-chat-settings"><summary aria-label="讨论设置">•••</summary><div><WaygoalRename key={selectedNode.id}
            sessionId={selectedNode.id} title={selectedNode.title} titleSource={selectedNode.titleSource}
            onRenamed={async () => { await refresh(true); }} onError={setError} onNotice={setNotice} /></div></details>}
          {!isMobile && <button type="button" className="waygoal-icon" aria-label="关闭面板" onClick={closePanel}>×</button>}
        </div>
        {openTicketMap && <WaygoalTicketPanel map={openTicketMap} ticket={openTicketCard} readAt={snapshot.tickets.readAt}
          onStart={ticket => startTicketChat(ticket.id)}
          onOpenDiscussion={id => { const node = nodes.find(n => n.id === id); if (node) openNode(node); }}
          onOpenReference={openReference}
          onReopenCheck={() => void arrange({ mapCheck: { map: openTicketMap.path, dismissed: false } })}
          onRefreshRelations={async ticket => { await retryRemote(ticket, "relations"); await refresh(true); }}
          onRetryRemote={ticket => void retryRemote(ticket).then(() => refresh(true))} />}
        {panelSession && !viewing && <WaygoalPaths
          origin={panelOrigin}
          branchPoints={tree?.sessionId === panelSession.id ? tree.branchPoints : []}
          viewingEntryId={null}
          busyReason={busyReason}
          loading={!tree || tree.sessionId !== panelSession.id}
          onViewOrigin={() => {
            if (!panelOrigin) return;
            if (!panelOrigin.inWorkspace) { setNotice("来源会话不在当前画布中。"); return; }
            // Nothing to continue from here: this is the source discussion, and
            // its own paths are chosen from its own panel.
            viewPath(panelOrigin.sessionId, panelOrigin.entryId, panelOrigin.entryId ? "来源讨论的这条消息" : "来源讨论", null);
          }}
          onView={choice => panelSession && viewPath(panelSession.id, choice.entryId, "这条路径", choice.leafId)}
        />}
        {viewing && <div className="waygoal-canvas-preview waygoal-history-panel" aria-label="会话历史">
          <div className="waygoal-history-actions">
            <button type="button" className="waygoal-button outlined small" aria-label="关闭预览" onClick={stopViewing}>返回当前聊天</button>
            {viewing.leafId && <button type="button" className="waygoal-button outlined small"
              disabled={navigating || Boolean(forkingEntryId) || Boolean(nodeById.get(viewing.sessionId)?.running)}
              onClick={() => void continueAt(viewing.sessionId, viewing.leafId!)}>切换到这条分支</button>}
          </div>
          <WaygoalPathView key={`${viewing.sessionId}:${viewing.entryId}`} sessionId={viewing.sessionId}
            leafId={viewing.leafId ?? viewing.entryId} cwd={snapshot.cwd} label={viewing.label}
            busyReason={nodeById.get(viewing.sessionId)?.running ? "这段会话正在回复，可以查看历史，回复结束后再切换或分叉。" : null}
            forkingEntryId={forkingEntryId}
            onFork={(entryId, message) => void forkFrom(viewing.sessionId, entryId, false, message)} />
        </div>}
        {!openTicketMap && <div className={`waygoal-panel-body waygoal-chat-body${viewing ? " history-hidden" : ""}`} inert={Boolean(forkingEntryId) || navigating || Boolean(viewing)} aria-hidden={Boolean(viewing)}>
          <div className="waygoal-chat-host">
          {<ChatWindow hideWelcome key={panelKey} chatInputRef={chatInput} session={panelSession} sessionRunning={selectedNode?.running ?? false}
                onOpenFile={path => fileWorkspace.open({ path, cwd: panelSession?.cwd ?? snapshot.cwd, sessionId: panelSession?.id })}
                quoteSelectionEnabled selectionBranchLabel="分叉探索"
                selectionBranchHint="发送后从这条回答分叉，带着所选片段继续探索。原讨论、草稿和待发送材料都会保留。"
                quoteSelectionClassName="waygoal-selection-popover"
                onAskInNewChat={async (prompt, sourceSessionId, sourceEntryId) => { await forkFrom(sourceSessionId, sourceEntryId, true, undefined, prompt); }}
                initialPrompt={explorationPrompt?.sessionId === panelSession?.id ? explorationPrompt?.text : undefined}
                onInitialPromptConsumed={() => setExplorationPrompt(null)}
                searchTarget={searchTarget} onSearchTargetHandled={clearSearchTarget}
                onNavigateEntry={(entryId, message) => panelSession ? continueAt(panelSession.id, entryId, message) : Promise.resolve(false)}
                onLocateEntry={locateTurn}
                onInspectReferences={entryId => { stopViewing(); setManageOpen(false); setInspectEntry({ entryId, serial: Date.now() }); }}
                onForkAfter={entryId => panelSession && void forkFrom(panelSession.id, entryId, true)}
                promptMaterials={materials} onPromptAccepted={() => {
                  // This callback belongs to the submitted render, not whatever
                  // session/path is visible when the response finally arrives.
                  if (!materials.length) return;
                  setMaterials(current => consumeMaterials(current, materials));
                  for (const [key, parked] of materialDrafts.current) materialDrafts.current.set(key, consumeMaterials(parked, materials));
                }}
                composerAccessory={<WaygoalMaterialTray key={panelSession?.id ?? draftKey ?? "new"} arrival={materialArrival} materials={materials} sourceLabels={materialLabels} onLocate={material => void locateMaterialSource(material)} onRemove={index => setMaterials(current => current.filter((_, i) => i !== index))} />}
                newSessionCwd={panelSession ? null : snapshot.cwd} newSessionDraftKey={panelSession ? null : draftKey}
                onSessionCreated={onSessionCreated}
                onSessionForked={(newSessionId, originEntryId) => {
                  const from = chatSessionId.current;
                  if (from) void landOnFork(newSessionId, from, originEntryId);
                }}
                forkLabel="从这里分叉"
                onAgentEnd={() => { void refresh(true); if (openSessionId) void loadTree(openSessionId); }} soundEnabled={false}
                onOpenSession={id => { const node = snapshot.nodes.find(n => n.id === id); if (node) openNode(node); }} />}
          </div>
        </div>}
      </aside>}
    </div>
  </main>;
}
