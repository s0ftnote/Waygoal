import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { beaconSnapshot } from "./beacon-store";

// Observe the real tracker. The extension never invents tickets or decisions.
export function createBeaconExtension(cwd: string): ExtensionFactory {
  return (pi) => {
    if (!existsSync(join(cwd, ".beacon-prototype"))) return;
    pi.on("before_agent_start", (event) => ({
      systemPrompt: event.systemPrompt + "\n\nBeacon 本地画布约定：票据是本地 tracker 的原文件，不维护第二份任务状态。创建票据前必须列出本地图 issues 目录的全部文件，取最大编号加一，不能复用已有编号。一个节点绑定一个会话：当前票据完成后可以按 Wayfinder 将看清的问题开为新票，但不要在当前会话开始询问或解决新 HITL 票据；告诉用户在地图上选择下一节点。新票据的阻塞必须包含真正尚未确定的前提；不要重复把已经开票的问题放在 Not yet specified。任何 HITL 结论必须来自人实际回答。",
    }));
    const digest = () => JSON.stringify(beaconSnapshot(cwd).maps.map(map => ({
      ...map, tickets: map.tickets.map(ticket => ({ ...ticket, binding: undefined })),
    })));
    let previous = digest();
    const refresh = () => {
      try {
        const next = digest();
        if (next !== previous) {
          previous = next;
          pi.appendEntry("beacon:map-changed", { cwd });
        }
      } catch { /* A file may be between writes; the next event retries. */ }
    };
    pi.on("tool_result", refresh);
    pi.on("agent_end", refresh);
  };
}
