"use client";
import type { WaygoalBranchChoice, WaygoalBranchPoint } from "@/lib/waygoal-branches";
import type { WaygoalNodeOrigin } from "@/lib/waygoal-types";

interface Props {
  origin: WaygoalNodeOrigin | null;
  branchPoints: WaygoalBranchPoint[];
  /** Read-only position open right now, if it is inside this session. */
  viewingEntryId: string | null;
  /** Refused while Pi is working on this session; reading stays available. */
  busyReason: string | null;
  loading: boolean;
  onViewOrigin: () => void;
  onView: (choice: WaygoalBranchChoice) => void;
  onContinue: (entryId: string) => void;
}

function OriginRow({ origin, onViewOrigin }: { origin: WaygoalNodeOrigin; onViewOrigin: () => void }) {
  const name = origin.title ?? origin.sessionId;
  if (!origin.inWorkspace) {
    return <p className="waygoal-path-note">分叉自另一个工作目录里的会话（<code>{origin.sessionId}</code>）。这里不按标题猜测对应的历史。</p>;
  }
  if (!origin.entryId) {
    return <p className="waygoal-path-note">
      分叉自「{name}」。这次分叉不是在画布上做的，Pi 只记下了来源会话，没有留下具体消息位置。
      <button type="button" className="waygoal-button outlined small" onClick={onViewOrigin}>打开来源会话</button>
    </p>;
  }
  return <p className="waygoal-path-note">
    分叉自「{name}」的一条消息，原路径仍然保留。
    <button type="button" className="waygoal-button outlined small" onClick={onViewOrigin}>回到来源这条消息</button>
  </p>;
}

/** Where this discussion came from and which paths it splits into. Every row
 *  separates the two actions the design asks for: 只看这段 changes only what is
 *  displayed, 从这里继续 changes the path the next message goes into. */
export function WaygoalPaths({ origin, branchPoints, viewingEntryId, busyReason, loading, onViewOrigin, onView, onContinue }: Props) {
  if (!origin && branchPoints.length === 0) {
    return loading ? null : <div className="waygoal-paths"><p className="waygoal-path-note">这段讨论还没有分叉。把鼠标停在自己发过的消息上，点「从这里分叉」，就会分出一条保留来源、可以独立继续的路径。</p></div>;
  }
  return <div className="waygoal-paths" aria-label="路径">
    {origin && <OriginRow origin={origin} onViewOrigin={onViewOrigin} />}
    {branchPoints.map((point, index) => <section key={point.entryId ?? `root-${index}`} className="waygoal-path-point">
      <h2>{point.entryId ? "分叉点" : "会话开头分叉"} · {point.preview}</h2>
      <ul>
        {point.choices.map((choice, order) => <li key={choice.entryId} className={choice.active ? "active" : undefined}>
          <span className="waygoal-path-order">路径 {order + 1}</span>
          <span className="waygoal-path-preview" title={choice.preview}>{choice.preview}</span>
          <span className="waygoal-path-steps">{choice.steps > 0 ? `+${choice.steps} 条` : "路径末端"}</span>
          {choice.active && <span className="waygoal-tag continuing">继续位置</span>}
          {viewingEntryId === choice.entryId && <span className="waygoal-tag reading">正在查看</span>}
          <button type="button" className="waygoal-button outlined small" onClick={() => onView(choice)}>只看这段</button>
          <button type="button" className="waygoal-button outlined small" onClick={() => onContinue(choice.leafId)}
            disabled={Boolean(busyReason) || choice.active}
            title={busyReason ?? (choice.active ? "已经是当前的继续位置" : "下一次发送进入这条路径")}>
            {choice.active ? "已在这里继续" : "从这里继续"}
          </button>
        </li>)}
      </ul>
    </section>)}
    {busyReason && <p className="waygoal-path-note">{busyReason}</p>}
  </div>;
}
