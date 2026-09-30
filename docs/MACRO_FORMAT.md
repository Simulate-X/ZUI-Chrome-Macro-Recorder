# Macro File Format

## 1. Purpose

ZUI Macro Recorder for Chrome uses a versioned JSON document as its only canonical macro model. The recorder, editor, importer/exporter and playback scheduler all read and write this same model. There is no UI-only representation that can drift from exported JSON.

The format is deliberately human-readable. A user may open an export in VS Code or Notepad and edit delays, coordinates, buttons, keys or playback defaults. Imported files are untrusted input and must pass structural and semantic validation before they can be saved or played.

## 2. Cross-profile portability and privacy

A macro recorded in one Chrome profile must be importable and playable in another Chrome profile after the user explicitly pins a target tab/surface in that profile.

An exported document must never contain:

- Chrome profile identifiers or profile filesystem paths;
- Gmail addresses, account identifiers or other account information;
- runtime `tabId`, `windowId`, frame ID or debugger session ID;
- cookies, session tokens, Authorization headers or browser storage values;
- captured page secrets or password-field contents.

Target metadata is limited to portable, non-secret hints such as an allowed origin, surface kind and declarative locator. Runtime target binding is session state and is never serialized into the macro.

Phase 5 origin validation permits only credential-free HTTP(S). Same-origin iframe paths are encoded as `iframe-selector ::frame:: descendant`; open Shadow DOM uses `host >>> descendant`. These are portable declarative paths, not runtime frame IDs. Cross-origin frame paths are not exported as guessed targets.

`playbackDefaults.speedMultiplier` scales only runtime effective delay, `repeatCount` is total executions (`0` infinite), and `loopDelayMs` is an unscaled interval between iterations. Active iteration/index, remaining delay and held-input cleanup state are runtime-only and invalid as canonical fields.

## 3. Version 1 envelope

```json
{
  "schemaVersion": "1.0",
  "id": "macro-demo",
  "name": "Resize-safe demo",
  "description": "A manually editable example",
  "createdAt": "2026-09-23T12:00:00.000Z",
  "updatedAt": "2026-09-23T12:00:00.000Z",
  "target": {
    "origin": "http://127.0.0.1:8765",
    "surface": {
      "kind": "canvas",
      "locator": { "strategy": "css", "value": "#demo-surface" },
      "recordedGeometry": { "widthCssPx": 640, "heightCssPx": 360 }
    }
  },
  "recordingProfile": {
    "keyboard": true,
    "mouse": true,
    "mouseMode": "clicks-only",
    "wheel": true
  },
  "playbackDefaults": {
    "speedMultiplier": 1,
    "repeatCount": 1,
    "loopDelayMs": 0,
    "stopOnError": true
  },
  "events": [
    { "id": "e1", "type": "delay", "enabled": true, "durationMs": 500 },
    {
      "id": "e2",
      "type": "mouseDown",
      "enabled": true,
      "position": { "space": "target-normalized", "x": 0.5, "y": 0.5 },
      "button": "left",
      "modifiers": []
    },
    { "id": "e3", "type": "delay", "enabled": true, "durationMs": 120 },
    {
      "id": "e4",
      "type": "mouseUp",
      "enabled": true,
      "position": { "space": "target-normalized", "x": 0.5, "y": 0.5 },
      "button": "left",
      "modifiers": []
    }
  ]
}
```

Version 1 event strings use lower camel case: `delay`, `mouseDown`, `mouseUp`, `mouseMove`, `mouseWheel`, `keyDown`, `keyUp` and, where required, `text`/`ime`. Recorder default is clicks-only plus keyboard; mouse movement is opt-in and may be sampled/coalesced.

Recorder eventleri `backend`, debugger veya runtime tab alanı taşımaz. Playback router event sınıfına göre backend'i çalışma anında seçer. `mouseWheel` eventinde `deltaX`, `deltaY` yanında DOM `deltaMode` metadata'sı da korunur.

## 4. Explicit timing model

Timing is stored as explicit `delay` rows, not only as absolute timestamps. This preserves the Jitbit-style editing workflow: every wait and input command remains visible and directly editable.

The playback scheduler may compile the list into an internal timeline:

