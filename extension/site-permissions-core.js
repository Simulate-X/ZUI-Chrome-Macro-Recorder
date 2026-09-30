(function initializeSitePermissionsCore(global) {
  "use strict";

  const SUPPORTED_PROTOCOLS = new Set(["http:", "https:"]);

  function targetPermission(value) {
    try {
      const url = new URL(value);
      if (!SUPPORTED_PROTOCOLS.has(url.protocol) || url.username || url.password || !url.hostname) {
        return { valid: false, code: "UNSUPPORTED_TARGET_SCHEME" };
      }
      return {
        valid: true,
        origin: url.origin,
        pattern: `${url.protocol}//${url.hostname}/*`,
        protocol: url.protocol,
        hostname: url.hostname
      };
    } catch (_) {
      return { valid: false, code: "UNSUPPORTED_TARGET_SCHEME" };
    }
  }

  async function hasSiteAccess(value, permissionsApi) {
    const target = targetPermission(value);
    if (!target.valid) throw new Error(target.code);
    return { target, granted: await permissionsApi.contains({ origins: [target.pattern] }) };
  }

  async function requestSiteAccess(value, permissionsApi) {
    const current = await hasSiteAccess(value, permissionsApi);
    if (current.granted) return { ...current, requested: false };
    let granted = false;
    try { granted = await permissionsApi.request({ origins: [current.target.pattern] }); }
    catch (_) { granted = false; }
    if (!granted) throw new Error("SITE_PERMISSION_DENIED");
    return { target: current.target, granted: true, requested: true };
  }

  async function requireSiteAccess(value, permissionsApi) {
    const current = await hasSiteAccess(value, permissionsApi);
    if (!current.granted) throw new Error("SITE_PERMISSION_REQUIRED");
    return current.target;
  }

  function grantedSiteEntries(origins) {
    const rows = [];
    for (const pattern of Array.isArray(origins) ? origins : []) {
      const match = /^(https?):\/\/([^/*]+|\[[^\]]+\])\/\*$/.exec(String(pattern));
      if (!match || match[2] === "*") continue;
      rows.push({ pattern, origin: `${match[1]}://${match[2]}`, hostname: match[2] });
    }
    return rows.sort((a, b) => a.origin.localeCompare(b.origin));
  }

  function sameOriginFrameIds(frames, origin) {
    return (Array.isArray(frames) ? frames : [])
      .filter((frame) => {
        try { return new URL(frame.url).origin === origin; }
        catch (_) { return false; }
      })
      .map((frame) => frame.frameId)
      .filter(Number.isInteger);
  }

  global.ZuiSitePermissions = Object.freeze({
    targetPermission, hasSiteAccess, requestSiteAccess, requireSiteAccess,
    grantedSiteEntries, sameOriginFrameIds
  });
})(globalThis);
