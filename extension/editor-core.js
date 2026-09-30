(function initializeEditorCore(global) {
  "use strict";

  const HISTORY_LIMIT = 50;
  const EDITABLE_TYPES = Object.freeze(["delay", "mouseDown", "mouseUp", "mouseMove", "mouseWheel", "keyDown", "keyUp", "text", "ime"]);
  const { validateMacroSchema, validateMacro } = global.ZuiPoc;

  function clone(value) {
    return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
  }

  function uniqueId(macro, prefix = "e") {
    const used = new Set(macro.events.map((event) => event.id));
    let index = macro.events.length + 1;
    while (used.has(`${prefix}${String(index).padStart(6, "0")}`)) index += 1;
    return `${prefix}${String(index).padStart(6, "0")}`;
  }

  function defaultEvent(type, id) {
    const base = { id, type, enabled: true };
    if (type === "delay") return { ...base, durationMs: 100 };
    if (["mouseDown", "mouseUp", "mouseMove", "mouseWheel"].includes(type)) {
      const event = {
        ...base,
        position: { space: "target-normalized", x: 0.5, y: 0.5 },
        button: type === "mouseMove" || type === "mouseWheel" ? "none" : "left",
        buttons: type === "mouseDown" ? 1 : 0,
        modifiers: []
      };
      if (type === "mouseWheel") Object.assign(event, { deltaX: 0, deltaY: 120, deltaMode: 0 });
      return event;
    }
    if (type === "keyDown" || type === "keyUp") {
      return { ...base, key: "a", code: "KeyA", location: 0, repeat: false, modifiers: [] };
    }
    if (type === "text" || type === "ime") return { ...base, value: "" };
    throw new Error("UNSUPPORTED_EDITOR_EVENT_TYPE");
  }

  function validateCanonical(macro) {
    const schema = validateMacroSchema(macro);
    const semantic = validateMacro(macro);
    const errors = [...schema.errors, ...semantic.errors.filter((candidate) =>
      !schema.errors.some((item) => item.path === candidate.path && item.code === candidate.code && item.message === candidate.message))];
    return { valid: schema.valid && semantic.valid, schema, semantic, errors };
  }

  function errorsForRow(validation, index) {
    const prefix = `$.events[${index}]`;
    return validation.errors.filter((error) => error.path === prefix || error.path.startsWith(`${prefix}.`));
  }

  function summary(event) {
    if (!event || typeof event !== "object") return "INVALID EVENT";
    if (event.type === "delay") return `${Number.isFinite(event.durationMs) ? event.durationMs : "?"} ms`;
    if (["mouseDown", "mouseUp", "mouseMove"].includes(event.type)) {
      const x = Number.isFinite(event.position?.x) ? `${(event.position.x * 100).toFixed(2)}%` : "?";
      const y = Number.isFinite(event.position?.y) ? `${(event.position.y * 100).toFixed(2)}%` : "?";
      return `${event.button || "none"} · X ${x} · Y ${y}`;
    }
    if (event.type === "mouseWheel") return `ΔX ${event.deltaX ?? "?"} · ΔY ${event.deltaY ?? "?"} · mode ${event.deltaMode ?? "?"}`;
    if (event.type === "keyDown" || event.type === "keyUp") return `${event.key || "(empty)"} / ${event.code || "(empty)"}`;
    if (event.type === "text" || event.type === "ime") return `${String(event.value || "").length} characters`;
    return event.type || "UNKNOWN";
  }

  function snapshot(state) {
    return { macro: clone(state.macro), selectedIndex: state.selectedIndex };
  }

  function refresh(state) {
    state.validation = validateCanonical(state.macro);
    state.dirty = JSON.stringify(state.macro) !== state.savedCanonical;
    if (state.macro.events.length === 0) state.selectedIndex = -1;
    else state.selectedIndex = Math.max(0, Math.min(state.selectedIndex, state.macro.events.length - 1));
    return state;
  }

  function createState(macro) {
    const canonical = clone(macro);
    return refresh({
      macro: canonical,
      selectedIndex: canonical.events.length ? 0 : -1,
      undoStack: [],
      redoStack: [],
      savedCanonical: JSON.stringify(canonical),
      dirty: false,
      validation: null
    });
  }

  function transact(state, operation) {
    state.undoStack.push(snapshot(state));
    if (state.undoStack.length > HISTORY_LIMIT) state.undoStack.shift();
    state.redoStack.length = 0;
    operation(state.macro);
    return refresh(state);
  }

  function editEvent(state, index, event) {
    if (!state.macro.events[index]) throw new Error("EVENT_INDEX_OUT_OF_RANGE");
    return transact(state, (macro) => { macro.events[index] = clone(event); });
  }

  function setAllDelayDurations(state, durationMs) {
    if (!Number.isFinite(durationMs) || durationMs < 0) throw new Error("INVALID_DELAY_DURATION");
    const delays = state.macro.events.filter((event) => event.type === "delay");
    if (!delays.length) throw new Error("NO_DELAY_EVENTS");
    const changedCount = delays.filter((event) => event.durationMs !== durationMs).length;
    if (changedCount) transact(state, (macro) => {
      for (const event of macro.events) if (event.type === "delay") event.durationMs = durationMs;
    });
    return { state, matchedCount: delays.length, changedCount };
  }

  function addEvent(state, type, index = state.macro.events.length) {
    if (!EDITABLE_TYPES.includes(type)) throw new Error("UNSUPPORTED_EDITOR_EVENT_TYPE");
    const insertAt = Math.max(0, Math.min(index, state.macro.events.length));
    const event = defaultEvent(type, uniqueId(state.macro));
    transact(state, (macro) => macro.events.splice(insertAt, 0, event));
    state.selectedIndex = insertAt;
    return refresh(state);
  }

  function deleteEvent(state, index = state.selectedIndex) {
    if (!state.macro.events[index]) throw new Error("EVENT_INDEX_OUT_OF_RANGE");
    transact(state, (macro) => macro.events.splice(index, 1));
    state.selectedIndex = Math.min(index, state.macro.events.length - 1);
    return refresh(state);
  }

  function duplicateEvent(state, index = state.selectedIndex) {
    const source = state.macro.events[index];
    if (!source) throw new Error("EVENT_INDEX_OUT_OF_RANGE");
    const copy = clone(source);
    copy.id = uniqueId(state.macro);
    transact(state, (macro) => macro.events.splice(index + 1, 0, copy));
    state.selectedIndex = index + 1;
    return refresh(state);
  }

  function moveEvent(state, from, to) {
    if (!state.macro.events[from] || to < 0 || to >= state.macro.events.length) throw new Error("EVENT_MOVE_OUT_OF_RANGE");
    transact(state, (macro) => {
      const [event] = macro.events.splice(from, 1);
      macro.events.splice(to, 0, event);
    });
    state.selectedIndex = to;
    return refresh(state);
  }

  function editName(state, name) {
    const normalized = String(name).trim();
    if (!normalized || normalized.length > 80) throw new Error("INVALID_MACRO_NAME");
    return transact(state, (macro) => { macro.name = normalized; });
  }

  function editPlaybackDefaults(state, defaults) {
    const value = global.ZuiPlaybackCore.normalizeDefaults(defaults);
    if (value.speedMultiplier < 0.25 || value.speedMultiplier > 5) throw new Error("PLAYBACK_SPEED_OUT_OF_UI_RANGE");
    if (!value.stopOnError) throw new Error("CONTINUE_ON_ERROR_NOT_SUPPORTED");
    return transact(state, (macro) => { macro.playbackDefaults = value; });
  }

  function undo(state) {
    const previous = state.undoStack.pop();
    if (!previous) return state;
    state.redoStack.push(snapshot(state));
    state.macro = previous.macro;
    state.selectedIndex = previous.selectedIndex;
    return refresh(state);
  }

  function redo(state) {
    const next = state.redoStack.pop();
    if (!next) return state;
    state.undoStack.push(snapshot(state));
    state.macro = next.macro;
    state.selectedIndex = next.selectedIndex;
    return refresh(state);
  }

  function markSaved(state, savedMacro) {
    state.macro = clone(savedMacro || state.macro);
    state.savedCanonical = JSON.stringify(state.macro);
    state.dirty = false;
    state.undoStack.length = 0;
    state.redoStack.length = 0;
    return refresh(state);
  }

  function applyRaw(state, text) {
    let parsed;
    try { parsed = JSON.parse(text); } catch (cause) { return { ok: false, error: { path: "$", code: "JSON_PARSE", message: cause.message } }; }
    const validation = validateCanonical(parsed);
    if (!validation.valid) return { ok: false, error: validation.errors[0], validation };
    transact(state, () => {});
    state.macro = clone(parsed);
    state.selectedIndex = parsed.events.length ? 0 : -1;
    refresh(state);
    return { ok: true, state };
  }

  function parseImport(text) {
    let macro;
    try { macro = JSON.parse(text); } catch (cause) { return { ok: false, error: { path: "$", code: "JSON_PARSE", message: cause.message } }; }
    const validation = validateCanonical(macro);
    return validation.valid ? { ok: true, macro: clone(macro), validation } : { ok: false, error: validation.errors[0], validation };
  }

  function uniqueName(name, macros) {
    return global.ZuiProduct?.uniqueMacroName
      ? global.ZuiProduct.uniqueMacroName(name, macros)
      : String(name).trim();
  }

  function saveAsMacro(macro, name, now = new Date().toISOString()) {
    const copy = clone(macro);
    const normalized = String(name).trim();
    if (!normalized || normalized.length > 80) throw new Error("INVALID_MACRO_NAME");
    const slug = normalized.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "macro";
    const entropy = global.crypto?.randomUUID?.().slice(0, 8) || Math.random().toString(36).slice(2, 10);
    copy.id = `${slug}-${now.replace(/\D/g, "").slice(0, 14)}-${entropy}`;
    copy.name = normalized;
    copy.createdAt = now;
    copy.updatedAt = now;
    copy.events = copy.events.map((event) => clone(event));
    return copy;
  }

  function exportText(macro) {
    const validation = validateCanonical(macro);
    if (!validation.valid) throw new Error("MACRO_VALIDATION_FAILED");
    return `${JSON.stringify(macro, null, 2)}\n`;
  }

  global.ZuiEditorCore = Object.freeze({
    HISTORY_LIMIT,
    EDITABLE_TYPES,
    clone,
    defaultEvent,
    validateCanonical,
    errorsForRow,
    summary,
    createState,
    editEvent,
    setAllDelayDurations,
    addEvent,
    deleteEvent,
    duplicateEvent,
    moveEvent,
    editName,
    editPlaybackDefaults,
    undo,
    redo,
    markSaved,
    applyRaw,
    parseImport,
    uniqueName,
    saveAsMacro,
    exportText
  });
})(globalThis);
