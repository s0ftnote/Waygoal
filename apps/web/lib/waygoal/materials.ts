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
  const metadata = materials.map(({ sessionId, turnId, scope, capturedAt, parts }) => ({ sessionId, turnId, scope, capturedAt, entryIds: parts.map(part => part.entryId) }));
  return text + MARKER + JSON.stringify(metadata).replaceAll("--", "\\u002d\\u002d") + " -->\n\n### 引用材料\n\n"
    + materials.map(material => `#### ${MATERIAL_SCOPES[material.scope]}\n来源会话：${material.sessionId} · 消息：${material.turnId}\n取得时间：${material.capturedAt}\n\n`
      + material.parts.map(part => `**${part.role}**\n\n${part.text.split("\n").map(line => `> ${line}`).join("\n")}`).join("\n\n")).join("\n\n");
}

export function materialSources(text: string): { question: string; sources: Pick<MaterialSnapshot, "sessionId" | "turnId" | "scope">[] } {
  const start = text.lastIndexOf(MARKER);
  if (start < 0) return { question: text, sources: [] };
  try {
    const end = text.indexOf(" -->", start);
    const parsed: unknown = JSON.parse(text.slice(start + MARKER.length, end));
    if (!Array.isArray(parsed) || !parsed.every(source => source && typeof source.sessionId === "string" && typeof source.turnId === "string" && Object.hasOwn(MATERIAL_SCOPES, source.scope))) throw new Error("Invalid sources");
    return { question: text.slice(0, start), sources: parsed };
  } catch { return { question: text, sources: [] }; }
}
