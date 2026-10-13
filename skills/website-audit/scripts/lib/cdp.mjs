// Chrome discovery + a minimal DevTools-protocol client.
// Zero npm dependencies: Node >= 22 ships a global WebSocket.

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir, homedir, platform } from "node:os";
import { join } from "node:path";

export const sleep = ms => new Promise(r => setTimeout(r, ms));

// Where Chrome / Chromium usually lives. CHROME_BIN wins, then system installs,
// then a Chromium that `npx playwright install chromium` already downloaded.
export function findChrome() {
  const env = process.env.CHROME_BIN || process.env.CHROME_PATH;
  if (env && existsSync(env)) return env;
  const candidates = {
    darwin: [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    ],
    linux: [
      "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium",
      "/usr/bin/chromium-browser", "/snap/bin/chromium", "/usr/bin/microsoft-edge",
    ],
    win32: [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    ],
  }[platform()] || [];
  for (const c of candidates) if (existsSync(c)) return c;
  // Playwright's browser cache
  const pwRoots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    join(homedir(), "Library", "Caches", "ms-playwright"),
    join(homedir(), ".cache", "ms-playwright"),
    join(homedir(), "AppData", "Local", "ms-playwright"),
  ].filter(Boolean);
  for (const root of pwRoots) {
    if (!existsSync(root)) continue;
    const dirs = readdirSync(root).filter(d => /^chromium-\d+$/.test(d)).sort().reverse();
    for (const d of dirs) {
      const inner = [
        "chrome-mac/Chromium.app/Contents/MacOS/Chromium",
        "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
        "chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
        "chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
        "chrome-linux/chrome", "chrome-linux64/chrome", "chrome-win/chrome.exe", "chrome-win64/chrome.exe",
      ];
      for (const i of inner) { const p = join(root, d, i); if (existsSync(p)) return p; }
    }
  }
  return null;
}

export async function launchChrome(bin) {
  const profile = mkdtempSync(join(tmpdir(), "website-audit-"));
  const proc = spawn(bin, [
    "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`,
    "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", "--mute-audio",
    "--disable-background-networking", "--disable-extensions", "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });
  const wsUrl = await new Promise((resolve, reject) => {
    let buf = "";
    const t = setTimeout(() => reject(new Error("Chrome did not start within 20 s")), 20000);
    proc.on("error", e => { clearTimeout(t); reject(e); });
    proc.stderr.on("data", d => {
      buf += d.toString();
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) { clearTimeout(t); resolve(m[1]); }
    });
  });
  const close = () => { try { proc.kill(); } catch {} try { rmSync(profile, { recursive: true, force: true }); } catch {} };
  return { proc, wsUrl, close };
}

export class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.listeners = new Set(); }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const c = new CDP(ws);
    ws.onmessage = ev => {
      const msg = JSON.parse(ev.data);
      if (msg.id && c.pending.has(msg.id)) {
        const { resolve, reject } = c.pending.get(msg.id);
        c.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      } else if (msg.method) for (const l of [...c.listeners]) l(msg);
    };
    return c;
  }
  send(method, params = {}, sessionId, timeoutMs = 45000) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(`timeout ${method}`)); } }, timeoutMs);
    });
  }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  waitFor(pred, ms = 30000) {
    return new Promise(resolve => {
      let off;
      const t = setTimeout(() => { off(); resolve(null); }, ms);
      off = this.on(msg => { if (pred(msg)) { clearTimeout(t); off(); resolve(msg); } });
    });
  }
  close() { try { this.ws.close(); } catch {} }
}

// Open a fresh tab, return a small session helper.
export async function openTab(cdp) {
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  const s = (m, p, t) => cdp.send(m, p, sessionId, t);
  const eval_ = async (expression, awaitPromise = false) => {
    const r = await s("Runtime.evaluate", { expression, returnByValue: true, awaitPromise }, 60000);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const close = () => cdp.send("Target.closeTarget", { targetId }).catch(() => {});
  return { targetId, sessionId, s, eval: eval_, close };
}
