"use strict";
async function finish(skipped) {
  await chrome.storage.local.set({ zuiOnboarding: { completed: true, skipped: Boolean(skipped), completedAt: new Date().toISOString() } });
  if (skipped) return window.close();
  location.href = chrome.runtime.getURL("editor.html");
}
document.querySelector("#skip").addEventListener("click", () => finish(true));
document.querySelector("#finish").addEventListener("click", () => finish(false));