```text
effectiveDelayMs = durationMs / speedMultiplier
```

That timeline is ephemeral. It must not replace or silently rewrite the source event list.

## 5. Coordinate contract

Mouse coordinates default to `target-normalized` in the inclusive range `0..1`:

```text
x = (clientX - rect.left) / rect.width
y = (clientY - rect.top) / rect.height
```

The preferred reference is the actual canvas/game surface bounding rectangle. Playback resolves the target again and multiplies the ratios by its current rectangle. The UI may display percentages or calculated CSS pixels, but JSON keeps normalized values as the authority.

This preserves the same proportional point after window movement or ordinary resize. It does not solve CSS transforms, letterboxing, responsive re-layout, `devicePixelRatio` mistakes, cross-origin iframe access, WebGL/canvas rejection of synthetic input or background-tab throttling. Those conditions require preflight checks and measured compatibility.

## 6. Playback defaults

- `speedMultiplier`: positive finite number.
- `repeatCount`: non-negative integer; `0` means infinite.
- `loopDelayMs`: non-negative finite number.
- `stopOnError`: boolean, default `true`.

Runtime controls are play, pause/resume, stop and step-by-step. A closed, navigated or inaccessible target tab is a fail-closed stop. Hotkeys are user-configurable, subject to Chrome/OS shortcut restrictions; resolved shortcuts are user settings and need not be embedded in a portable macro.

## 7. Validation

Import validation has two layers:

1. **Structural validation:** JSON parses; required properties and types match the JSON Schema.
2. **Semantic validation:** event IDs are unique; numbers are finite and within bounds; locator strategy is supported; event-specific fields are consistent; unknown event types are rejected.

Errors include a JSON path, stable error code and readable message. Invalid input is never partially played. Unknown properties may be preserved only when the active schema permits them; unknown event types are not skipped.

The machine-readable schema is `schemas/macro-v1.schema.json`. Exported documents remain ordinary JSON and require no network access.

## 8. Backward compatibility

`schemaVersion` uses `major.minor` text:

- A known major with an older minor may be migrated by a deterministic, tested in-memory migration and exported only after user save.
- A newer unsupported minor is accepted only when every used field/event is understood; otherwise import stops with an upgrade message.
- An unknown major is rejected, never guessed or silently downgraded.
- Migrations preserve event order and explicit delays and never introduce profile/session data.

Version 1 has no migration yet. Phase 5 rejects unknown major `99.0` and missing versions. Compatibility fixtures are added whenever version 1 changes or version 2 is introduced.

Faz 3 mevcut `schemaVersion: "1.0"` biçimini değiştirmez. Save sırasında `id` ve `createdAt` korunur, mevcut `updatedAt` alanı yenilenir. Save As ve import yeni portable `id`, `createdAt` ve `updatedAt` üretir. Aynı isimli importlar yeni, görünür unique isim alır; sessiz overwrite yapılmaz.

## 9. BlueStacks as an industry reference

The user-provided real `Test_BS_01.json` export contains 181 events and demonstrates:

- JSON serialization and `MacroSchemaVersion: 3`;
- `LoopIterations`, `LoopInterval`, `LoopType`, `Acceleration` and `Shortcut` settings;
- event fields including `EventType`, `Timestamp`, `X` and `Y`;
- observed types `MouseDown`, `MouseUp`, `MouseMove`, `MouseWheel` and `IME`;
- observed X/Y values such as `42.87/53.96`, `70.96/95.95` and `14.01/44.82`, behaving like a normalized 0–100 percentage space.

This supports versioned JSON and normalized coordinates as established recorder patterns. The file does not declare BlueStacks' exact reference surface, so it is not assumed to be a canvas. ZUI uses a 0–1 target-surface space and explicit `delay` events and does **not** target BlueStacks import/export compatibility.

## 10. Security invariants

- No JavaScript, expressions, network requests or arbitrary commands are executable from a macro file.
- Text is rendered as text, never injected as HTML.
- Password fields and sensitive inputs are excluded from recording.
- Playback requires an explicit current target binding and successful geometry/permission preflight.
- Importing a macro never grants host or debugger permission by itself.
