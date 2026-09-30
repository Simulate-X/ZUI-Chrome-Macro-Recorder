"use strict";

const Core = globalThis.ZuiEditorCore;
const $ = (selector) => document.querySelector(selector);
let macros = [];
let quarantined = [];
let recentMacroIds = [];
let sortDirection = "desc";
let state = null;
let visualMode = true;
let playbackStatus = { state: "IDLE" };
let stickyError = false;
const Playback = globalThis.ZuiPlaybackCore;

async function runtime(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || "UNKNOWN_ERROR");
  return response;
}

function setStatus(message, isError = false) {
  stickyError = Boolean(isError && message);
  if (isError && message) {
    const friendly = ZuiProduct.friendlyError(message);
    $("#status").textContent = `${friendly.title}. ${friendly.explanation} Recovery: ${friendly.action}. [${friendly.code}]`;
    $("#rebind-panel").hidden = friendly.actionId !== "rebind-copy";
  } else $("#status").textContent = message || "";
  if (!isError) $("#rebind-panel").hidden = true;
  $("#status").classList.toggle("invalid", isError);
}

function formatElapsed(milliseconds = 0) {
  const seconds = Math.floor(milliseconds / 1000);
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map((value) => String(value).padStart(2, "0")).join(":");
}

function playbackOptions() {
  return { settings: Playback.normalizeDefaults(state.macro.playbackDefaults) };
}

async function startPlayback(mode = "continuous", macro = state?.macro) {
  const validation = Core.validateCanonical(macro);
  if (!validation.valid) throw new Error("Invalid macro cannot be played.");
  const options = { settings: Playback.normalizeDefaults(macro.playbackDefaults), mode };
  if (["selected", "step", "from"].includes(mode)) options.index = state.selectedIndex;
  const response = await runtime({ type: "START_PLAYBACK", macro, options });
  playbackStatus = response.status;
  renderPlayback();
  setStatus(`${macro.name}: playback started.`);
  if (mode === "step") advanceAfterStep(response.status.sessionId, response.status.range.end, macro.id);
}

