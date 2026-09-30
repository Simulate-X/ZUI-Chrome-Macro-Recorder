"use strict";

const canvas = document.querySelector("#demo-surface");
const context = canvas.getContext("2d");
const output = document.querySelector("#event-output");
const summary = document.querySelector("#summary");
const metrics = document.querySelector("#metrics");
const domTarget = document.querySelector("#dom-target");
const evidence = [];
const requestedPoint = { x: 0.25, y: 0.75 };
const baselineDprAt100Percent = window.devicePixelRatio;
let clickCount = 0;
let wheelCount = 0;
let marker = null;
let lastClick = null;
let lastWheel = null;
let lastRequestedPointWheel = null;

function paint() {
  const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, "#1e3a8a");
  gradient.addColorStop(1, "#0e7490");
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#f8fafc";
  context.font = "32px system-ui";
  context.fillText("ZUI normalized input target", 36, 58);
  context.font = "22px system-ui";
  context.fillText("Expected test point: x=25%, y=75%", 36, 100);
  if (marker) {
    context.beginPath();
    context.arc(marker.x * canvas.width, marker.y * canvas.height, 18, 0, Math.PI * 2);
    context.fillStyle = "#fbbf24";
    context.fill();
  }
}

function geometry() {
  const rect = canvas.getBoundingClientRect();
  return {
    dpr: window.devicePixelRatio,
    nativeZoomPercentFromDprBaseline: Math.round((window.devicePixelRatio / baselineDprAt100Percent) * 100),
    baselineDprAt100Percent,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    requested: requestedPoint,
    computedClient: {
      x: rect.left + rect.width * requestedPoint.x,
      y: rect.top + rect.height * requestedPoint.y
    },
    observed: canvas.dataset.lastEvent ? JSON.parse(canvas.dataset.lastEvent) : null,
    behavior: {
      domToggle: domTarget.getAttribute("aria-pressed") === "true",
      canvasClickCount: clickCount,
      wheelCount,
      marker,
      lastClick,
      lastWheel,
      lastRequestedPointWheel
    }
  };
}

function renderMetrics() {
  metrics.textContent = JSON.stringify(geometry(), null, 2);
}

function record(event) {
  const rect = canvas.getBoundingClientRect();
  const item = {
    type: event.type,
    isTrusted: event.isTrusted,
    clientX: event.clientX,
    clientY: event.clientY,
    xNormalized: Number(((event.clientX - rect.left) / rect.width).toFixed(6)),
    yNormalized: Number(((event.clientY - rect.top) / rect.height).toFixed(6)),
    rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    requestedClientAtEventRect: {
      x: rect.left + rect.width * requestedPoint.x,
      y: rect.top + rect.height * requestedPoint.y
    },
    width: rect.width,
    height: rect.height,
    visibilityState: document.visibilityState,
    at: performance.now()
  };
  evidence.push(item);
  if (event.type === "click") {
    clickCount += 1;
    marker = { x: item.xNormalized, y: item.yNormalized };
    lastClick = item;
    paint();
  }
  if (event.type === "wheel") {
    wheelCount += 1;
    lastWheel = item;
    if (Math.abs(item.xNormalized - requestedPoint.x) <= 0.05 &&
        Math.abs(item.yNormalized - requestedPoint.y) <= 0.05) {
      lastRequestedPointWheel = item;
    }
  }
  canvas.dataset.lastEvent = JSON.stringify(item);
  canvas.dataset.eventCount = String(evidence.length);
  summary.textContent = `${item.type}: ${item.xNormalized}, ${item.yNormalized}; trusted=${item.isTrusted}; ${item.width}×${item.height}`;
  output.textContent = JSON.stringify(evidence.slice(-12), null, 2);
  renderMetrics();
}

for (const name of ["pointerdown", "mousedown", "pointerup", "mouseup", "click", "mousemove", "wheel"]) {
  canvas.addEventListener(name, record);
}

for (const name of ["keydown", "keyup", "input", "compositionstart", "compositionend"]) {
  document.querySelector("#keyboard-target").addEventListener(name, (event) => {
    evidence.push({ type: event.type, key: event.key, code: event.code, isTrusted: event.isTrusted, at: performance.now() });
    output.textContent = JSON.stringify(evidence.slice(-12), null, 2);
  });
}

function resize(width, height) {
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  paint();
  renderMetrics();
}

document.querySelector("#small").addEventListener("click", () => resize(640, 360));
document.querySelector("#large").addEventListener("click", () => resize(960, 540));
domTarget.addEventListener("click", () => {
  const pressed = domTarget.getAttribute("aria-pressed") !== "true";
  domTarget.setAttribute("aria-pressed", String(pressed));
  domTarget.textContent = `DOM toggle: ${pressed ? "ON" : "OFF"}`;
  renderMetrics();
});
document.querySelector("#clear").addEventListener("click", () => {
  evidence.length = 0;
  clickCount = 0;
  wheelCount = 0;
  marker = null;
  lastClick = null;
  lastWheel = null;
  lastRequestedPointWheel = null;
  delete canvas.dataset.lastEvent;
  canvas.dataset.eventCount = "0";
  summary.textContent = "No input received.";
  output.textContent = "";
  paint();
  renderMetrics();
});

for (const eventName of ["resize", "scroll"]) window.addEventListener(eventName, renderMetrics, { passive: true });
window.visualViewport?.addEventListener("resize", renderMetrics, { passive: true });

globalThis.__zuiDemo = { evidence, resize, geometry };
paint();
renderMetrics();
