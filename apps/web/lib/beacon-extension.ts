import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import { GITHUB_COMMAND } from "./waygoal-remote";
import { deliverRemoteTicket } from "./waygoal-remote-store";
import { loadSkillsWithInstallInfo } from "./skills-service";

/** What one delivery answers: which card it landed on, whether the canvas is
 *  in sync with the source, and why not when it is not. The source operation
 *  succeeding is what caused the call; this is the other fact. */
interface WaygoalDeliveryDetails {
  ticket: string | null;
  synced: boolean;
  note: string | null;
}

export const MISSING_SKILL_NOTICE = (name: string) => `没有找到 skill「${name}」，这条消息没有发送。输入 / 可以查看已安装的 skills。`;

/**
 * Parse a raw `/skill:name args` input; null for anything else. Mirrors Pi's
 * own `_expandSkillCommand` exactly (no trimming), so every input the
 * extension lets through is one Pi will expand.
 */
export function parseSkillCommand(text: string): { name: string } | null {
  if (!text.startsWith("/skill:")) return null;
  const spaceIndex = text.indexOf(" ");
  return { name: spaceIndex === -1 ? text.slice(7) : text.slice(7, spaceIndex) };
}

/**
 * Names of the skills the session itself has loaded. The host passes a
 * reader bound to the session's own resource loader so the check agrees
 * with what Pi will expand; the fallback loads skills the way pi-web's
 * skills API does.
 */
export type SkillNameLoader = (cwd: string) => Promise<string[]> | string[];
const defaultSkillNames: SkillNameLoader = async (cwd) => (await loadSkillsWithInstallInfo(cwd)).skills.map(s => s.name);

// Waygoal's in-process Pi extension. Two narrow jobs:
// 1. Tell the user plainly when a `/skill:` command names a skill Pi has not
//    loaded, instead of letting the literal text go to the model.
// 2. Take delivery of a remote ticket the Agent has just read, as a registered
//    tool: the source identity and where the raw result is, nothing else.
export function createBeaconExtension(cwd: string, skillNames: SkillNameLoader = defaultSkillNames, agentDir = getAgentDir()): ExtensionFactory {
  return (pi) => {
    // A registered tool is the one trigger that fires reliably: Pi calls it
    // with checked arguments. Nothing here reads the Agent's prose, and the
    // Agent never supplies the ticket's text — only where its own result is.
    pi.registerTool({
      name: "waygoal_remote_ticket",
      label: "Waygoal 来源票据",
      description: `把刚读到的远程票据交给 Waygoal 画布。只给来源身份和原始结果所在的文件，正文由 Waygoal 自己读；不要复述或改写票据正文。原始结果必须先写在工作目录里，例如 ${GITHUB_COMMAND} > .scratch/remote/<编号>.json。`,
      promptSnippet: "读到远程票据后，用 waygoal_remote_ticket 把来源和结果文件交给画布",
      parameters: Type.Object({
        source: StringEnum(["github", "custom"] as const),
        origin: Type.String({ description: "来源里这批票据的归属，例如 owner/repo" }),
        number: Type.String({ description: "票据在来源里的编号" }),
        result_path: Type.String({ description: "原始结果文件，位于工作目录内" }),
      }),
      async execute(_toolCallId, params): Promise<{ content: { type: "text"; text: string }[]; details: WaygoalDeliveryDetails }> {
        // The source operation already succeeded — that is why this is being
        // called. Whether the canvas is in sync is the separate fact, and it
        // is the one this answers.
        try {
          const delivered = deliverRemoteTicket({ cwd, agentDir }, {
            source: params.source, origin: params.origin, number: params.number, ref: params.result_path,
          });
          const text = delivered.captured
            ? `已同步到画布：${delivered.ticket}${delivered.note ? `（${delivered.note}）` : ""}`
            : `画布上这张票据未同步：${delivered.note ?? "没有读到原始结果"}。把结果重新写到工作目录后可以再交付一次。`;
          return { content: [{ type: "text", text }], details: { ticket: delivered.ticket, synced: delivered.captured, note: delivered.note } };
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          return { content: [{ type: "text", text: `未同步：${reason}` }], details: { ticket: null, synced: false, note: reason } };
        }
      },
    });
    pi.on("input", async (event, ctx) => {
      const command = parseSkillCommand(event.text);
      if (!command || event.source === "extension") return { action: "continue" };
      let names: string[];
      try { names = await skillNames(cwd); } catch { return { action: "continue" }; }
      // Pi passes unknown `/skill:` text through literally; only a loaded name gets expanded.
      if (names.includes(command.name)) return { action: "continue" };
      ctx.ui.notify(MISSING_SKILL_NOTICE(command.name || "（空）"), "warning");
      return { action: "handled" };
    });
  };
}