async function advanceAfterStep(sessionId, nextIndex, macroId) {
  while (true) {
    const status = (await runtime({ type: "GET_PLAYBACK_STATUS" })).status;
    if (status.sessionId !== sessionId) return;
    if (!Playback.ACTIVE_STATES.has(status.state)) {
      if (status.state === "COMPLETED" && state?.macro.id === macroId && state.macro.events.length) {
        state.selectedIndex = Math.min(nextIndex, state.macro.events.length - 1);
        renderAll();
        setStatus(`Step complete. Next safe-unit candidate starts at event ${state.selectedIndex + 1}.`);
      }
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function playbackControl(type) {
  const response = await runtime({ type });
  if (response.status) playbackStatus = response.status;
  renderPlayback();
}

function renderPlaybackSettings() {
  if (!state) return;
  const defaults = Playback.normalizeDefaults(state.macro.playbackDefaults);
  const speed = $("#playback-speed");
  speed.querySelector("option[data-file-value]")?.remove();
  const speedValue = String(defaults.speedMultiplier).replace(/^0/, "");
  if (![...speed.options].some((option) => option.value === speedValue)) {
    const option = document.createElement("option"); option.value = speedValue; option.textContent = `${defaults.speedMultiplier} (file value)`; option.dataset.fileValue = "true"; speed.append(option);
  }
  speed.value = speedValue;
  $("#playback-repeat").value = String(defaults.repeatCount || 1);
  $("#playback-repeat").disabled = defaults.repeatCount === 0;
  $("#playback-infinite").checked = defaults.repeatCount === 0;
  $("#playback-loop-delay").value = String(defaults.loopDelayMs);
}

function renderPlayback() {
  const status = playbackStatus || { state: "IDLE" };
  const active = Playback.ACTIVE_STATES.has(status.state);
  $("#playback-state").textContent = status.state || "IDLE";
  $("#playback-macro").textContent = status.macroName || state?.macro.name || "—";
  $("#playback-event").textContent = status.totalEvents ? `Event ${status.currentEvent || 0} / ${status.totalEvents}` : "Event —";
  $("#playback-iteration").textContent = status.iteration ? `Iteration ${status.iteration} / ${status.repeatCount === 0 ? "∞" : status.repeatCount}` : "Iteration —";
  $("#playback-elapsed").textContent = formatElapsed(status.durationMs || (status.startedAt && active ? Date.now() - Date.parse(status.startedAt) : 0));
  $("#playback-bar").max = status.totalEvents || 1;
  $("#playback-bar").value = status.currentEvent || 0;
  const running = status.state === "RUNNING" || status.state === "PAUSE_PENDING";
  $("#playback-play").disabled = active || !state?.validation.valid;
  $("#replay").disabled = active || !state?.validation.valid;
  $("#playback-pause").disabled = !running;
  $("#playback-resume").disabled = status.state !== "PAUSED";
  $("#playback-stop").disabled = !active;
  const unit = state ? Playback.safeUnitForIndex(state.macro.events, state.selectedIndex) : { ok: false };
  const from = state ? Playback.playFromBoundary(state.macro.events, state.selectedIndex) : { ok: false };
  $("#playback-step").disabled = active || !state?.validation.valid || !unit.ok;
  $("#playback-selected").disabled = active || !state?.validation.valid || !unit.ok;
  $("#playback-from").disabled = active || !state?.validation.valid || !from.ok;
  $("#playback-step").title = unit.ok ? `${unit.label}: events ${unit.start + 1}–${unit.end}` : unit.code;
  $("#playback-from").title = from.ok ? `Start at event ${from.start + 1}` : `${from.code}; previous ${from.previousSafe ?? "none"}, next ${from.nextSafe ?? "none"}`;
}

async function refreshPlayback() {
  playbackStatus = (await runtime({ type: "GET_PLAYBACK_STATUS" })).status;
  renderPlayback();
  if (!stickyError && ["COMPLETED", "STOPPED", "ERROR"].includes(playbackStatus.state) && playbackStatus.result) {
    const result = playbackStatus.result;
    if (!$("#status").textContent.startsWith("Replay complete")) setStatus(`${playbackStatus.state}: ${result.eventsExecuted} inputs · iteration ${result.iteration} · ${formatElapsed(result.durationMs)}${result.errorCode ? ` · ${result.errorCode}` : ""}`, playbackStatus.state === "ERROR");
  }
}

function safeFileName(name) {
  return String(name).replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "macro";
}

function downloadMacro(macro) {
  const text = Core.exportText(macro);
  const url = URL.createObjectURL(new Blob([text], { type: "application/json;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${safeFileName(macro.name)}.zui-macro.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadJson(value, fileName) {
  const url = URL.createObjectURL(new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: "application/json;charset=utf-8" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = fileName; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function loadLibrary() {
  const response = await runtime({ type: "GET_MACROS" });
  macros = response.macros;
  quarantined = response.quarantine || [];
  recentMacroIds = response.recentMacroIds || [];
  renderLibrary();
  return macros;
}

async function confirmDirty() {
  if (!state?.dirty) return true;
  if (confirm("This macro has unsaved changes. Save before continuing?")) {
    try { await saveCurrent(); return true; } catch (error) { setStatus(error.message, true); return false; }
  }
  return confirm("Discard unsaved changes? Choose Cancel to keep editing.");
}

async function openMacro(id) {
  if (state?.macro.id !== id && !(await confirmDirty())) return;
  const macro = macros.find((item) => item.id === id);
  if (!macro) throw new Error("MACRO_NOT_FOUND");
  state = Core.createState(macro);
  await runtime({ type: "MARK_MACRO_RECENT", id });
  recentMacroIds = ZuiProduct.updateRecent(recentMacroIds, id);
  $("#empty-state").hidden = true;
  $("#editor").hidden = false;
  visualMode = true;
  renderAll();
}

function button(label, action, className = "") {
  const element = document.createElement("button");
  element.textContent = label;
  element.className = className;
  element.addEventListener("click", action);
  return element;
}

function macroCard(macro, compact = false) {
    const card = document.createElement("article");
    card.className = `macro-card${state?.macro.id === macro.id ? " active" : ""}`;
    const name = document.createElement("strong"); name.textContent = macro.name;
    const badge = document.createElement("span"); badge.className = "badge success"; badge.textContent = "Valid";
    const meta = document.createElement("small");
    const changed = macro.updatedAt || macro.createdAt; const playback = Playback.normalizeDefaults(macro.playbackDefaults);
    meta.textContent = `${macro.events.length} events · ${changed ? new Date(changed).toLocaleString() : "Unknown date"} · ${playback.speedMultiplier}× / ${playback.repeatCount === 0 ? "∞" : playback.repeatCount}`;
    const actions = document.createElement("div"); actions.className = "card-actions";
    actions.append(button("Edit", () => openMacro(macro.id).catch((error) => setStatus(error.message, true))),button("Play", () => previewReplay(macro).catch((error) => setStatus(error.message, true))));
    if (!compact) actions.append(button("Rename", () => renameMacro(macro).catch((error) => setStatus(error.message, true))),button("Duplicate", () => duplicateMacro(macro).catch((error) => setStatus(error.message, true))),button("Export", () => downloadMacro(macro)),button("Delete", () => removeMacro(macro).catch((error) => setStatus(error.message, true))));
    card.append(badge,name,meta,actions); return card;
}

function renderLibrary() {
  const library = $("#library"); const recent = $("#recent-library");
  library.replaceChildren(); recent.replaceChildren();
  if (quarantined.length) {
    const warning = document.createElement("p"); warning.className = "invalid"; warning.textContent = `${quarantined.length} corrupted macro record(s) quarantined; valid macros remain available.`; library.append(warning);
  }
  const filtered = ZuiProduct.sortMacros(ZuiProduct.searchMacros(macros, $("#library-search").value), $("#library-sort").value, sortDirection);
  if (!filtered.length) {
    const empty = document.createElement("p");
    empty.textContent = macros.length ? "No macros match this search." : "No macros yet. Import or record your first macro.";
    library.append(empty);
    return;
  }
  for (const macro of filtered) library.append(macroCard(macro));
  for (const id of recentMacroIds) { const macro=macros.find((item)=>item.id===id); if(macro) recent.append(macroCard(macro,true)); }
  $("#recent-section").hidden = recent.childElementCount === 0;
}

async function renameMacro(macro) {
  const name = prompt("Macro name", macro.name); if (name === null || name.trim() === macro.name) return;
  const normalized = ZuiProduct.normalizeMacroName(name);
  const conflict = ZuiProduct.findMacroNameConflict(macros, normalized, macro.id);
  if (conflict) throw new Error(`MACRO_NAME_CONFLICT:${ZuiProduct.uniqueMacroName(normalized, macros, macro.id)}`);
  const candidate = state?.macro.id === macro.id ? Core.clone(state.macro) : Core.clone(macro);
  candidate.name = normalized;
  const response = await runtime({ type: "SAVE_MACRO", macro: candidate, allowReplace: true });
  if (state?.macro.id === macro.id) Core.markSaved(state, response.macro);
  await loadLibrary(); renderAll(); setStatus(`Renamed to ${response.macro.name}.`);
}

function filteredIndices() {
  const filter = $("#filter").value;
  return state.macro.events.map((event, index) => ({ event, index })).filter(({ event }) => {
    if (filter === "all") return true;
    if (filter === "mouse") return ["mouseDown", "mouseUp", "mouseMove"].includes(event.type);
    if (filter === "keyboard") return ["keyDown", "keyUp", "text", "ime"].includes(event.type);
    if (filter === "wheel") return event.type === "mouseWheel";
    return event.type === filter;
  });
}

function renderEvents() {
  const list = $("#event-list");
  const fragment = document.createDocumentFragment();
  for (const { event, index } of filteredIndices()) {
    const errors = Core.errorsForRow(state.validation, index);
    const row = document.createElement("div");
    row.className = `event-row${index === state.selectedIndex ? " selected" : ""}${errors.length ? " row-invalid" : ""}`;
    row.role = "option";
    row.tabIndex = -1;
    row.dataset.index = String(index);
    row.setAttribute("aria-selected", String(index === state.selectedIndex));
    for (const [className, text] of [
      ["event-index", String(index + 1).padStart(3, "0")],
      ["event-type", event.type.replace(/([A-Z])/g, " $1").toUpperCase()],
      ["event-summary", Core.summary(event)],
      [errors.length ? "row-error" : "row-valid", errors.length ? "!" : "✓"]
    ]) {
      const cell = document.createElement("span");
      cell.className = className;
      cell.textContent = text;
      row.append(cell);
    }
    row.title = errors.map((error) => `${error.code}: ${error.message}`).join("\n");
    row.addEventListener("click", () => { state.selectedIndex = index; renderAll(); });
    row.addEventListener("dblclick", () => $("#detail input, #detail select")?.focus());
    fragment.append(row);
  }
  list.replaceChildren(fragment);
}

function field(form, labelText, name, type = "text", value = "") {
  const label = document.createElement("label");
  label.textContent = labelText;
  const input = document.createElement("input");
  input.name = name;
  input.type = type;
  if (type === "number") input.step = "any";
  if (type === "checkbox") input.checked = Boolean(value);
  else input.value = value ?? "";
  label.append(input);
  form.append(label);
  return input;
}

function selectField(form, labelText, name, options, value) {
  const label = document.createElement("label");
  label.textContent = labelText;
  const select = document.createElement("select");
  select.name = name;
  for (const optionValue of options) {
    const option = document.createElement("option");
    option.value = optionValue;
    option.textContent = optionValue;
    select.append(option);
  }
  select.value = String(value);
  label.append(select);
  form.append(label);
  return select;
}

function modifierFields(form, selected) {
  const wrapper = document.createElement("fieldset");
  const legend = document.createElement("legend");
  legend.textContent = "Modifiers";
  const set = document.createElement("div");
  set.className = "modifier-set";
  for (const modifier of ["Alt", "Control", "Meta", "Shift"]) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = "modifier";
    input.value = modifier;
    input.checked = selected.includes(modifier);
    label.append(input, document.createTextNode(modifier));
    set.append(label);
  }
  wrapper.append(legend, set);
  form.append(wrapper);
}

function numberValue(form, name) {
  const value = form.elements[name].value;
  return value.trim() === "" ? Number.NaN : Number(value);
}

function renderDetail() {
  const detail = $("#detail");
  detail.replaceChildren();
  const event = state.macro.events[state.selectedIndex];
  if (!event) { detail.textContent = "Select an event."; return; }
  const form = document.createElement("form");
  form.className = "detail-form";
  field(form, "Enabled", "enabled", "checkbox", event.enabled);
  field(form, "Label", "label", "text", event.label || "");
  if (event.type === "delay") field(form, "Milliseconds", "durationMs", "number", event.durationMs);
  if (["mouseDown", "mouseUp", "mouseMove", "mouseWheel"].includes(event.type)) {
    const x = field(form, "X normalized (0..1)", "x", "number", event.position?.x);
    const y = field(form, "Y normalized (0..1)", "y", "number", event.position?.y);
    selectField(form, "Button", "button", ["left", "middle", "right", "back", "forward", "none"], event.button);
    field(form, "Buttons bitmask", "buttons", "number", event.buttons);
    if (event.type === "mouseWheel") {
      field(form, "Delta X", "deltaX", "number", event.deltaX);
      field(form, "Delta Y", "deltaY", "number", event.deltaY);
      selectField(form, "Delta mode", "deltaMode", [0, 1, 2], event.deltaMode);
    }
    modifierFields(form, event.modifiers || []);
  }
  if (["keyDown", "keyUp"].includes(event.type)) {
    field(form, "Key", "key", "text", event.key);
    field(form, "Code", "code", "text", event.code);
    field(form, "Location", "location", "number", event.location);
    field(form, "Repeat", "repeat", "checkbox", event.repeat);
    modifierFields(form, event.modifiers || []);
  }
  if (event.type === "text" || event.type === "ime") field(form, "Text value", "value", "text", event.value);
  const apply = button("APPLY EVENT", () => {} , "primary");
  apply.type = "submit";
  form.append(apply);
  if (event.type === "delay") {
    const delayCount = state.macro.events.filter((candidate) => candidate.type === "delay").length;
    const bulk = button(`APPLY VALUE TO ALL DELAYS (${delayCount})`, () => {
      try {
        const value = numberValue(form, "durationMs");
        const result = Core.setAllDelayDurations(state, value);
        renderAll();
        setStatus(result.changedCount
          ? `${result.changedCount} delay rows changed to ${value} ms. Save to keep the changes.`
          : `All ${result.matchedCount} delay rows are already ${value} ms.`);
      } catch (error) { setStatus(error.message, true); }
    });
    bulk.type = "button";
    bulk.className = "bulk-apply";
    bulk.disabled = Playback.ACTIVE_STATES.has(playbackStatus.state);
    bulk.title = bulk.disabled ? "Stop playback before bulk editing." : "Changes every Delay row in one undoable operation.";
    form.append(bulk);
    const help = document.createElement("small");
    help.className = "muted";
    help.textContent = "Applies only the millisecond value to every Delay row. Undo restores them together.";
    form.append(help);
  }
  form.addEventListener("submit", (submitEvent) => {
    submitEvent.preventDefault();
    const next = Core.clone(event);
    next.enabled = form.elements.enabled.checked;
    const label = form.elements.label.value.trim();
    if (label) next.label = label; else delete next.label;
    if (event.type === "delay") next.durationMs = numberValue(form, "durationMs");
    if (["mouseDown", "mouseUp", "mouseMove", "mouseWheel"].includes(event.type)) {
      next.position = { space: "target-normalized", x: numberValue(form, "x"), y: numberValue(form, "y") };
      next.button = form.elements.button.value;
      next.buttons = numberValue(form, "buttons");
      next.modifiers = [...form.querySelectorAll("input[name=modifier]:checked")].map((input) => input.value);
      if (event.type === "mouseWheel") {
        next.deltaX = numberValue(form, "deltaX");
        next.deltaY = numberValue(form, "deltaY");
        next.deltaMode = Number(form.elements.deltaMode.value);
      }
    }
    if (["keyDown", "keyUp"].includes(event.type)) {
      next.key = form.elements.key.value;
      next.code = form.elements.code.value;
      next.location = numberValue(form, "location");
      next.repeat = form.elements.repeat.checked;
      next.modifiers = [...form.querySelectorAll("input[name=modifier]:checked")].map((input) => input.value);
    }
    if (event.type === "text" || event.type === "ime") next.value = form.elements.value.value;
    Core.editEvent(state, state.selectedIndex, next);
    renderAll();
    if (!state.validation.valid) setStatus("Event applied with validation errors; Save, Export and Replay are blocked.", true);
  });
  detail.append(form);
}

function renderValidation() {
  const badge = $("#macro-validation");
  badge.textContent = state.validation.valid ? "VALID" : `${state.validation.errors.length} ERROR(S)`;
  badge.className = state.validation.valid ? "valid" : "invalid";
  $("#errors").replaceChildren(...state.validation.errors.slice(0,20).map((error)=>{const row=document.createElement("div");row.className="validation-error";const text=document.createElement("span");text.textContent=`${error.path} · ${error.code} · ${error.message}`;row.append(text);const match=error.path.match(/^\$\.events\[(\d+)\]/);if(match){const jump=button("Go to row",()=>{state.selectedIndex=Number(match[1]);visualMode=true;renderAll();document.querySelector(`.event-row[data-index=\"${match[1]}\"]`)?.focus()});row.append(jump)}return row;}));
  for (const selector of ["#save", "#save-as", "#export", "#replay"]) $(selector).disabled = !state.validation.valid;
}

function renderAll() {
  if (!state) return;
  $("#macro-name").value = state.macro.name;
  $("#dirty").textContent = state.dirty ? "Unsaved changes" : "Saved";
  $("#dirty").className = state.dirty ? "dirty" : "clean";
  $("#visual-view").hidden = !visualMode;
  $("#raw-view").hidden = visualMode;
  $("#visual-tab").classList.toggle("active", visualMode);
  $("#raw-tab").classList.toggle("active", !visualMode);
  $("#undo").disabled = state.undoStack.length === 0;
  $("#redo").disabled = state.redoStack.length === 0;
  $("#delete-event").disabled = state.selectedIndex < 0;
  $("#duplicate-event").disabled = state.selectedIndex < 0;
  $("#move-up").disabled = state.selectedIndex <= 0;
  $("#move-down").disabled = state.selectedIndex < 0 || state.selectedIndex >= state.macro.events.length - 1;
  renderValidation();
  renderEvents();
  renderDetail();
  renderLibrary();
  renderPlaybackSettings();
  renderPlayback();
}

async function saveCurrent() {
  if (!state?.validation.valid) throw new Error("Invalid macro cannot be saved.");
  const response = await runtime({ type: "SAVE_MACRO", macro: state.macro, allowReplace: true });
  Core.markSaved(state, response.macro);
  await loadLibrary();
  renderAll();
  setStatus("Macro saved.");
}

async function rebindCurrent(mode) {
  if (!state?.validation.valid) throw new Error("Invalid macro cannot be rebound.");
  if (mode === "replace" && !confirm(`Rebind “${state.macro.name}” to the currently selected site? The original site binding will be replaced.`)) return;
  const response = await runtime({ type: "REBIND_MACRO", macro: state.macro, mode });
  await loadLibrary();
  state = Core.createState(response.macro);
  renderAll();
  setStatus(mode === "copy" ? `Created ${response.macro.name} for the selected site.` : `Rebound ${response.macro.name} to the selected site.`);
}

async function saveAs() {
  if (!state?.validation.valid) throw new Error("Invalid macro cannot be saved.");
  const requested = prompt("New macro name", `${state.macro.name} Copy`);
  if (requested === null) return;
  const normalized = ZuiProduct.normalizeMacroName(requested);
  const suggested = ZuiProduct.uniqueMacroName(normalized, macros);
  if (suggested !== normalized && !confirm(`A macro named “${normalized}” already exists. Save as “${suggested}” instead?`)) return;
  const name = suggested;
  const candidate = Core.saveAsMacro(state.macro, name);
  const response = await runtime({ type: "SAVE_MACRO", macro: candidate, allowReplace: false });
  await loadLibrary();
  state = Core.createState(response.macro);
  renderAll();
  setStatus(`Saved as ${response.macro.name}.`);
}

async function duplicateMacro(macro) {
  const requested = prompt("Duplicate macro name", `${macro.name} Copy`);
  if (requested === null) return;
  const copy = Core.saveAsMacro(macro, Core.uniqueName(requested.trim(), macros));
  await runtime({ type: "SAVE_MACRO", macro: copy, allowReplace: false });
  await loadLibrary();
  setStatus(`Duplicated as ${copy.name}.`);
}

async function removeMacro(macro) {
  if (!confirm(`Delete macro “${macro.name}”? This cannot be undone.`)) return;
  await runtime({ type: "DELETE_MACRO", id: macro.id });
  if (state?.macro.id === macro.id) {
    state = null;
    $("#editor").hidden = true;
    $("#empty-state").hidden = false;
  }
  await loadLibrary();
  setStatus("Macro deleted.");
}

async function previewReplay(macro = state?.macro) {
  await startPlayback("continuous", macro);
  while (true) {
    const status = (await runtime({ type: "GET_PLAYBACK_STATUS" })).status;
    if (!Playback.ACTIVE_STATES.has(status.state)) {
      playbackStatus = status;
      renderPlayback();
      if (status.state === "COMPLETED") setStatus(`Replay complete: ${status.result?.rows?.length || 0} input events.`);
      else setStatus(`${status.state}: ${status.reason || status.errorCode || "playback ended"}`, status.state === "ERROR");
      return status;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function showVisual() { visualMode = true; renderAll(); }
function showRaw() { visualMode = false; $("#raw-json").value = JSON.stringify(state.macro, null, 2); renderAll(); }

$("#refresh-library").addEventListener("click", () => loadLibrary().catch((error) => setStatus(error.message, true)));
$("#rebind-copy").addEventListener("click", () => rebindCurrent("copy").catch((error) => setStatus(error.message, true)));
$("#rebind-original").addEventListener("click", () => rebindCurrent("replace").catch((error) => setStatus(error.message, true)));
$("#dismiss-rebind").addEventListener("click", () => { $("#rebind-panel").hidden = true; });
$("#library-search").addEventListener("input", renderLibrary);
$("#library-sort").addEventListener("change", renderLibrary);
$("#sort-direction").addEventListener("click", () => { sortDirection = sortDirection === "desc" ? "asc" : "desc"; $("#sort-direction").textContent = sortDirection === "desc" ? "↓" : "↑"; $("#sort-direction").title = sortDirection === "desc" ? "Descending" : "Ascending"; renderLibrary(); });
$("#open-settings").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("settings.html") }));
$("#empty-import").addEventListener("click", () => $("#import-file").click());
$("#empty-record").addEventListener("click", () => chrome.action.openPopup().catch(() => setStatus("Open the ZUI toolbar button to start recording.", true)));
$("#empty-help").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("onboarding.html?reopen=1") }));
$("#backup-export").addEventListener("click", async () => { try { downloadJson((await runtime({ type: "GET_LIBRARY_BACKUP" })).backup, "ZUI_Macro_Library_Backup.json"); setStatus("Portable library backup exported."); } catch (error) { setStatus(error.message, true); } });
$("#backup-restore").addEventListener("click", () => $("#backup-file").click());
$("#backup-file").addEventListener("change", async (event) => {
  try {
    const file = event.target.files[0]; if (!file) return; const backup = JSON.parse(await file.text());
    const preview = await runtime({ type: "RESTORE_LIBRARY_BACKUP", backup, preview: true });
    if (!preview.validCount) throw new Error(preview.validation?.errors?.[0]?.code || "BACKUP_INVALID");
    const policy = preview.conflicts.length ? prompt(`${preview.conflicts.length} conflict(s). Enter keep-both, replace, or skip.`, "keep-both") : "keep-both";
    if (policy === null) return; if (!["keep-both","replace","skip"].includes(policy)) throw new Error("BACKUP_CONFLICT_POLICY_REQUIRED");
    if (!confirm(`Restore ${preview.validCount} valid macro(s)? ${preview.invalidCount} invalid item(s) will be rejected.`)) return;
    const result = await runtime({ type: "RESTORE_LIBRARY_BACKUP", backup, conflictPolicy: policy }); await loadLibrary(); setStatus(`Restore complete: ${result.restored} restored, ${result.skipped} skipped, ${result.rejected} rejected.`);
  } catch (error) { setStatus(error.message, true); } finally { event.target.value = ""; }
});
$("#diagnostics-export").addEventListener("click", async () => { try { downloadJson((await runtime({ type: "GET_DIAGNOSTIC_REPORT" })).report, "zui-diagnostic-report.json"); setStatus("Redacted diagnostic report exported."); } catch (error) { setStatus(error.message, true); } });
$("#save").addEventListener("click", () => saveCurrent().catch((error) => setStatus(error.message, true)));
$("#save-as").addEventListener("click", () => saveAs().catch((error) => setStatus(error.message, true)));
$("#export").addEventListener("click", () => { try { downloadMacro(state.macro); setStatus("Valid canonical JSON exported."); } catch (error) { setStatus(error.message, true); } });
$("#replay").addEventListener("click", () => previewReplay().catch((error) => setStatus(error.message, true)));
$("#playback-play").addEventListener("click", () => startPlayback().catch((error) => setStatus(error.message, true)));
$("#playback-pause").addEventListener("click", () => playbackControl("PAUSE_PLAYBACK").catch((error) => setStatus(error.message, true)));
$("#playback-resume").addEventListener("click", () => playbackControl("RESUME_PLAYBACK").catch((error) => setStatus(error.message, true)));
$("#playback-stop").addEventListener("click", () => playbackControl("STOP_PLAYBACK").catch((error) => setStatus(error.message, true)));
$("#playback-step").addEventListener("click", () => startPlayback("step").catch((error) => setStatus(error.message, true)));
$("#playback-selected").addEventListener("click", () => startPlayback("selected").catch((error) => setStatus(error.message, true)));
$("#playback-from").addEventListener("click", () => startPlayback("from").catch((error) => setStatus(error.message, true)));
function applyPlaybackSettings() {
  const infinite = $("#playback-infinite").checked;
  Core.editPlaybackDefaults(state, {
    speedMultiplier: Number($("#playback-speed").value), repeatCount: infinite ? 0 : Number($("#playback-repeat").value),
    loopDelayMs: Number($("#playback-loop-delay").value), stopOnError: true
  });
  renderAll();
}
for (const selector of ["#playback-speed", "#playback-repeat", "#playback-infinite", "#playback-loop-delay"]) $(selector).addEventListener("change", () => { try { applyPlaybackSettings(); } catch (error) { setStatus(error.message, true); renderAll(); } });
$("#shortcut-help").addEventListener("click", () => chrome.tabs.create({ url: "chrome://extensions/shortcuts" }, () => {
  if (chrome.runtime.lastError) setStatus("Open manually: chrome://extensions/shortcuts", true);
}));
$("#visual-tab").addEventListener("click", showVisual);
$("#raw-tab").addEventListener("click", showRaw);
$("#cancel-raw").addEventListener("click", showVisual);
$("#apply-raw").addEventListener("click", () => {
  const result = Core.applyRaw(state, $("#raw-json").value);
  if (!result.ok) return setStatus(`${result.error.path}: ${result.error.code}: ${result.error.message}`, true);
  showVisual();
  setStatus("Raw JSON applied to the canonical in-memory macro.");
});
$("#macro-name").addEventListener("change", (event) => {
  try { Core.editName(state, event.target.value); renderAll(); } catch (error) { setStatus(error.message, true); renderAll(); }
});
$("#add-event").addEventListener("click", () => { Core.addEvent(state, $("#add-type").value, state.selectedIndex < 0 ? state.macro.events.length : state.selectedIndex + 1); renderAll(); });
$("#delete-event").addEventListener("click", () => { Core.deleteEvent(state); renderAll(); });
$("#duplicate-event").addEventListener("click", () => { Core.duplicateEvent(state); renderAll(); });
$("#move-up").addEventListener("click", () => { Core.moveEvent(state, state.selectedIndex, state.selectedIndex - 1); renderAll(); });
$("#move-down").addEventListener("click", () => { Core.moveEvent(state, state.selectedIndex, state.selectedIndex + 1); renderAll(); });
$("#undo").addEventListener("click", () => { Core.undo(state); renderAll(); });
$("#redo").addEventListener("click", () => { Core.redo(state); renderAll(); });
$("#filter").addEventListener("change", renderEvents);
$("#event-list").addEventListener("keydown", (event) => {
  if (!state) return;
  if (event.key === "ArrowDown" && state.selectedIndex < state.macro.events.length - 1) state.selectedIndex += 1;
  else if (event.key === "ArrowUp" && state.selectedIndex > 0) state.selectedIndex -= 1;
  else if (event.key === "Delete" && state.selectedIndex >= 0) Core.deleteEvent(state);
  else if (event.key === "Enter") return $("#detail input, #detail select")?.focus();
  else return;
  event.preventDefault();
  renderAll();
});
document.addEventListener("keydown", (event) => {
  const editingText = event.target.matches?.("input, textarea, select, [contenteditable=true]");
  if (editingText) return;
  if (event.key === "Escape" && Playback.ACTIVE_STATES.has(playbackStatus.state)) { event.preventDefault(); return playbackControl("STOP_PLAYBACK").catch((error) => setStatus(error.message, true)); }
  if (event.key === "F10") { event.preventDefault(); return startPlayback("step").catch((error) => setStatus(error.message, true)); }
  if ((event.key === "F8" || event.code === "Space") && !event.ctrlKey && !event.metaKey) {
    event.preventDefault();
    if (playbackStatus.state === "PAUSED") return playbackControl("RESUME_PLAYBACK").catch((error) => setStatus(error.message, true));
    if (playbackStatus.state === "RUNNING" || playbackStatus.state === "PAUSE_PENDING") return playbackControl("PAUSE_PLAYBACK").catch((error) => setStatus(error.message, true));
    return startPlayback().catch((error) => setStatus(error.message, true));
  }
  if (!state || !(event.ctrlKey || event.metaKey)) return;
  if (event.key.toLowerCase() === "z" && event.shiftKey) { event.preventDefault(); Core.redo(state); renderAll(); }
  else if (event.key.toLowerCase() === "z") { event.preventDefault(); Core.undo(state); renderAll(); }
  else if (event.key.toLowerCase() === "y") { event.preventDefault(); Core.redo(state); renderAll(); }
});
$("#import-button").addEventListener("click", () => $("#import-file").click());
$("#import-file").addEventListener("change", async (event) => {
  try {
    const file = event.target.files[0];
    if (!file) return;
    const parsed = Core.parseImport(await file.text());
    if (!parsed.ok) throw new Error(`${parsed.error.path}: ${parsed.error.code}: ${parsed.error.message}`);
    const unique = Core.uniqueName(parsed.macro.name, macros);
    if (!confirm(`Import “${parsed.macro.name}” as “${unique}” with ${parsed.macro.events.length} events?`)) return;
    const imported = Core.saveAsMacro(parsed.macro, unique);
    const response = await runtime({ type: "SAVE_MACRO", macro: imported, allowReplace: false });
    await loadLibrary();
    state = Core.createState(response.macro);
    renderAll();
    setStatus("Validated portable macro imported.");
  } catch (error) { setStatus(error.message, true); }
  finally { event.target.value = ""; }
});

window.addEventListener("beforeunload", (event) => { if (state?.dirty) { event.preventDefault(); event.returnValue = ""; } });
loadLibrary().then(() => { if (macros[0]) return openMacro(macros[0].id); }).catch((error) => setStatus(error.message, true));
chrome.commands.getAll((commands) => { $("#playback-shortcuts").textContent = commands.filter((command) => command.description).map((command) => `${command.description}: ${command.shortcut || "unassigned"}`).join(" · "); });
refreshPlayback().catch(() => {});
setInterval(() => refreshPlayback().catch(() => {}), 250);
