#!/usr/bin/env node
// website-audit: read-only technical + conversion audit of a live website.
//
//   node <skill-dir>/scripts/audit.mjs https://example.com [--limit 10] [--out DIR]
//        [--delay 1000] [--max-links 150] [--no-lighthouse] [--no-axe] [--max-minutes 15]
//
// Needs Node >= 22 and a Chrome/Chromium binary (auto-detected, or CHROME_BIN).
// Lighthouse and axe-core are fetched on demand; if either fails the area is
// marked as skipped in the report, the run does not crash.
//
// Writes into $WEBSITE_AUDIT_OUT/<domain>/ (default ./website-audit/<domain>/):
//   website-audit-<domain>-<date>.md     the report
//   website-audit-<domain>-<date>.json   raw measurements + findings
//   screens/                             first-screen screenshots (desktop + 390px)
// Prints a one-line JSON summary to stdout. Exit 0 = report written, 2 = could not run.

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { findChrome, launchChrome, CDP, openTab, sleep } from "./lib/cdp.mjs";
import { PAGE_PROBE, LAYOUT_PROBE, PERF_INIT, SCROLL_THROUGH } from "./lib/probes.mjs";
import { render } from "./report.mjs";

const VERSION = "1.0.0";
const AXE_VERSION = "4.13.0";
const LH_VERSION = "13.4.1";
const DESKTOP = { width: 1440, height: 900 };
const VIEWPORTS = [{ name: "360", width: 360, height: 780 }, { name: "390", width: 390, height: 844 }, { name: "768", width: 768, height: 1024 }];
const FILE_EXT = /\.(pdf|zip|rar|7z|exe|dmg|pkg|jpg|jpeg|png|gif|webp|avif|svg|mp4|mov|mp3|wav|docx?|xlsx?|pptx?|csv|xml|json|txt|ics)$/i;

// ---------- args ----------
const argv = process.argv.slice(2);
const opt = { limit: 10, delay: 1000, maxLinks: 150, lighthouse: true, axe: true, maxMinutes: 15, out: null, url: null };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--limit") opt.limit = Math.max(1, parseInt(argv[++i], 10) || 10);
  else if (a === "--delay") opt.delay = Math.max(0, parseInt(argv[++i], 10) || 0);
  else if (a === "--max-links") opt.maxLinks = Math.max(0, parseInt(argv[++i], 10) || 0);
  else if (a === "--max-minutes") opt.maxMinutes = Math.max(1, parseFloat(argv[++i]) || 15);
  else if (a === "--out") opt.out = argv[++i];
  else if (a === "--no-lighthouse") opt.lighthouse = false;
  else if (a === "--no-axe") opt.axe = false;
  else if (a === "-h" || a === "--help") { console.log(readFileSync(new URL(import.meta.url)).toString().split("\n").slice(1, 16).map(l => l.replace(/^\/\/ ?/, "")).join("\n")); process.exit(0); }
  else if (!a.startsWith("--")) opt.url = a;
}
const die = msg => { console.error(`website-audit: ${msg}`); console.log(JSON.stringify({ ok: false, error: msg })); process.exit(2); };
if (!opt.url) die("no URL given. Usage: node audit.mjs https://example.com [--limit 10]");
if (!/^https?:\/\//i.test(opt.url)) opt.url = "https://" + opt.url;

const nodeMajor = +process.versions.node.split(".")[0];
if (nodeMajor < 22 || typeof WebSocket === "undefined") die(`Node ${process.versions.node} is too old: install Node 22 or newer (it ships the WebSocket client this script uses).`);
const CHROME = findChrome();
if (!CHROME) die("no Chrome/Chromium found. Install Google Chrome, or run `npx playwright install chromium`, or set CHROME_BIN=/path/to/chrome.");

const t0 = Date.now();
const deadline = t0 + opt.maxMinutes * 60000;
const notes = [];
const log = (...a) => console.error("·", ...a);

// ---------- http helpers ----------
let UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
async function http(url, method = "GET", timeout = 15000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url, { method, redirect: "follow", signal: ctl.signal, headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" } });
    const body = method === "GET" ? await r.text().catch(() => "") : "";
    return { status: r.status, url: r.url, type: r.headers.get("content-type") || "", body, headers: r.headers };
  } catch (e) {
    return { status: 0, url, error: e.name === "AbortError" ? "timeout" : (e.cause?.code || e.message) };
  } finally { clearTimeout(t); }
}

// ---------- robots.txt ----------
function parseRobots(txt) {
  const groups = []; let cur = null, lastWasAgent = false;
  const sitemaps = [];
  for (let line of txt.split(/\r?\n/)) {
    line = line.replace(/#.*/, "").trim();
    const m = line.match(/^([\w-]+)\s*:\s*(.*)$/); if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === "sitemap") { sitemaps.push(v); continue; }
    if (k === "user-agent") { if (!lastWasAgent || !cur) { cur = { agents: [], rules: [] }; groups.push(cur); } cur.agents.push(v.toLowerCase()); lastWasAgent = true; continue; }
    lastWasAgent = false;
    if (!cur) continue;
    if (k === "disallow" || k === "allow") cur.rules.push({ allow: k === "allow", path: v });
  }
  const mine = groups.filter(g => g.agents.some(a => a === "website-audit")) ;
  const rules = (mine.length ? mine : groups.filter(g => g.agents.includes("*"))).flatMap(g => g.rules).filter(r => r.path !== "" || r.allow);
  return { rules, sitemaps };
}
function robotsAllows(rules, url) {
  let p; try { const u = new URL(url); p = u.pathname + u.search; } catch { return true; }
  let best = null;
  for (const r of rules) {
    if (!r.path) continue;
    const re = new RegExp("^" + r.path.replace(/[.+?^(){}|[\]\\]/g, "\\$&").replace(/\*/g, ".*"));
    if (re.test(p) && (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow))) best = r;
  }
  return !best || best.allow;
}

