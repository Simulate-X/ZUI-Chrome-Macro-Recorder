(function initializeShared(global) {
  "use strict";

  function isFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
  }

  function normalizePoint(clientX, clientY, rect) {
    if (!rect || !isFiniteNumber(rect.left) || !isFiniteNumber(rect.top) ||
        !isFiniteNumber(rect.width) || !isFiniteNumber(rect.height) ||
        rect.width <= 0 || rect.height <= 0) {
      throw new Error("INVALID_TARGET_RECT");
    }
    const x = (clientX - rect.left) / rect.width;
    const y = (clientY - rect.top) / rect.height;
    if (!isFiniteNumber(x) || !isFiniteNumber(y) || x < 0 || x > 1 || y < 0 || y > 1) {
      throw new Error("POINT_OUTSIDE_TARGET");
    }
    return { x, y };
  }

  function denormalizePoint(position, rect) {
    if (!position || !isFiniteNumber(position.x) || !isFiniteNumber(position.y) ||
        position.x < 0 || position.x > 1 || position.y < 0 || position.y > 1) {
      throw new Error("INVALID_NORMALIZED_POINT");
    }
    if (!rect || !isFiniteNumber(rect.left) || !isFiniteNumber(rect.top) ||
        !isFiniteNumber(rect.width) || !isFiniteNumber(rect.height) ||
        rect.width <= 0 || rect.height <= 0) {
      throw new Error("INVALID_TARGET_RECT");
    }
    return {
      clientX: rect.left + position.x * rect.width,
      clientY: rect.top + position.y * rect.height
    };
  }

  function hashText(value) {
    if (typeof value !== "string") throw new Error("HASH_TEXT_REQUIRED");
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
  }

  function validateMacroSchema(macro) {
    const errors = [];
    const error = (path, code, message) => errors.push({ path, code, message });
    const object = (value) => value && typeof value === "object" && !Array.isArray(value);
    const exactKeys = (value, allowed, path) => {
      if (!object(value)) return;
      for (const key of Object.keys(value)) if (!allowed.includes(key)) error(`${path}.${key}`, "ADDITIONAL_PROPERTY", `Property ${key} is not allowed by macro-v1.schema.json.`);
    };
    if (!object(macro)) return { valid: false, errors: [{ path: "$", code: "TYPE", message: "Macro must be an object." }] };
    exactKeys(macro, ["schemaVersion", "id", "name", "description", "createdAt", "updatedAt", "target", "recordingProfile", "playbackDefaults", "events"], "$");
    for (const key of ["schemaVersion", "id", "name", "playbackDefaults", "events"]) {
      if (!(key in macro)) error(`$.${key}`, "REQUIRED", `${key} is required by macro-v1.schema.json.`);
    }
    if (typeof macro.id !== "string" || !macro.id) error("$.id", "TYPE", "id must be a non-empty string.");
    if (typeof macro.name !== "string" || !macro.name) error("$.name", "TYPE", "name must be a non-empty string.");
    if (typeof macro.name === "string" && macro.name.length > 80) error("$.name", "MAX_LENGTH", "name must not exceed 80 characters.");
    if (typeof macro.description === "string" && macro.description.length > 4096) error("$.description", "MAX_LENGTH", "description must not exceed 4096 characters.");
    if (macro.target !== undefined) {
      exactKeys(macro.target, ["origin", "surface"], "$.target");
      if (typeof macro.target?.origin !== "string") error("$.target.origin", "TYPE", "target.origin must be a URI string.");
      else {
        const origin = global.ZuiHardening?.validatePortableOrigin?.(macro.target.origin);
        if (origin && !origin.valid) error("$.target.origin", origin.code, "Only credential-free http/https target origins are portable.");
      }
      const surface = macro.target?.surface;
      if (!object(surface)) error("$.target.surface", "TYPE", "target.surface must be an object.");
      else {
        exactKeys(surface, ["kind", "locator", "recordedGeometry"], "$.target.surface");
        if (!["canvas", "container", "viewport"].includes(surface.kind)) error("$.target.surface.kind", "ENUM", "Unsupported surface kind.");
        if (!object(surface.locator) || surface.locator.strategy !== "css" || typeof surface.locator.value !== "string" || !surface.locator.value) {
          error("$.target.surface.locator", "TYPE", "A CSS locator is required.");
        }
        if (typeof surface.locator?.value === "string" && surface.locator.value.length > 2048) error("$.target.surface.locator.value", "MAX_LENGTH", "Surface locator is too long.");
        if (surface.recordedGeometry !== undefined) {
          exactKeys(surface.recordedGeometry, ["widthCssPx", "heightCssPx", "devicePixelRatio"], "$.target.surface.recordedGeometry");
          if (!isFiniteNumber(surface.recordedGeometry.widthCssPx) || surface.recordedGeometry.widthCssPx <= 0) error("$.target.surface.recordedGeometry.widthCssPx", "RANGE", "widthCssPx must be positive.");
          if (!isFiniteNumber(surface.recordedGeometry.heightCssPx) || surface.recordedGeometry.heightCssPx <= 0) error("$.target.surface.recordedGeometry.heightCssPx", "RANGE", "heightCssPx must be positive.");
        }
      }
    }
    if (macro.recordingProfile !== undefined) {
      exactKeys(macro.recordingProfile, ["keyboard", "mouse", "mouseMode", "wheel"], "$.recordingProfile");
      for (const key of ["keyboard", "mouse", "wheel"]) if (macro.recordingProfile[key] !== undefined && typeof macro.recordingProfile[key] !== "boolean") error(`$.recordingProfile.${key}`, "TYPE", `${key} must be boolean.`);
      if (!["clicks-only", "clicks-and-movement"].includes(macro.recordingProfile.mouseMode)) error("$.recordingProfile.mouseMode", "ENUM", "Unsupported mouseMode.");
    }
    const defaults = macro.playbackDefaults;
    if (!object(defaults)) error("$.playbackDefaults", "TYPE", "playbackDefaults must be an object.");
    else {
      exactKeys(defaults, ["speedMultiplier", "repeatCount", "loopDelayMs", "stopOnError"], "$.playbackDefaults");
      if (!isFiniteNumber(defaults.speedMultiplier) || defaults.speedMultiplier <= 0) error("$.playbackDefaults.speedMultiplier", "RANGE", "speedMultiplier must be positive.");
      if (!Number.isInteger(defaults.repeatCount) || defaults.repeatCount < 0) error("$.playbackDefaults.repeatCount", "RANGE", "repeatCount must be a non-negative integer.");
      if (!isFiniteNumber(defaults.loopDelayMs) || defaults.loopDelayMs < 0) error("$.playbackDefaults.loopDelayMs", "RANGE", "loopDelayMs must be non-negative.");
      if (typeof defaults.stopOnError !== "boolean") error("$.playbackDefaults.stopOnError", "TYPE", "stopOnError must be boolean.");
    }
    if (!Array.isArray(macro.events)) error("$.events", "TYPE", "events must be an array.");
    else macro.events.forEach((event, index) => {
      const path = `$.events[${index}]`;
      if (!object(event)) return error(path, "TYPE", "Event must be an object.");
      const common = ["id", "type", "enabled", "label"];
      const mouse = ["position", "button", "buttons", "deltaX", "deltaY", "deltaMode", "modifiers"];
      const keyboard = ["key", "code", "location", "repeat", "modifiers"];
      const extra = event.type === "delay" ? ["durationMs"] : (["mouseDown", "mouseUp", "mouseMove", "mouseWheel"].includes(event.type) ? mouse : (["keyDown", "keyUp"].includes(event.type) ? keyboard : ["value"]));
      exactKeys(event, [...common, ...extra], path);
      if (typeof event.id !== "string" || !event.id) error(`${path}.id`, "REQUIRED", "Event id is required.");
      if (typeof event.enabled !== "boolean") error(`${path}.enabled`, "REQUIRED", "Event enabled flag is required.");
      if (event.type === "delay" && (!isFiniteNumber(event.durationMs) || event.durationMs < 0)) error(`${path}.durationMs`, "RANGE", "Delay must be non-negative.");
      if (event.type === "mouseWheel") {
        if (!isFiniteNumber(event.deltaX) || !isFiniteNumber(event.deltaY)) error(path, "REQUIRED", "Wheel deltas are required.");
        if (![0, 1, 2].includes(event.deltaMode)) error(`${path}.deltaMode`, "ENUM", "deltaMode must be 0, 1 or 2.");
      }
      if (["keyDown", "keyUp"].includes(event.type)) {
        if (typeof event.key !== "string" || !event.key || typeof event.code !== "string" || !event.code) error(path, "REQUIRED", "Non-empty keyboard key and code are required.");
        if (!Number.isInteger(event.location) || typeof event.repeat !== "boolean") error(path, "TYPE", "Keyboard location and repeat metadata are required.");
      }
      if (["text", "ime"].includes(event.type) && typeof event.value === "string" && event.value.length > 1000000) error(`${path}.value`, "MAX_LENGTH", "Text/IME value is too large.");
    });
    return { valid: errors.length === 0, errors };
  }

  function validateMacro(macro) {
    const structural = validateMacroSchema(macro);
    const errors = structural.errors.slice();
    const error = (path, code, message) => errors.push({ path, code, message });
    if (!macro || typeof macro !== "object" || Array.isArray(macro)) return structural;
    if (!/^1\.\d+$/.test(macro.schemaVersion || "")) {
      error("$.schemaVersion", "UNSUPPORTED_SCHEMA", "Expected a supported 1.x schemaVersion.");
    }
    const forbiddenKeys = /^(profileId|profilePath|gmail|accountId|tabId|windowId|frameId|cookie|cookies|sessionToken|authToken|accessToken|refreshToken|authorization|debuggerSessionId|localPath|backend)$/i;
    const inspectPrivacy = (value, path, seen = new Set()) => {
      if (!value || typeof value !== "object" || seen.has(value)) return;
      seen.add(value);
      for (const [key, child] of Object.entries(value)) {
        if (forbiddenKeys.test(key)) error(`${path}.${key}`, "FORBIDDEN_RUNTIME_DATA", "Profile, account, tab or session data is not portable.");
        if (typeof child === "string" && (/^[a-z]:\\users\\/i.test(child) || /^file:\/\//i.test(child))) {
          error(`${path}.${key}`, "LOCAL_PATH_SECRET", "Local filesystem paths are not portable macro data.");
        }
        inspectPrivacy(child, `${path}.${key}`, seen);
      }
    };
    inspectPrivacy(macro, "$");
    if (!Array.isArray(macro.events)) {
      error("$.events", "TYPE", "events must be an array.");
      return { valid: false, errors };
    }
    const known = new Set(["delay", "mouseDown", "mouseUp", "mouseMove", "mouseWheel", "keyDown", "keyUp", "text", "ime"]);
    const ids = new Set();
    macro.events.forEach((event, index) => {
      const path = `$.events[${index}]`;
      if (!event || typeof event !== "object" || Array.isArray(event)) {
        error(path, "TYPE", "Event must be an object.");
        return;
      }
      if (typeof event.id !== "string" || !event.id) error(`${path}.id`, "REQUIRED", "Event id is required.");
      else if (ids.has(event.id)) error(`${path}.id`, "DUPLICATE_ID", "Event id must be unique.");
      else ids.add(event.id);
      if (!known.has(event.type)) error(`${path}.type`, "UNKNOWN_EVENT", "Unsupported event type.");
      if (event.type === "delay" && (!isFiniteNumber(event.durationMs) || event.durationMs < 0)) {
        error(`${path}.durationMs`, "RANGE", "Delay must be a finite non-negative number.");
      }
      if (["mouseDown", "mouseUp", "mouseMove", "mouseWheel"].includes(event.type)) {
        const p = event.position;
        if (!p || p.space !== "target-normalized" || !isFiniteNumber(p.x) || !isFiniteNumber(p.y) ||
            p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) {
          error(`${path}.position`, "INVALID_POSITION", "Mouse position must be target-normalized in the 0..1 range.");
        }
        if (event.type === "mouseDown" && event.button === "none") error(`${path}.button`, "BUTTON_STATE", "mouseDown requires a concrete button.");
        if (event.type === "mouseUp" && event.buttons !== 0) error(`${path}.buttons`, "BUTTON_STATE", "mouseUp buttons must be zero.");
        if (event.type === "mouseWheel" && (!isFiniteNumber(event.deltaX) || !isFiniteNumber(event.deltaY) || ![0, 1, 2].includes(event.deltaMode))) {
          error(path, "INVALID_WHEEL", "Wheel deltas must be finite and deltaMode must be 0, 1 or 2.");
        }
      }
      if (["keyDown", "keyUp"].includes(event.type) && (typeof event.key !== "string" || !event.key || typeof event.code !== "string" || !event.code || !Number.isInteger(event.location))) {
        error(path, "INVALID_KEYBOARD", "Keyboard metadata is incomplete.");
      }
      if (["text", "ime"].includes(event.type) && typeof event.value !== "string") error(`${path}.value`, "INVALID_TEXT", "Text/IME value must be a string.");
      if (event.backend !== undefined) error(`${path}.backend`, "BACKEND_COUPLING", "Recorder events must remain backend-agnostic.");
    });
    return { valid: errors.length === 0, errors };
  }

  global.ZuiPoc = Object.freeze({ normalizePoint, denormalizePoint, hashText, validateMacroSchema, validateMacro });
})(globalThis);
