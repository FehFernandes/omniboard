import { useCallback, useRef, useState } from "react";
import type { Board } from "@omniboard/core";
import type { BoardElement, ToolType, Theme } from "@omniboard/core";

export interface UseBoardResult {
  /** Pass to <OmniBoard onReady={ready} /> */
  ready: (board: Board) => void;
  board: Board | null;
  tool: ToolType;
  setTool: (tool: ToolType) => void;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  elements: BoardElement[];
  selectedIds: string[];
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  duplicate: () => void;
  deleteSelected: () => void;
  onChange: (elements: BoardElement[]) => void;
  onSelectionChange: (ids: string[]) => void;
  onToolChange: (tool: ToolType) => void;
  onThemeChange: (theme: Theme) => void;
}

/**
 * Convenience hook that wires OmniBoard state into React for building toolbars.
 *
 *   const b = useBoard();
 *   <OmniBoard onReady={b.ready} onChange={b.onChange}
 *              onSelectionChange={b.onSelectionChange} onToolChange={b.onToolChange} />
 */
export function useBoard(): UseBoardResult {
  const boardRef = useRef<Board | null>(null);
  const [, force] = useState(0);
  const [tool, setToolState] = useState<ToolType>("selection");
  const [theme, setThemeState] = useState<Theme>("light");
  const [elements, setElements] = useState<BoardElement[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const rerender = useCallback(() => force((n) => n + 1), []);

  const ready = useCallback(
    (board: Board) => {
      boardRef.current = board;
      setElements(board.getElements());
      setToolState(board.getTool());
      setThemeState(board.getTheme());
      rerender();
    },
    [rerender],
  );

  const setTool = useCallback((t: ToolType) => {
    boardRef.current?.setTool(t);
    setToolState(t);
  }, []);

  const setTheme = useCallback((t: Theme) => {
    boardRef.current?.setTheme(t);
    setThemeState(t);
  }, []);

  const toggleTheme = useCallback(() => {
    boardRef.current?.toggleTheme();
    setThemeState(boardRef.current?.getTheme() ?? "light");
  }, []);

  const undo = useCallback(() => {
    boardRef.current?.undo();
    rerender();
  }, [rerender]);

  const redo = useCallback(() => {
    boardRef.current?.redo();
    rerender();
  }, [rerender]);

  const duplicate = useCallback(() => {
    boardRef.current?.duplicateSelected();
    rerender();
  }, [rerender]);

  const deleteSelected = useCallback(() => {
    boardRef.current?.deleteSelected();
    rerender();
  }, [rerender]);

  const onChange = useCallback(
    (els: BoardElement[]) => {
      setElements(els);
      rerender();
    },
    [rerender],
  );

  const onSelectionChange = useCallback((ids: string[]) => setSelectedIds(ids), []);
  const onToolChange = useCallback((t: ToolType) => setToolState(t), []);
  const onThemeChange = useCallback((t: Theme) => setThemeState(t), []);

  return {
    ready,
    board: boardRef.current,
    tool,
    setTool,
    theme,
    setTheme,
    toggleTheme,
    elements,
    selectedIds,
    canUndo: boardRef.current?.canUndo() ?? false,
    canRedo: boardRef.current?.canRedo() ?? false,
    undo,
    redo,
    duplicate,
    deleteSelected,
    onChange,
    onSelectionChange,
    onToolChange,
    onThemeChange,
  };
}