// ---------- sitemap ----------
async function readSitemap(origin, robotsSitemaps) {
  const tried = [...new Set([...robotsSitemaps, origin + "/sitemap.xml", origin + "/sitemap_index.xml"])];
  for (const u of tried) {
    const r = await http(u);
    if (r.status !== 200 || !/<(urlset|sitemapindex)/i.test(r.body)) continue;
    let locs = [...r.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map(m => m[1].replace(/&amp;/g, "&"));
    if (/<sitemapindex/i.test(r.body)) {
      const children = locs.slice(0, 5); locs = [];
      for (const c of children) {
        const cr = await http(c); await sleep(200);
        if (cr.status === 200) locs.push(...[...cr.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map(m => m[1].replace(/&amp;/g, "&")));
      }
    }
    return { url: u, status: 200, count: locs.length, urls: locs.slice(0, 5000) };
  }
  return { url: origin + "/sitemap.xml", status: 404, count: 0, urls: [], note: `tried ${tried.length} location(s)` };
}

// ---------- URL helpers ----------
const keyOf = u => { try { const x = new URL(u); return (x.origin + x.pathname).replace(/\/$/, ""); } catch { return u; } };
const KEY_PAGES = [
  [/contact|kontakt|get-in-touch|zv.?ia?z|zvyaz/i, 0], [/pricing|price|ціни|tsiny|cost/i, 1], [/services?|poslug|solutions|what-we-do|offer/i, 2],
  [/case|portfolio|work|projects?|kejs|keys/i, 3], [/about|pro-nas|company|team|who-we-are/i, 4], [/book|demo|consult|quote|hire/i, 5],
];
function rankCandidates(origin, homeLinks, sitemapUrls) {
  const seen = new Map();
  const push = (u, base) => {
    let x; try { x = new URL(u); } catch { return; }
    if (x.origin !== origin || !/^https?:$/.test(x.protocol) || x.search || FILE_EXT.test(x.pathname)) return;
    x.hash = "";
    const k = keyOf(x.href);
    if (k === keyOf(origin + "/")) return;
    const kp = KEY_PAGES.find(([re]) => re.test(x.pathname));
    const depth = x.pathname.split("/").filter(Boolean).length;
    const score = (kp ? kp[1] : 10) + base + depth * 0.1;
    if (!seen.has(k) || seen.get(k).score > score) seen.set(k, { url: x.href, score });
  };
  homeLinks.forEach(l => push(l.href, l.nav ? 0 : 20));
  sitemapUrls.forEach(u => push(u, 40));
  return [...seen.values()].sort((a, b) => a.score - b.score).map(v => v.url);
}

// ---------- axe-core source ----------
async function loadAxe(cacheDir) {
  if (process.env.AXE_SOURCE && existsSync(process.env.AXE_SOURCE)) return readFileSync(process.env.AXE_SOURCE, "utf8");
  const cached = join(cacheDir, `axe-${AXE_VERSION}.min.js`);
  if (existsSync(cached)) return readFileSync(cached, "utf8");
  for (const u of [`https://cdn.jsdelivr.net/npm/axe-core@${AXE_VERSION}/axe.min.js`, `https://unpkg.com/axe-core@${AXE_VERSION}/axe.min.js`]) {
    const r = await http(u, "GET", 30000);
    if (r.status === 200 && r.body.includes("axe")) { mkdirSync(cacheDir, { recursive: true }); writeFileSync(cached, r.body); return r.body; }
  }
  return null;
}
const AXE_RUN = `axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a','wcag2aa','wcag21a','wcag21aa'] }, resultTypes: ['violations'] })
  .then(r => r.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help, helpUrl: v.helpUrl, nodes: v.nodes.length,
    targets: v.nodes.slice(0, 4).map(n => [].concat(n.target).join(' ')) })))`;

// ---------- Lighthouse ----------
function runLighthouse(url, outFile) {
  return new Promise(res => {
    const [maj, min] = process.versions.node.split(".").map(Number);
    if (maj < 22 || (maj === 22 && min < 19)) return res({ skipped: `Lighthouse ${LH_VERSION} needs Node >= 22.19 (found ${process.versions.node})` });
    const npx = process.platform === "win32" ? "npx.cmd" : "npx";
    const args = ["--yes", `lighthouse@${LH_VERSION}`, url, "--output=json", `--output-path=${outFile}`, "--only-categories=performance",
      "--quiet", "--chrome-flags=--headless=new --no-sandbox --disable-gpu"];
    const p = spawn(npx, args, { env: { ...process.env, CHROME_PATH: CHROME }, stdio: ["ignore", "ignore", "pipe"], shell: process.platform === "win32" });
    let err = "";
    p.stderr.on("data", d => { err += d.toString(); if (err.length > 4000) err = err.slice(-4000); });
    const t = setTimeout(() => { try { p.kill("SIGKILL"); } catch {} res({ skipped: "Lighthouse timed out after 240 s" }); }, 240000);
    p.on("error", e => { clearTimeout(t); res({ skipped: `could not start npx (${e.message}); install Node with npm` }); });
    p.on("close", code => {
      clearTimeout(t);
      if (!existsSync(outFile)) return res({ skipped: `Lighthouse exited with code ${code}: ${err.trim().split("\n").slice(-2).join(" ").slice(0, 300) || "no output"}` });
      try {
        const j = JSON.parse(readFileSync(outFile, "utf8"));
        const A = j.audits || {};
        const n = k => A[k]?.numericValue ?? null;
        const opps = Object.values(A).filter(x => x.details?.type === "opportunity" && (x.details.overallSavingsMs || 0) > 300)
          .sort((a, b) => b.details.overallSavingsMs - a.details.overallSavingsMs).slice(0, 5)
          .map(x => `${x.title} (~${(x.details.overallSavingsMs / 1000).toFixed(1)} s)`);
        res({ url, version: j.lighthouseVersion, score: Math.round((j.categories?.performance?.score ?? 0) * 100),
          metrics: { lcp: n("largest-contentful-paint"), fcp: n("first-contentful-paint"), cls: n("cumulative-layout-shift"), tbt: n("total-blocking-time"), si: n("speed-index") }, opportunities: opps });
      } catch (e) { res({ skipped: `could not read the Lighthouse report: ${e.message}` }); }
    });
  });
}

// ---------- one page, desktop ----------
async function auditDesktop(cdp, url, origin, axeSrc, shotPath) {
  const tab = await openTab(cdp);
  const out = { consoleErrors: [], exceptions: [], badResponses: [], failedRequests: [], mixed: [], weightBytes: 0, requests: 0, thirdPartyHosts: [] };
  const hosts = new Set(); const reqUrl = new Map();
  const off = cdp.on(msg => {
    if (msg.sessionId !== tab.sessionId) return;
    const p = msg.params;
    switch (msg.method) {
      case "Network.requestWillBeSent":
        reqUrl.set(p.requestId, { url: p.request.url, type: p.type });
        out.requests++;
        if (url.startsWith("https:") && p.request.url.startsWith("http:")) out.mixed.push(p.request.url.slice(0, 160));
        try { const h = new URL(p.request.url).hostname; if (p.type === "Script" && h && new URL(origin).hostname.replace(/^www\./, "") !== h.replace(/^www\./, "") && !h.endsWith("." + new URL(origin).hostname.replace(/^www\./, ""))) hosts.add(h); } catch {}
        break;
      case "Network.responseReceived": {
        const r = p.response;
        if (p.type === "Document" && out.status == null) { out.status = r.status; out.contentType = r.mimeType; out.xRobots = r.headers?.["x-robots-tag"] || r.headers?.["X-Robots-Tag"] || null; }
        if (r.status >= 400 && !/^data:/.test(r.url)) out.badResponses.push({ url: r.url.slice(0, 200), status: r.status, type: p.type, document: p.type === "Document" && out.badResponses.length === 0 && r.url === out.docUrl });
        break;
      }
      case "Network.loadingFinished": out.weightBytes += p.encodedDataLength || 0; break;
      case "Network.loadingFailed":
        if (!p.canceled && !/ERR_ABORTED|ERR_BLOCKED_BY_CLIENT|ERR_CACHE_MISS/.test(p.errorText)) {
          const r = reqUrl.get(p.requestId); if (r) out.failedRequests.push({ url: r.url, error: p.errorText, type: r.type });
        }
        break;
      case "Runtime.consoleAPICalled":
        if (p.type === "error") out.consoleErrors.push(p.args.map(a => a.value ?? a.description ?? "").join(" ").slice(0, 220));
        break;
      case "Runtime.exceptionThrown":
        out.exceptions.push((p.exceptionDetails.exception?.description || p.exceptionDetails.text || "").split("\n")[0].slice(0, 220));
        break;
      case "Log.entryAdded":
        if (p.entry.level === "error" && p.entry.source !== "network" && p.entry.source !== "violation") out.consoleErrors.push(p.entry.text.slice(0, 220));
        break;
    }
  });
  try {
    await tab.s("Page.enable"); await tab.s("Network.enable"); await tab.s("Runtime.enable"); await tab.s("Log.enable");
    await tab.s("Network.setUserAgentOverride", { userAgent: UA });
    await tab.s("Emulation.setDeviceMetricsOverride", { ...DESKTOP, deviceScaleFactor: 1, mobile: false });
    await tab.s("Page.addScriptToEvaluateOnNewDocument", { source: PERF_INIT });
    out.docUrl = url;
    const loadP = cdp.waitFor(m => m.sessionId === tab.sessionId && m.method === "Page.loadEventFired", 35000);
    const nav = await tab.s("Page.navigate", { url });
    if (nav.errorText) throw new Error(nav.errorText);
    const loaded = await loadP;
    if (!loaded) notes.push(`${url}: load event did not fire within 35 s; measured what had rendered`);
    await sleep(1500);
    const early = await tab.eval("JSON.stringify(window.__wa || {})").catch(() => "{}");
    try {
      const { data } = await tab.s("Page.captureScreenshot", { format: "jpeg", quality: 60 });
      writeFileSync(shotPath, Buffer.from(data, "base64")); out.screenshotDesktop = shotPath;
    } catch {}
    await tab.eval(SCROLL_THROUGH, true).catch(() => {});
    await sleep(800);
    out.desktop = await tab.eval(PAGE_PROBE);
    const e = JSON.parse(early || "{}");
    if (e.lcp) out.desktop.perf.lcp = Math.round(e.lcp);
    if (e.cls != null) out.desktop.perf.cls = +(+e.cls).toFixed(3);
    if (axeSrc) {
      try {
        await tab.eval(axeSrc + ";1");
        out.axe = { violations: await tab.eval(AXE_RUN, true) };
      } catch (err) { out.axe = { error: err.message.slice(0, 200) }; }
    }
  } catch (err) {
    out.error = err.message;
  } finally {
    off(); await tab.close();
  }
  out.thirdPartyHosts = [...hosts];
  out.badResponses = out.badResponses.filter(r => !(r.type === "Document" && keyOf(r.url) === keyOf(url)));
  delete out.docUrl;
  return out;
}

// ---------- one page, phone/tablet layout ----------
async function auditLayout(cdp, url, vp, shotPath) {
  const tab = await openTab(cdp);
  try {
    await tab.s("Page.enable");
    await tab.s("Network.setUserAgentOverride", { userAgent: vp.width < 768 ? UA.replace(/\(Macintosh[^)]*\)/, "(Linux; Android 14; Pixel 8)").replace("Safari", "Mobile Safari") : UA });
    await tab.s("Emulation.setDeviceMetricsOverride", { width: vp.width, height: vp.height, deviceScaleFactor: 2, mobile: vp.width < 768 });
    await tab.s("Emulation.setTouchEmulationEnabled", { enabled: vp.width < 768 });
    const loadP = cdp.waitFor(m => m.sessionId === tab.sessionId && m.method === "Page.loadEventFired", 30000);
    const nav = await tab.s("Page.navigate", { url });
    if (nav.errorText) throw new Error(nav.errorText);
    await loadP; await sleep(1200);
    if (shotPath) {
      try { const { data } = await tab.s("Page.captureScreenshot", { format: "jpeg", quality: 55 }); writeFileSync(shotPath, Buffer.from(data, "base64")); } catch {}
    }
    await tab.eval("document.querySelectorAll('.rv,.reveal,[data-reveal],[data-aos]').forEach(e=>{e.style.opacity=1;e.style.transform='none'}); 1").catch(() => {});
    await sleep(300);
    return await tab.eval(LAYOUT_PROBE);
  } catch (err) {
    return { error: err.message };
  } finally { await tab.close(); }
}

// ---------- link + form-target checks ----------
async function checkUrl(u) {
  let r = await http(u, "HEAD", 12000);
  if ([0, 403, 405, 501].includes(r.status) || (r.status >= 400 && r.status !== 404 && r.status !== 410)) {
    await sleep(150);
    const g = await http(u, "GET", 15000);
    if (g.status) r = g;
  }
  return r;
}

// ---------- main ----------
(async () => {
  log(`website-audit ${VERSION} · ${opt.url} · limit ${opt.limit}`);
  const first = await http(opt.url);
  if (!first.status) die(`cannot reach ${opt.url}: ${first.error}`);
  const start = new URL(first.url || opt.url);
  const origin = start.origin;
  const domain = start.hostname.replace(/^www\./, "");
  const date = new Date().toISOString().slice(0, 10);
  const base = resolve(opt.out || process.env.WEBSITE_AUDIT_OUT || join(process.cwd(), "website-audit"));
  const dir = join(base, domain);
  const shots = join(dir, "screens");
  mkdirSync(shots, { recursive: true });

  // robots + sitemap
  const rb = await http(origin + "/robots.txt");
  const robotsOk = rb.status === 200 && !/<html/i.test(rb.body.slice(0, 500));
  const robots = robotsOk ? parseRobots(rb.body) : { rules: [], sitemaps: [] };
  const blocksAll = robotsOk && robots.rules.some(r => !r.allow && r.path === "/") && !robots.rules.some(r => r.allow && r.path === "/");
  const sitemap = await readSitemap(origin, robots.sitemaps);
  log(`robots.txt ${rb.status}${blocksAll ? " (blocks all crawlers)" : ""} · sitemap ${sitemap.count} URL(s)`);

  // tools
  const skipped = {};
  let axeSrc = null;
  if (opt.axe) { axeSrc = await loadAxe(join(base, ".cache")); if (!axeSrc) skipped.a11y = `could not download axe-core ${AXE_VERSION} (offline or CDN blocked); set AXE_SOURCE=/path/to/axe.min.js to run it offline`; }
  else skipped.a11y = "disabled with --no-axe";

  let chrome, cdp;
  try { chrome = await launchChrome(CHROME); cdp = await CDP.connect(chrome.wsUrl); }
  catch (e) { die(`Chrome failed to start (${CHROME}): ${e.message}`); }
  try { const v = await cdp.send("Browser.getVersion"); UA = v.userAgent.replace("HeadlessChrome", "Chrome"); var browser = v.product; } catch {}

  const raw = {
    meta: { tool: "website-audit", version: VERSION, url: opt.url, origin, domain, limit: opt.limit, startedAt: new Date(t0).toISOString(),
      browser: browser || "Chrome", delayMs: opt.delay, linkCap: opt.maxLinks, axeVersion: AXE_VERSION, notes },
    site: { robots: { url: origin + "/robots.txt", status: robotsOk ? 200 : rb.status, blocksAll, sitemaps: robots.sitemaps },
      sitemap: { url: sitemap.url, status: sitemap.status, count: sitemap.count, note: sitemap.note }, skippedByRobots: [] },
    pages: [], linkCheck: [], formTargets: [], lighthouse: null, skipped,
  };

  const slug = u => (new URL(u).pathname.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "home").slice(0, 60);
  const auditOne = async url => {
    log(`page ${raw.pages.length + 1}/${opt.limit}: ${url}`);
    const d = await auditDesktop(cdp, url, origin, axeSrc, join(shots, `${slug(url)}-desktop.jpg`));
    const page = { url, ...d, layout: {} };
    if (d.desktop) for (const vp of VIEWPORTS) {
      await sleep(Math.min(opt.delay, 400));
      page.layout[vp.name] = await auditLayout(cdp, url, vp, vp.name === "390" ? join(shots, `${slug(url)}-390.jpg`) : null);
    }
    raw.pages.push(page);
    return page;
  };

  // 1. homepage
  const homeUrl = first.url || opt.url;
  const home = await auditOne(homeUrl);
  if (!home.desktop) notes.push(`homepage could not be measured: ${home.error}`);

  // 2. the rest, best candidates first
  const cands = rankCandidates(origin, home.desktop?.links || [], sitemap.urls);
  let pageSource = home.desktop?.links?.length ? "homepage links" : "";
  if (sitemap.count) pageSource = pageSource ? `${pageSource} + sitemap.xml` : "sitemap.xml";
  raw.meta.pageSource = (pageSource || "the homepage only") + " (contact, pricing, services, cases, about first)";
  const done = new Set([keyOf(homeUrl)]);
  for (const u of cands) {
    if (raw.pages.length >= opt.limit) break;
    if (Date.now() > deadline) { notes.push(`time budget of ${opt.maxMinutes} min reached; stopped after ${raw.pages.length} pages`); break; }
    if (done.has(keyOf(u))) continue;
    if (!robotsAllows(robots.rules, u)) { raw.site.skippedByRobots.push(u); continue; }
    done.add(keyOf(u));
    await sleep(opt.delay);
    await auditOne(u);
  }
  raw.meta.pagesLimited = raw.pages.length >= opt.limit && cands.filter(u => !done.has(keyOf(u))).length > 0;

  try { cdp.close(); } catch {}
  chrome.close();

  // 3. internal links (HEAD, then GET when HEAD is refused)
  const audited = new Map(raw.pages.map(p => [keyOf(p.url), p]));
  const links = new Map();
  for (const p of raw.pages) for (const l of p.desktop?.links || []) {
    let x; try { x = new URL(l.href); } catch { continue; }
    if (x.origin !== origin || !/^https?:$/.test(x.protocol)) continue;
    x.hash = "";
    const k = x.href;
    if (!links.has(k)) links.set(k, { url: k, from: [], nav: false, sel: l.sel });
    const e = links.get(k);
    if (!e.from.includes(p.url)) e.from.push(p.url);
    if (l.nav) e.nav = true;
  }
  let checked = 0;
  for (const e of links.values()) {
    if (checked >= opt.maxLinks || Date.now() > deadline) break;
    const ap = audited.get(keyOf(e.url));
    if (ap && ap.status) { raw.linkCheck.push({ ...e, status: ap.status }); continue; }
    if (!robotsAllows(robots.rules, e.url)) continue;
    const r = await checkUrl(e.url); checked++;
    raw.linkCheck.push({ ...e, status: r.status, error: r.error });
    await sleep(120);
  }
  log(`internal links checked: ${raw.linkCheck.length}`);

  // 4. form targets (HEAD only, never a submission)
  for (const p of raw.pages) for (const f of p.desktop?.forms || []) {
    if (!f.actionAttr || /^(javascript:|#|mailto:)/i.test(f.actionAttr) || f.isSearch) continue;
    let x; try { x = new URL(f.action); } catch { continue; }
    if (x.origin !== origin || keyOf(x.href) === keyOf(p.url)) continue;
    const r = await http(x.href, "HEAD", 12000);
    raw.formTargets.push({ page: p.url, form: f.sel, action: x.href, method: f.method, status: r.status });
  }

  // 5. Lighthouse on the homepage
  if (opt.lighthouse && home.desktop && Date.now() < deadline) {
    log("Lighthouse (homepage, mobile)…");
    raw.lighthouse = await runLighthouse(homeUrl, join(dir, `.lighthouse-${date}.json`));
    if (raw.lighthouse.skipped) skipped.perf = raw.lighthouse.skipped;
  } else if (!opt.lighthouse) skipped.perf = "disabled with --no-lighthouse";
  else skipped.perf = "time budget reached before Lighthouse";
  if (!raw.pages.some(p => p.axe?.violations) && !skipped.a11y) {
    const err = raw.pages.find(p => p.axe?.error)?.axe.error;
    skipped.a11y = `axe-core did not run on any page${err ? `: ${err}` : ""}`;
  }

  // 6. write
  raw.meta.finishedAt = new Date().toISOString();
  raw.meta.seconds = Math.round((Date.now() - t0) / 1000);
  const name = `website-audit-${domain}-${date}`;
  const { md, analysis } = render(raw);
  raw.findings = analysis.findings; raw.scores = analysis.scores; raw.overall = analysis.overall; raw.counts = analysis.counts; raw.snapshot = analysis.snapshot;
  writeFileSync(join(dir, name + ".json"), JSON.stringify(raw, null, 2));
  writeFileSync(join(dir, name + ".md"), md);
  const summary = { ok: true, report: join(dir, name + ".md"), json: join(dir, name + ".json"), pages: raw.pages.length, seconds: raw.meta.seconds,
    overall: analysis.overall, counts: analysis.counts, scores: Object.fromEntries(Object.entries(analysis.scores).map(([k, v]) => [k, v.score])), skipped };
  console.log(JSON.stringify(summary));
  process.exit(0);
})().catch(e => die(`unexpected error: ${e.stack || e.message}`));
