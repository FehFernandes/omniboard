import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import { Board } from "@omniboard/core";
import type {
  BoardElement,
  BoardOptions,
  CameraState,
  ToolType,
  Theme,
} from "@omniboard/core";

export interface OmniBoardProps extends BoardOptions {
  className?: string;
  style?: React.CSSProperties;
  /** Controlled/initial tool. */
  tool?: ToolType;
  /** Called whenever elements change (create/move/delete/undo...). */
  onChange?: (elements: BoardElement[]) => void;
  onSelectionChange?: (ids: string[]) => void;
  onToolChange?: (tool: ToolType) => void;
  onThemeChange?: (theme: Theme) => void;
  onCameraChange?: (camera: CameraState) => void;
  /** Access the underlying Board instance once mounted. */
  onReady?: (board: Board) => void;
}

/** Imperative handle exposed via ref. */
export type OmniBoardHandle = Board;

export const OmniBoard = forwardRef<OmniBoardHandle | null, OmniBoardProps>(
  function OmniBoard(props, ref) {
    const {
      className,
      style,
      tool,
      onChange,
      onSelectionChange,
      onToolChange,
      onThemeChange,
      onCameraChange,
      onReady,
      ...boardOptions
    } = props;

    const containerRef = useRef<HTMLDivElement | null>(null);
    const boardRef = useRef<Board | null>(null);

    // Keep latest callbacks in refs so we don't re-create the board.
    const cbs = useRef({
      onChange,
      onSelectionChange,
      onToolChange,
      onThemeChange,
      onCameraChange,
      onReady,
    });
    cbs.current = {
      onChange,
      onSelectionChange,
      onToolChange,
      onThemeChange,
      onCameraChange,
      onReady,
    };

    useImperativeHandle(ref, () => boardRef.current as Board, []);

    // Mount once.
    useEffect(() => {
      if (!containerRef.current) return;
      const board = new Board(containerRef.current, boardOptions);
      boardRef.current = board;

      const offs = [
        board.on("change", (e) => {
          if (e.type === "change") cbs.current.onChange?.(e.elements);
        }),
        board.on("selectionChange", (e) => {
          if (e.type === "selectionChange") cbs.current.onSelectionChange?.(e.ids);
        }),
        board.on("toolChange", (e) => {
          if (e.type === "toolChange") cbs.current.onToolChange?.(e.tool);
        }),
        board.on("themeChange", (e) => {
          if (e.type === "themeChange") cbs.current.onThemeChange?.(e.theme);
        }),
        board.on("cameraChange", (e) => {
          if (e.type === "cameraChange") cbs.current.onCameraChange?.(e.camera);
        }),
      ];

      cbs.current.onReady?.(board);

      return () => {
        offs.forEach((off) => off());
        board.destroy();
        boardRef.current = null;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Sync tool prop.
    useEffect(() => {
      if (tool && boardRef.current && boardRef.current.getTool() !== tool) {
        boardRef.current.setTool(tool);
      }
    }, [tool]);

    // Sync theme prop.
    useEffect(() => {
      const t = props.theme;
      if (t && boardRef.current && boardRef.current.getTheme() !== t) {
        boardRef.current.setTheme(t);
      }
    }, [props.theme]);

    return (
      <div
        ref={containerRef}
        className={className}
        style={{ width: "100%", height: "100%", ...style }}
      />
    );
  },
);
