export type MaterialScope = "turn" | "answer" | "user" | "path" | "excerpt";
export const MATERIAL_SCOPES: Record<MaterialScope, string> = { turn: "整轮文字", answer: "回答", user: "用户消息", path: "完整路径文字", excerpt: "回答摘录" };
export interface MaterialSnapshot {
  sessionId: string;
  turnId: string;
  scope: MaterialScope;
  capturedAt: string;
  targetLeafId: string | null;
  /** Text only: no inferred descriptions of images, no hidden tool payloads. */
  parts: { entryId: string; role: string; text: string }[];
}
const MARKER = "\n\n<!-- waygoal-materials:";
const BODY = "\n\n### 引用材料\n\n";
export interface MaterialSource {
  sessionId: string;
  turnId: string;
  scope: MaterialScope;
  capturedAt?: string;
  /** The exact submitted material block, never a re-read of its source. */
  snapshot: string;
  sharedSnapshot: boolean;
}

/** Overlapping path/turn selections share original entries. Keep each piece
 * once in the review tray, so preview and send never disagree about dedup. */
export function addMaterial(current: MaterialSnapshot[], material: MaterialSnapshot): MaterialSnapshot[] {
  const remaining = current.filter(item => item.sessionId !== material.sessionId || item.turnId !== material.turnId);
  const next = [...remaining, material];
  return next.flatMap((item, index) => {
    const parts = item.parts.filter(part => !next.some((other, otherIndex) => other.sessionId === item.sessionId && other.parts.some(candidate => candidate.entryId === part.entryId && candidate.text.includes(part.text) && (candidate.text.length > part.text.length || otherIndex < index))));
    return parts.length ? [{ ...item, parts }] : [];
  });
}

export function materialPrompt(text: string, materials: MaterialSnapshot[]): string {
  if (!materials.length) return text;
  let body = "";
  const metadata = materials.map(material => {
    if (body) body += "\n\n";
    const start = body.length;
    body += `#### ${MATERIAL_SCOPES[material.scope]}\n来源会话：${material.sessionId} · 消息：${material.turnId}\n取得时间：${material.capturedAt}\n\n`
      + material.parts.map(part => `**${part.role}**\n\n${part.text.split("\n").map(line => `> ${line}`).join("\n")}`).join("\n\n");
    return { sessionId: material.sessionId, turnId: material.turnId, scope: material.scope, capturedAt: material.capturedAt,
      entryIds: material.parts.map(part => part.entryId), start, end: body.length };
  });
  return text + MARKER + JSON.stringify(metadata).replaceAll("--", "\\u002d\\u002d") + " -->" + BODY + body;
}

export function materialSources(text: string): { question: string; sources: MaterialSource[] } {
  const start = text.lastIndexOf(MARKER);
  if (start < 0) return { question: text, sources: [] };
  try {
    const end = text.indexOf(" -->", start);
    const parsed: unknown = JSON.parse(text.slice(start + MARKER.length, end));
    if (!Array.isArray(parsed) || !parsed.every(source => source && typeof source.sessionId === "string" && typeof source.turnId === "string" && Object.hasOwn(MATERIAL_SCOPES, source.scope))) throw new Error("Invalid sources");
    const tail = text.slice(end + " -->".length);
    const body = tail.startsWith(BODY) ? tail.slice(BODY.length) : tail;
    return { question: text.slice(0, start), sources: parsed.map(source => {
      const scoped = Number.isInteger(source.start) && Number.isInteger(source.end) && source.start >= 0 && source.end > source.start && source.end <= body.length;
      return { sessionId: source.sessionId, turnId: source.turnId, scope: source.scope,
        capturedAt: typeof source.capturedAt === "string" ? source.capturedAt : undefined,
        snapshot: scoped ? body.slice(source.start, source.end) : body, sharedSnapshot: !scoped };
    }) };
  } catch { return { question: text, sources: [] }; }
}
