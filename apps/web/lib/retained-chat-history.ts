import type { AgentMessage } from "./types";

interface History {
  messages: AgentMessage[];
  entryIds: string[];
  oldestEntryId: string | null;
  hasMore: boolean;
}

/** A refresh returns a tail page. An overlapping original entry proves its
 * ancestry, so already-read ancestors can remain mounted across a new turn.
 * Without that overlap we do not guess that two branches share a prefix. */
export function retainChatAncestors<T extends History>(previous: History, incoming: T): T {
  const overlap = incoming.entryIds[0] ? previous.entryIds.indexOf(incoming.entryIds[0]) : -1;
  if (overlap <= 0) return incoming;
  return { ...incoming, messages: [...previous.messages.slice(0, overlap), ...incoming.messages], entryIds: [...previous.entryIds.slice(0, overlap), ...incoming.entryIds], oldestEntryId: previous.oldestEntryId, hasMore: previous.hasMore };
}
