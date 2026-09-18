export type ReadingFile = { path: string; cwd: string; sessionId?: string };
export type FileWorkspaceState = { files: ReadingFile[]; active: string | null; visible: boolean; expanded: boolean };
export const EMPTY_FILE_WORKSPACE: FileWorkspaceState = { files: [], active: null, visible: false, expanded: false };
type Action = { type: "open"; file: ReadingFile } | { type: "select" | "close"; path: string } | { type: "show" | "hide" | "expand" };

export function fileWorkspaceReducer(all: Record<string, FileWorkspaceState>, { scope, action }: { scope: string; action: Action }): Record<string, FileWorkspaceState> {
  const value = all[scope] ?? EMPTY_FILE_WORKSPACE;
  let next: FileWorkspaceState;
  switch (action.type) {
    case "open":
      next = { ...value, visible: true, active: action.file.path,
        files: value.files.some(item => item.path === action.file.path) ? value.files : [...value.files, action.file] };
      break;
    case "select":
      if (!value.files.some(file => file.path === action.path)) return all;
      next = { ...value, active: action.path };
      break;
    case "close": {
      const index = value.files.findIndex(file => file.path === action.path);
      if (index < 0) return all;
      const files = value.files.filter(file => file.path !== action.path);
      next = { ...value, files, active: value.active === action.path ? files[Math.min(index, files.length - 1)]?.path ?? null : value.active };
      break;
    }
    case "hide": next = { ...value, visible: false, expanded: false }; break;
    case "show": next = { ...value, visible: true }; break;
    case "expand": next = { ...value, expanded: !value.expanded }; break;
  }
  return { ...all, [scope]: next };
}
