"use client";

import { useRef, useReducer } from "react";
import { getFileName } from "@/features/workspace/file-paths";
import { FileViewer, type FileViewerState } from "./FileViewer";
import "./FileWorkspace.css";

import { EMPTY_FILE_WORKSPACE, fileWorkspaceReducer, type ReadingFile } from "@/features/workspace/file-workspace";

/** Reading state belongs to the working directory, independently of the chat. */
export function useFileWorkspace(scope: string) {
  const [workspaces, dispatch] = useReducer(fileWorkspaceReducer, {});
  return {
    ...(workspaces[scope] ?? EMPTY_FILE_WORKSPACE),
    open: (file: ReadingFile) => dispatch({ scope, action: { type: "open", file } }),
    select: (path: string) => dispatch({ scope, action: { type: "select", path } }),
    show: () => dispatch({ scope, action: { type: "show" } }),
    hide: () => dispatch({ scope, action: { type: "hide" } }),
    expand: () => dispatch({ scope, action: { type: "expand" } }),
    close: (path: string) => dispatch({ scope, action: { type: "close", path } }),
  };
}

export function FileWorkspace({ workspace, scope }: { workspace: ReturnType<typeof useFileWorkspace>; scope: string }) {
  const positions = useRef(new Map<string, FileViewerState>());
  const file = workspace.files.find(item => item.path === workspace.active);
  const positionKey = file ? JSON.stringify([scope, file.path]) : "";
  return <section className="waygoal-files" aria-label="文件阅读区" hidden={!workspace.visible}
    onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); workspace.hide(); }
    }}>
    <header className="waygoal-files-heading">
      <strong>文件</strong>
      <div>
        <button type="button" onClick={workspace.expand} aria-pressed={workspace.expanded}>{workspace.expanded ? "退出放大" : "放大阅读"}</button>
        <button type="button" onClick={workspace.hide}>收起文件</button>
      </div>
    </header>
    {workspace.files.length > 0 && <div className="waygoal-file-tabs" aria-label="已打开文件">
      {workspace.files.map(item => <div className="waygoal-file-tab" key={item.path} data-active={item.path === workspace.active || undefined}>
        <button type="button" title={item.path} aria-pressed={item.path === workspace.active} onClick={() => workspace.select(item.path)}>{getFileName(item.path)}</button>
        <button type="button" aria-label={`关闭文件 ${getFileName(item.path)}`} onClick={() => workspace.close(item.path)}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 4 8 8m0-8-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
        </button>
      </div>)}
    </div>}
    <div className="waygoal-files-content">
      {file && workspace.visible ? <FileViewer key={positionKey} filePath={file.path} cwd={file.cwd} sourceSessionId={file.sessionId}
        initialDisplayMode="preview" initialState={positions.current.get(positionKey)}
        onStateChange={state => positions.current.set(positionKey, state)}
        onOpenFile={path => workspace.open({ ...file, path })} />
        : <div className="waygoal-files-empty"><strong>在这里查看文件</strong><p>点击聊天中的文件链接，文件会在这里打开。右侧可以继续讨论。</p><button type="button" onClick={workspace.hide}>回到画布</button></div>}
    </div>
  </section>;
}
