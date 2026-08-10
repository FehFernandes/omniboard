# @omniboard/react

A React wrapper for [@omniboard/core](../core/README.md). It is two things: a
component that mounts and unmounts the board at the right point of the lifecycle,
and a hook that mirrors its state into React state.

No canvas logic lives here — it is a thin shell. If you need something the wrapper
does not expose, use the `Board` instance directly.

```bash
npm i @omniboard/react     # core comes along as a dependency
```

The package re-exports everything from core, so a single import is enough:

```tsx
import { OmniBoard, useBoard, type BoardElement } from "@omniboard/react";
```

## Usage

`<OmniBoard />` fills its parent, and the parent needs a size of its own — hence
the `position: fixed; inset: 0` wrapper below. Without dimensions the canvas
renders 1×1 and the board looks blank.

```tsx
function App() {
  const b = useBoard();

  return (
    <div style={{ position: "fixed", inset: 0 }}>
      <button onClick={() => b.setTool("rectangle")}>Rectangle</button>
      <button onClick={b.undo} disabled={!b.canUndo}>Undo</button>
      <button onClick={b.toggleTheme}>Theme</button>
      <span>{b.elements.length} elements</span>

      <OmniBoard
        onReady={b.ready}
        onChange={b.onChange}
        onSelectionChange={b.onSelectionChange}
        onToolChange={b.onToolChange}
        grid
        theme={b.theme}
      />
    </div>
  );
}
```

`<OmniBoard>` fills 100% of its container: sizing is up to you (in the example, a
div fixed to the viewport).

## `<OmniBoard>`

It accepts every `BoardOptions` field as a prop (`grid`, `theme`, `background`,
`defaultStyle`, `appearance`, `contextMenu`, `selectionToolbar`, `uploadImage`…),
plus the callbacks:

| Prop | Fires when |
| --- | --- |
| `onReady(board)` | The board was created — keep the instance to call the API |
| `onChange(elements)` | The scene changed |
| `onSelectionChange(ids)` | The selection changed |
| `onToolChange(tool)` | The tool changed |
| `onThemeChange(theme)` | The theme changed |
| `onCameraChange(camera)` | Pan/zoom |

`tool` and `theme` behave as controlled props: changing the value calls
`setTool`/`setTheme` on the board.

You can also grab the instance through a ref:

```tsx
const ref = useRef<OmniBoardHandle>(null);
<OmniBoard ref={ref} />;
ref.current?.zoomToFit();
```

**The board is created once** and destroyed on unmount. Changing the other props
afterwards does not recreate anything (changing a structural option requires
remounting, for example with a different `key`).

## `useBoard()`

Holds the instance and mirrors what UI usually needs to render:

```ts
const {
  ready,            // pass this to onReady
  board,            // the instance (null before mounting)
  tool, setTool,
  theme, setTheme, toggleTheme,
  elements,         // current scene
  selectedIds,
  canUndo, canRedo,
  undo, redo, duplicate, deleteSelected,
  onChange, onSelectionChange, onToolChange, onThemeChange,   // wire into the component
} = useBoard();
```

The hook re-renders on every scene change. On a board with many elements and heavy
UI, prefer reading `board.getElements()` on demand instead of depending on
`elements`.

## Server-side rendering

The board needs a DOM. In Next.js, import the page with `ssr: false` or render it
inside a `useEffect`/client component.
