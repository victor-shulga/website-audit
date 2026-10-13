// Turns raw measurements into prioritised findings, area scores and the
// before-rebuild snapshot. Pure functions: no network, no browser.
//
// Priority scale (lead-centric):
//   P0  blocks leads or breaks the site      (fix before anything else)
//   P1  loses leads on a common path          (fix in the rebuild, first sprint)
//   P2  friction or lost reach                (fix in the rebuild)
//   P3  polish                                (backlog)

export const AREAS = {
  conversion: "Conversion path",
  mobile: "Mobile layout",
  bugs: "Bugs & broken things",
  a11y: "Accessibility (WCAG 2.1 A/AA)",
  perf: "Performance",
  seo: "SEO basics",
};

// id → static text. `why` is always phrased in terms of leads.
const C = {
  // bugs
  http_error: { area: "bugs", p: "P0", title: "Page returns an error", why: "Visitors and search engines land on an error instead of the offer; every ad, post or email link to this URL is wasted.", fix: "Restore the page or 301-redirect it to the closest live page, then update the links that point here." },
  load_error: { area: "bugs", p: "P0", title: "Page did not load in the browser", why: "If a headless browser cannot open it, some real visitors cannot either.", fix: "Open the URL yourself; check DNS/SSL/timeouts and server logs." },
  js_exception: { area: "bugs", p: "P1", title: "Uncaught JavaScript error", why: "A script crash can silently break menus, forms, booking widgets or analytics, so leads disappear without a trace.", fix: "Open the page with the browser console, fix or remove the failing script; re-test the contact form afterwards." },
  console_error: { area: "bugs", p: "P2", title: "Console errors on load", why: "Errors are usually a broken third-party snippet or a missing file; one of them may be the tracking or chat widget you rely on.", fix: "Go through the messages, remove dead snippets, fix missing files." },
  resource_5xx: { area: "bugs", p: "P1", title: "Server error (5xx) on a page resource", why: "Something the page needs is failing on the server side; that part of the page or its tracking is broken for everyone.", fix: "Check the failing URL on the server; fix or remove the reference." },
  resource_4xx: { area: "bugs", p: "P2", title: "Missing resource (4xx) requested by the page", why: "A missing script, style, font or image means part of the page renders or behaves differently than designed.", fix: "Fix the path or remove the reference to the missing file." },
  request_failed: { area: "bugs", p: "P3", title: "Network request failed", why: "Usually a blocked or dead third-party host; if it is a form, chat or booking script, leads cannot use it.", fix: "Check each host: remove dead ones, replace blocked ones." },
  broken_link_nav: { area: "bugs", p: "P0", title: "Broken link in the header/navigation", why: "Navigation is the main route to services and contact; a dead link there is a dead end on every page.", fix: "Fix the href or add a 301 redirect from the dead URL." },
  broken_link: { area: "bugs", p: "P1", title: "Broken internal link", why: "Each dead link ends a visit that was heading somewhere, often toward a case or the contact page.", fix: "Fix the href or 301-redirect the old URL; re-run the audit to confirm." },
  broken_image: { area: "bugs", p: "P2", title: "Broken image", why: "Empty boxes where photos, logos or case visuals should be make the company look careless to a buyer comparing vendors.", fix: "Fix the image path or remove the element." },
  empty_img_src: { area: "bugs", p: "P2", title: "Image with an empty or placeholder src", why: "An empty src triggers a useless request to the page itself and shows nothing.", fix: "Set a real src or remove the tag." },
  mixed_content: { area: "bugs", p: "P1", title: "Insecure (http) resource on an https page", why: "Browsers block it and may show a 'not secure' warning, which costs trust at the moment of contact.", fix: "Serve the resource over https or host it yourself." },
  template_bleed: { area: "bugs", p: "P1", title: "Raw template code visible on the page", why: "Visible {{tokens}} or [object Object] read as a broken site.", fix: "Fix the template or data binding that outputs the raw value.", manual: true },
  form_action_dead: { area: "bugs", p: "P0", title: "Form posts to a URL that does not exist", why: "Every submission is lost; the visitor thinks they contacted you and nobody receives it.", fix: "Point the form at a working endpoint, then send one test submission yourself and confirm it arrives." },
  form_no_submit: { area: "bugs", p: "P2", title: "Form without a visible submit button", why: "If the form is not submitted by JavaScript, visitors have no way to send it.", fix: "Add a clear submit button or confirm the JS handler works by sending a test submission yourself.", manual: true },
  // a11y (form-specific; axe rules are added dynamically)
  form_unlabeled: { area: "a11y", p: "P1", title: "Form fields without a label", why: "Screen-reader users and browser autofill cannot tell what to type, so fewer forms get completed.", fix: "Give every field a visible <label for=…> (or aria-label if a visible label is impossible)." },
  form_placeholder_only: { area: "a11y", p: "P2", title: "Form fields labelled only by placeholder", why: "The hint disappears as soon as the visitor types; long forms get abandoned or filled wrong.", fix: "Add visible labels above the fields; keep placeholders as examples only." },
  // mobile
  no_viewport: { area: "mobile", p: "P0", title: "No <meta name=viewport>", why: "Phones render the desktop layout zoomed out; most B2B first visits from social and email happen on a phone.", fix: "Add <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"> to <head>." },
  mobile_overflow_home: { area: "mobile", p: "P0", title: "Homepage scrolls sideways on phones", why: "The page wobbles left-right on the first visit; it reads as broken and people leave before the offer.", fix: "Find the element wider than the screen (see selector), set max-width:100% / overflow-wrap, use minmax(0,1fr) grid tracks." },
  mobile_overflow: { area: "mobile", p: "P1", title: "Page scrolls sideways on phones", why: "Horizontal scroll on a phone makes the page feel broken and hides content off-screen.", fix: "Fix the element wider than the screen (see selector): max-width:100%, overflow-wrap:anywhere, minmax(0,1fr) grid tracks, scrollable tables inside a wrapper." },
  tablet_overflow: { area: "mobile", p: "P2", title: "Page wider than the screen on tablets (768px)", why: "Tablet visitors see a cut-off layout.", fix: "Same fix as for phones; check the 768px breakpoint." },
  offender: { area: "mobile", p: "P2", title: "Element sticks out past the screen edge", why: "Cut-off text or buttons on a phone; when it is the CTA, the lead never sees it.", fix: "Constrain the element width on small screens." },
  small_tap: { area: "mobile", p: "P2", title: "Tap targets smaller than 32×32 px", why: "Fat-finger misses on menus and buttons; mis-taps on a CTA cost leads.", fix: "Give links and buttons at least 32×32 px (44×44 is better) of tap area via padding." },
  tiny_text: { area: "mobile", p: "P3", title: "Text smaller than 12 px on phones", why: "Hard to read without zooming; fine print about pricing or guarantees goes unread.", fix: "Use at least 14 px body text and 12 px for captions." },
  // conversion
  no_contact_path: { area: "conversion", p: "P0", title: "No contact path within 2 clicks of the homepage", why: "A buyer who is ready to talk cannot find how; this is the most expensive defect a B2B site can have.", fix: "Put a contact/booking CTA in the header and in the first screen of the homepage; link to a contact page with a short form and a booking link." },
  contact_path_2: { area: "conversion", p: "P3", title: "Contact is 2 clicks away from the homepage", why: "Every extra click loses part of the ready-to-talk visitors.", fix: "Link the contact page or booking link directly from the header." },
  no_cta_fold_desktop: { area: "conversion", p: "P1", title: "No call to action in the first screen (desktop)", why: "The first screen is the only part every visitor sees; without a next step there, interested visitors scroll, get distracted and leave.", fix: "Add one primary CTA button in the hero (e.g. 'Book a call', 'Get a quote') plus a contact link in the header." },
  no_cta_fold_mobile: { area: "conversion", p: "P1", title: "No call to action in the first screen (phone)", why: "On phones the header menu usually collapses, so the contact link disappears with it.", fix: "Show a CTA button in the mobile hero or keep a compact CTA visible next to the burger icon." },
  cta_fold_missing_pages: { area: "conversion", p: "P2", title: "Pages without a call to action in the first screen", why: "Service and case pages are where intent peaks; a missing next step there wastes it.", fix: "Add the same primary CTA to the hero of every service and case page." },
  cta_plain_link: { area: "conversion", p: "P2", title: "First-screen CTA is only a plain text link", why: "A text link next to a large hero is easy to miss; a button gets more clicks.", fix: "Style the primary CTA as a button with contrast against the hero.", manual: true },
  no_cta_on_page: { area: "conversion", p: "P2", title: "Page has no call to action at all", why: "The visitor finishes reading and has nowhere to go but back.", fix: "End every page with a CTA block (contact form, booking link or 'talk to us')." },
  no_contact_info: { area: "conversion", p: "P2", title: "No email or phone anywhere on the audited pages", why: "Some buyers will not fill a form; they want a direct address to forward to a colleague.", fix: "Add a business email (and phone if you take calls) to the footer and contact page." },
  no_booking: { area: "conversion", p: "P3", title: "No direct booking link found", why: "A self-serve calendar link removes a round of email ping-pong between interest and the first call.", fix: "Add a booking link to the contact page and the primary CTA.", manual: true },
  no_lead_form: { area: "conversion", p: "P2", title: "No lead form with an email field found", why: "Visitors who are not ready for a call have no low-effort way to reach out.", fix: "Add a short form (name, email, message) to the contact page.", manual: true },
  trust_testimonials: { area: "conversion", p: "P2", title: "No client testimonials detected", why: "B2B buyers look for proof from peers before they contact a vendor.", fix: "Add 2–3 named testimonials (name, role, company) near the CTA.", manual: true },
  trust_cases: { area: "conversion", p: "P2", title: "No case studies detected", why: "Case studies are the main proof a services buyer reads before shortlisting.", fix: "Publish case studies in the format problem → what was done → measurable result, linked from the homepage.", manual: true },
  trust_logos: { area: "conversion", p: "P3", title: "No client logo strip detected", why: "Recognisable logos are the fastest trust signal in the first screens.", fix: "Add a strip of client logos (with permission) under the hero.", manual: true },
  trust_numbers: { area: "conversion", p: "P3", title: "No proof numbers detected", why: "Concrete numbers (years, projects, results) make claims checkable.", fix: "Add 3–4 hard numbers with context near the hero.", manual: true },
  // seo
  robots_block_all: { area: "seo", p: "P0", title: "robots.txt blocks the whole site", why: "Search engines are told not to crawl anything; organic leads go to zero.", fix: "Remove 'Disallow: /' for User-agent: * unless the site is intentionally private." },
  noindex_home: { area: "seo", p: "P0", title: "Homepage is set to noindex", why: "The homepage will drop out of search results.", fix: "Remove noindex from the robots meta tag / X-Robots-Tag header." },
  noindex: { area: "seo", p: "P1", title: "Page is set to noindex", why: "The page will not appear in search; fine for thank-you pages, a loss for service pages.", fix: "Remove noindex if the page should rank.", manual: true },
  no_title: { area: "seo", p: "P1", title: "Missing <title>", why: "Search results and browser tabs show the raw URL; fewer clicks from search.", fix: "Write a unique title: what you do + for whom, 30–60 characters." },
  title_length: { area: "seo", p: "P3", title: "Title too short or too long", why: "Too long gets cut in search results; too short wastes the most-read line.", fix: "Keep titles at roughly 30–60 characters." },
  dup_title: { area: "seo", p: "P2", title: "Same title on several pages", why: "Search engines cannot tell which page answers which query.", fix: "Give each page a unique title." },
  no_description: { area: "seo", p: "P2", title: "Missing meta description", why: "Search engines pick a random snippet; the result reads worse than competitors'.", fix: "Write a 120–160 character description with the offer and a reason to click." },
  description_length: { area: "seo", p: "P3", title: "Meta description too short or too long", why: "Gets cut or looks thin in search results.", fix: "Aim for 120–160 characters." },
  dup_description: { area: "seo", p: "P3", title: "Same meta description on several pages", why: "Duplicate snippets lower click-through from search.", fix: "Write a unique description per page." },
  no_h1: { area: "seo", p: "P2", title: "No visible H1", why: "The main heading tells search engines and visitors what the page is about.", fix: "Add one H1 that states the offer of the page." },
  multi_h1: { area: "seo", p: "P3", title: "More than one H1", why: "Dilutes the main topic signal of the page.", fix: "Keep one H1; turn the rest into H2." },
  no_canonical: { area: "seo", p: "P3", title: "No canonical tag", why: "Duplicate URLs (with/without slash, parameters) can split ranking signals.", fix: "Add <link rel=\"canonical\"> pointing to the preferred URL." },
  canonical_offsite: { area: "seo", p: "P1", title: "Canonical points to another domain", why: "Tells search engines to rank a different site instead of this page.", fix: "Point the canonical to this page's own URL.", manual: true },
  no_og: { area: "seo", p: "P3", title: "Missing Open Graph tags", why: "Links shared on LinkedIn or in messengers show no image or a random one; fewer clicks from social.", fix: "Add og:title, og:description and og:image (1200×630)." },
  no_sitemap: { area: "seo", p: "P2", title: "No sitemap.xml found", why: "New and deep pages get discovered by search engines slower.", fix: "Publish /sitemap.xml and reference it in robots.txt." },
  no_robots: { area: "seo", p: "P3", title: "No robots.txt", why: "Not harmful by itself, but it is where the sitemap location is announced.", fix: "Add /robots.txt with a Sitemap: line." },
  // perf
  lh_score: { area: "perf", p: "P2", title: "Low Lighthouse performance score (mobile)", why: "Slow pages lose visitors before the first screen renders, especially on mobile data.", fix: "Start with the largest items in the Lighthouse opportunities: image sizes and formats, render-blocking scripts, unused JS." },
  lcp: { area: "perf", p: "P2", title: "Slow Largest Contentful Paint", why: "The main content appears late; a share of visitors leave before seeing the offer.", fix: "Compress and resize the hero image (WebP/AVIF), preload it, cut render-blocking CSS/JS." },
  cls: { area: "perf", p: "P3", title: "Layout shifts while loading", why: "Buttons jump under the finger; visitors tap the wrong thing.", fix: "Set width/height on images and embeds; reserve space for banners and fonts." },
  tbt: { area: "perf", p: "P2", title: "Long main-thread blocking (TBT)", why: "The page looks ready but does not respond to taps.", fix: "Defer or remove heavy third-party scripts; split large bundles." },
  ttfb: { area: "perf", p: "P2", title: "Slow server response (TTFB)", why: "Every page starts late, before any front-end optimisation can help.", fix: "Add caching/CDN in front of the site; check slow server-side code or hosting." },
  weight: { area: "perf", p: "P2", title: "Heavy page", why: "Large pages load slowly on mobile networks and cost visitors data.", fix: "Compress images, lazy-load below the fold, drop unused fonts and scripts." },
  requests: { area: "perf", p: "P3", title: "Many network requests", why: "Each request adds latency, especially on mobile.", fix: "Bundle, remove unused third-party tags, lazy-load embeds." },
  render_blocking: { area: "perf", p: "P3", title: "Render-blocking scripts in <head>", why: "The browser waits for these scripts before drawing anything.", fix: "Add defer/async or move scripts to the end of <body>." },
  img_dims: { area: "perf", p: "P3", title: "Images without width/height", why: "Causes layout shift as images load.", fix: "Set width and height attributes (or aspect-ratio in CSS)." },
};

const W = { P0: 30, P1: 12, P2: 5, P3: 1 };
const PORDER = ["P0", "P1", "P2", "P3"];

const path = u => { try { const x = new URL(u); return x.pathname + x.search || "/"; } catch { return u; } };
const isContactUrl = u => { try { const x = new URL(u); return /contact|kontakt|get-in-touch|zv.?ia?z|zvyaz|quote|consult|talk|hire|book|demo|schedule|calend|appointment|meeting/i.test(x.hostname + x.pathname); } catch { return false; } };
const isLeadForm = f => f.hasEmail && !f.isSearch && !f.hasPassword;

export function analyze(raw) {
  const findings = new Map();
  const add = (id, o = {}) => {
    const c = C[id] || o.def;
    if (!c) throw new Error("unknown check " + id);
    const p = o.p || c.p;
    const key = id + "|" + (o.key ?? o.selector ?? "") + "|" + p;
    let f = findings.get(key);
    if (!f) {
      f = { id, area: c.area, priority: p, title: o.title || c.title, why: o.why || c.why, fix: o.fix || c.fix, manual: !!(o.manual ?? c.manual),
        where: [], evidence: [] };
      findings.set(key, f);
    }
    if (o.url) f.where.push({ url: o.url, viewport: o.viewport || null, selector: o.selector || null });
    if (o.evidence) for (const e of [].concat(o.evidence)) if (e && !f.evidence.includes(e) && f.evidence.length < 8) f.evidence.push(e);
  };

  const pages = raw.pages || [];
  const home = pages[0];
  const homeUrl = home?.url;
  const ok = pages.filter(p => p.desktop && !p.error && (p.status || 200) < 400);

  // ---------- bugs ----------
  for (const p of pages) {
    if (p.error && !p.desktop) add("load_error", { url: p.url, evidence: p.error });
    if (p.status >= 400) add("http_error", { url: p.url, evidence: `HTTP ${p.status}` });
    const d = p.desktop; if (!d) continue;
    for (const e of p.exceptions || []) add("js_exception", { url: p.url, viewport: "desktop", key: e.slice(0, 80), evidence: e });
    if ((p.consoleErrors || []).length) add("console_error", { url: p.url, viewport: "desktop", evidence: p.consoleErrors.slice(0, 4) });
    for (const r of p.badResponses || []) {
      if (r.document) continue;
      add(r.status >= 500 ? "resource_5xx" : "resource_4xx", { url: p.url, key: r.url, evidence: `${r.status} ${r.url}` });
    }
    for (const r of p.failedRequests || []) add("request_failed", { url: p.url, key: hostOf(r.url), evidence: `${r.error} ${r.url.slice(0, 140)}` });
    for (const m of p.mixed || []) add("mixed_content", { url: p.url, evidence: m });
    for (const i of d.brokenImgs || []) add("broken_image", { url: p.url, selector: i.sel, evidence: i.src });
    if (d.emptySrcImgs) add("empty_img_src", { url: p.url, evidence: `${d.emptySrcImgs} <img> with empty/placeholder src` });
    if ((d.bleed || []).length) add("template_bleed", { url: p.url, evidence: d.bleed });
    for (const f of d.forms || []) {
      if (!f.visible) continue;
      if (!f.hasSubmit && f.fields > 0) add("form_no_submit", { url: p.url, selector: f.sel });
      if (f.unlabeled.length) add("form_unlabeled", { url: p.url, selector: f.sel, evidence: f.unlabeled.slice(0, 5) });
      if (f.placeholderOnly.length) add("form_placeholder_only", { url: p.url, selector: f.sel, evidence: f.placeholderOnly.slice(0, 5) });
    }
  }
  for (const ft of raw.formTargets || []) {
    if (ft.status === 404 || ft.status === 410 || ft.status >= 500) add("form_action_dead", { url: ft.page, selector: ft.form, evidence: `${ft.method.toUpperCase()} ${ft.action} → HTTP ${ft.status}` });
  }
  for (const l of raw.linkCheck || []) {
    if (!(l.status >= 400 || l.status === 0)) continue;
    const id = l.nav ? "broken_link_nav" : "broken_link";
    for (const from of l.from.slice(0, 3)) add(id, { url: from, key: l.url, selector: l.sel || null, evidence: `${l.url} → ${l.status || l.error}` });
  }

  // ---------- mobile ----------
  for (const p of pages) {
    const L = p.layout || {};
    let noVp = false;
    for (const [vp, r] of Object.entries(L)) {
      if (!r || r.error) continue;
      if (!r.viewportMeta) noVp = true;
      if (r.overflowPx > 2) {
        const off = (r.offenders || []).slice(0, 2).map(o => `${o.sel} (left ${o.left}, right ${o.right}, width ${o.width})`);
        if (+vp < 768) add(p.url === homeUrl ? "mobile_overflow_home" : "mobile_overflow", { url: p.url, viewport: vp + "px", selector: r.offenders?.[0]?.sel, key: "", evidence: [`page is ${r.overflowPx}px wider than the ${vp}px screen`, ...off] });
        else add("tablet_overflow", { url: p.url, viewport: vp + "px", evidence: `page is ${r.overflowPx}px wider than the screen` });
      } else if (+vp < 768) {
        for (const o of (r.offenders || []).filter(o => o.right - r.vw > 8 || o.left < -8).slice(0, 3))
          add("offender", { url: p.url, viewport: vp + "px", selector: o.sel, evidence: `left ${o.left} / right ${o.right} on a ${r.vw}px screen${o.text ? ` «${o.text}»` : ""}` });
      }
      if (vp === "390" && r.tapCount) add("small_tap", { url: p.url, viewport: "390px", key: "", evidence: `${r.tapCount} targets, e.g. ` + r.taps.slice(0, 3).map(t => `${t.sel} ${t.w}×${t.h}`).join(", ") });
      if (vp === "390" && r.tinyCount) add("tiny_text", { url: p.url, viewport: "390px", key: "", evidence: `${r.tinyCount} elements, e.g. ` + r.tiny.slice(0, 3).map(t => `${t.sel} ${t.fs}px`).join(", ") });
    }
    if (noVp || (p.desktop && !p.desktop.viewportMeta)) add("no_viewport", { url: p.url });
  }

  // ---------- conversion ----------
  const conv = conversionPath(raw, ok);
  if (home?.desktop) {
    if (conv.clicks == null) add("no_contact_path", { url: homeUrl, manual: raw.meta?.pagesLimited, evidence: raw.meta?.pagesLimited ? "not found among the audited pages; the page limit was reached, confirm by hand" : "no contact page, booking link, mailto/tel or lead form reachable" });
    else if (conv.clicks === 2) add("contact_path_2", { url: homeUrl, evidence: conv.route });
    const dCta = home.desktop.ctas.filter(c => c.aboveFold);
    if (!dCta.length) add("no_cta_fold_desktop", { url: homeUrl, viewport: "1440px" });
    else if (!dCta.some(c => c.styled)) add("cta_plain_link", { url: homeUrl, viewport: "1440px", evidence: dCta.slice(0, 3).map(c => `«${c.text}» ${c.sel}`) });
    const m = home.layout?.["390"];
    if (m && !m.error && !(m.ctas || []).some(c => c.aboveFold)) add("no_cta_fold_mobile", { url: homeUrl, viewport: "390px" });
  }
  for (const p of ok.slice(1)) {
    if (!p.desktop.ctas.length) add("no_cta_on_page", { url: p.url, key: "" });
    else if (!p.desktop.ctas.some(c => c.aboveFold)) add("cta_fold_missing_pages", { url: p.url, viewport: "1440px", key: "" });
  }
  const all = ok.map(p => p.desktop);
  const anyEmail = all.some(d => d.contact.mailto.length || d.contact.emailsInText.length);
  const anyPhone = all.some(d => d.contact.tel.length || d.contact.phonesInText.length);
  const anyBooking = all.some(d => d.contact.booking.length);
  const anyLeadForm = all.some(d => d.forms.some(isLeadForm));
  const anyIframe = all.some(d => d.iframes.length);
  if (ok.length) {
    if (!anyEmail && !anyPhone) add("no_contact_info", { url: homeUrl });
    if (!anyBooking) add("no_booking", { url: homeUrl });
    if (!anyLeadForm && !anyBooking) add("no_lead_form", { url: homeUrl, evidence: anyIframe ? "the site embeds iframes; a third-party form may be inside one" : null });
    const t = trustSummary(all);
    if (!t.testimonials) add("trust_testimonials", { url: homeUrl });
    if (!t.cases) add("trust_cases", { url: homeUrl });
    if (t.logos < 3) add("trust_logos", { url: homeUrl, evidence: `${t.logos} logo-like images found` });
    if (!t.numbers) add("trust_numbers", { url: homeUrl });
  }

  // ---------- SEO ----------
  const rb = raw.site?.robots;
  if (rb?.status === 200 && rb.blocksAll) add("robots_block_all", { url: rb.url });
  if (rb && rb.status !== 200) add("no_robots", { url: rb.url, evidence: `HTTP ${rb.status}` });
  if (raw.site?.sitemap && !raw.site.sitemap.count) add("no_sitemap", { url: raw.site.sitemap.url, evidence: raw.site.sitemap.note });
  const titles = new Map(), descs = new Map();
  for (const p of ok) {
    const d = p.desktop;
    const noindex = /noindex/i.test(d.robots || "") || /noindex/i.test(p.xRobots || "");
    if (noindex) add(p.url === homeUrl ? "noindex_home" : "noindex", { url: p.url, evidence: d.robots || p.xRobots });
    if (!d.title.trim()) add("no_title", { url: p.url });
    else {
      if (d.title.length < 15 || d.title.length > 65) add("title_length", { url: p.url, key: "", evidence: `${d.title.length} chars: «${d.title.slice(0, 80)}»` });
      titles.set(d.title, [...(titles.get(d.title) || []), p.url]);
    }
    if (!d.description) add("no_description", { url: p.url, key: "" });
    else {
      if (d.description.length < 50 || d.description.length > 165) add("description_length", { url: p.url, key: "", evidence: `${d.description.length} chars` });
      descs.set(d.description, [...(descs.get(d.description) || []), p.url]);
    }
    if (!d.h1.length) add("no_h1", { url: p.url, key: "" });
    else if (d.h1.length > 1) add("multi_h1", { url: p.url, key: "", evidence: d.h1.slice(0, 3).map(h => `«${h.slice(0, 60)}»`) });
    if (!d.canonical) add("no_canonical", { url: p.url, key: "" });
    else if (hostOf(d.canonical) !== hostOf(p.url) && hostOf(d.canonical).replace(/^www\./, "") !== hostOf(p.url).replace(/^www\./, "")) add("canonical_offsite", { url: p.url, evidence: d.canonical });
    if (!d.og.title || !d.og.image) add("no_og", { url: p.url, key: "", evidence: ["og:title", "og:description", "og:image"].filter(k => !d.og[k.split(":")[1]]).join(", ") + " missing" });
  }
  for (const [t, urls] of titles) if (urls.length > 1) for (const u of urls) add("dup_title", { url: u, key: t, evidence: `«${t.slice(0, 80)}»` });
  for (const [t, urls] of descs) if (urls.length > 1) for (const u of urls) add("dup_description", { url: u, key: t.slice(0, 60) });

  // ---------- performance ----------
  const lh = raw.lighthouse;
  if (lh && lh.score != null) {
    const s = lh.score;
    if (s < 90) add("lh_score", { url: lh.url, p: s < 50 ? "P1" : s < 75 ? "P2" : "P3", evidence: `Lighthouse performance ${s}/100 (mobile, throttled)` });
    const m = lh.metrics || {};
    if (m.lcp > 2500) add("lcp", { url: lh.url, p: m.lcp > 4000 ? "P1" : "P2", key: "lh", evidence: `LCP ${(m.lcp / 1000).toFixed(1)} s (Lighthouse mobile)` });
    if (m.cls > 0.1) add("cls", { url: lh.url, p: m.cls > 0.25 ? "P2" : "P3", key: "lh", evidence: `CLS ${m.cls.toFixed(2)}` });
    if (m.tbt > 200) add("tbt", { url: lh.url, p: m.tbt > 600 ? "P2" : "P3", evidence: `TBT ${Math.round(m.tbt)} ms` });
  }
  for (const p of ok) {
    const f = p.desktop.perf;
    if (!lh || lh.score == null || p.url !== lh.url) {
      if (f.lcp > 2500) add("lcp", { url: p.url, p: f.lcp > 4000 ? "P1" : "P2", key: "", evidence: `LCP ${(f.lcp / 1000).toFixed(1)} s (desktop, no throttling: real phones will be slower)` });
      if (f.cls > 0.1) add("cls", { url: p.url, p: f.cls > 0.25 ? "P2" : "P3", key: "", evidence: `CLS ${f.cls}` });
    }
    if (f.ttfb > 1800) add("ttfb", { url: p.url, key: "", evidence: `TTFB ${f.ttfb} ms` });
    const mb = (p.weightBytes || 0) / 1048576;
    if (mb > 3) add("weight", { url: p.url, p: mb > 5 ? "P1" : "P2", key: "", evidence: `${mb.toFixed(1)} MB transferred` });
    if ((p.requests || 0) > 120) add("requests", { url: p.url, key: "", evidence: `${p.requests} requests` });
    if (f.headBlocking > 3) add("render_blocking", { url: p.url, key: "", evidence: `${f.headBlocking} blocking <script> in <head>` });
    if (f.imgsNoDims >= 6) add("img_dims", { url: p.url, key: "", evidence: `${f.imgsNoDims} of ${f.imgs} images` });
  }

  // ---------- accessibility (axe) ----------
  const impactP = { critical: "P1", serious: "P2", moderate: "P3", minor: "P3" };
  for (const p of ok) {
    for (const v of p.axe?.violations || []) {
      add("axe", {
        def: { area: "a11y", p: impactP[v.impact] || "P3", title: v.help, why: AXE_WHY[v.impact] || AXE_WHY.moderate, fix: `Fix the listed elements (rule: ${v.help.replace(/\.$/, '')}). How: ${v.helpUrl.replace(/\?application=axeAPI$/, '')}` },
        p: impactP[v.impact] || "P3", key: v.id, url: p.url, selector: null,
        title: `${v.help} (${v.id}, ${v.impact})`,
        evidence: [`${v.nodes} element(s) on ${path(p.url)}: ${v.targets.slice(0, 3).join(" · ")}`],
      });
    }
  }

  const list = [...findings.values()].sort((a, b) => PORDER.indexOf(a.priority) - PORDER.indexOf(b.priority) || Object.keys(AREAS).indexOf(a.area) - Object.keys(AREAS).indexOf(b.area) || b.where.length - a.where.length);
  list.forEach((f, i) => { f.n = i + 1; f.pages = [...new Set(f.where.map(w => w.url))].length; });

  // ---------- scores ----------
  const scores = {};
  for (const a of Object.keys(AREAS)) {
    const skipped = raw.skipped?.[a];
    if (skipped && a !== "perf") { scores[a] = { score: null, skipped }; continue; }
    const fs = list.filter(f => f.area === a);
    const ded = fs.reduce((s, f) => s + W[f.priority], 0);
    const c = { P0: 0, P1: 0, P2: 0, P3: 0 }; fs.forEach(f => c[f.priority]++);
    let score = Math.max(0, 100 - ded);
    if (a === "perf" && lh?.score != null) score = lh.score;
    if (a === "perf" && !ok.length) score = null;
    scores[a] = { score, ...c, ...(a === "perf" ? { source: lh?.score != null ? "lighthouse" : "browser timing" } : {}), ...(skipped ? { note: skipped } : {}) };
  }
  const vals = Object.values(scores).map(s => s.score).filter(v => v != null);
  const overall = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  const counts = { P0: 0, P1: 0, P2: 0, P3: 0 }; list.forEach(f => counts[f.priority]++);

  return { findings: list, scores, overall, counts, snapshot: snapshot(raw, ok, conv, { anyEmail, anyPhone, anyBooking, anyLeadForm }) };
}

const AXE_WHY = {
  critical: "Blocks some visitors (screen reader, keyboard, low vision) from using the page at all; in many markets it is also a legal risk.",
  serious: "Makes the page hard to use for part of the visitors; often also hurts readability for everyone (e.g. low contrast).",
  moderate: "Friction for assistive-technology users.",
};

function hostOf(u) { try { return new URL(u).hostname; } catch { return ""; } }

function trustSummary(all) {
  return {
    testimonials: all.some(d => d.trust.testimonials),
    cases: all.some(d => d.trust.cases),
    logos: Math.max(0, ...all.map(d => d.trust.logos)),
    numbers: all.reduce((s, d) => s + d.trust.numbers, 0),
    badges: all.some(d => d.trust.badges),
  };
}

// Fewest clicks from the homepage to a contact point (contact page, booking link,
// mailto/tel, or a page with a lead form). Uses only links seen on audited pages.
export function conversionPath(raw, ok) {
  const byUrl = new Map(ok.map(p => [norm(p.url), p]));
  const home = ok[0];
  if (!home) return { clicks: null };
  const depth = new Map([[norm(home.url), 0]]);
  const queue = [home];
  while (queue.length) {
    const p = queue.shift();
    const d = depth.get(norm(p.url));
    for (const l of p.desktop.links) {
      const k = norm(l.href);
      if (byUrl.has(k) && !depth.has(k)) { depth.set(k, d + 1); queue.push(byUrl.get(k)); }
    }
  }
  let best = null, route = "";
  for (const p of ok) {
    const d = depth.get(norm(p.url));
    if (d == null) continue;
    if (p.desktop.forms.some(isLeadForm) && (best == null || d < best)) { best = d; route = d ? `lead form on ${path(p.url)} (${d} click${d > 1 ? "s" : ""})` : "lead form on the homepage"; }
    const contactLink = p.desktop.links.find(l => /^(mailto:|tel:)/i.test(l.raw) || isContactUrl(l.href));
    if (contactLink && (best == null || d + 1 < best)) { best = d + 1; route = `${d ? path(p.url) + " → " : "homepage → "}«${contactLink.text || contactLink.raw}» (${contactLink.raw.slice(0, 80)})`; }
  }
  return { clicks: best, route };
}

function norm(u) { try { const x = new URL(u); x.hash = ""; x.search = ""; return (x.origin + x.pathname).replace(/\/$/, ""); } catch { return u; } }

function snapshot(raw, ok, conv, c) {
  const home = ok[0];
  const lh = raw.lighthouse;
  const L = home?.layout || {};
  const firstCta = home?.desktop?.ctas.find(x => x.aboveFold);
  const mobileCta = (L["390"]?.ctas || []).find(x => x.aboveFold);
  const sum = (arr, f) => arr.reduce((s, x) => s + (f(x) || 0), 0);
  const hosts = new Set(); ok.forEach(p => (p.thirdPartyHosts || []).forEach(h => hosts.add(h)));
  return {
    date: raw.meta?.startedAt?.slice(0, 10),
    pagesAudited: (raw.pages || []).length,
    urlsInSitemap: raw.site?.sitemap?.count ?? null,
    internalLinksChecked: (raw.linkCheck || []).length,
    brokenInternalLinks: (raw.linkCheck || []).filter(l => l.status >= 400 || l.status === 0).length,
    homeTitle: home?.desktop?.title || null,
    homeH1: home?.desktop?.h1?.[0] || null,
    homeCtaDesktop: firstCta ? `«${firstCta.text}»` : "none in first screen",
    homeCtaMobile: mobileCta ? `«${mobileCta.text}»` : "none in first screen",
    contactClicks: conv.clicks,
    contactRoute: conv.route || null,
    email: c.anyEmail, phone: c.anyPhone, booking: c.anyBooking, leadForm: c.anyLeadForm,
    lighthouseMobile: lh?.score ?? null,
    lcpMs: lh?.metrics?.lcp ? Math.round(lh.metrics.lcp) : home?.desktop?.perf?.lcp ?? null,
    lcpSource: lh?.metrics?.lcp ? "Lighthouse mobile" : "desktop browser timing",
    homeWeightKB: home ? Math.round((home.weightBytes || 0) / 1024) : null,
    homeRequests: home?.requests ?? null,
    pagesWithMobileScroll: (raw.pages || []).filter(p => ["360", "390"].some(v => p.layout?.[v]?.overflowPx > 2)).length,
    axeViolations: sum(ok, p => (p.axe?.violations || []).reduce((s, v) => s + v.nodes, 0)),
    consoleErrors: sum(ok, p => (p.consoleErrors || []).length + (p.exceptions || []).length),
    forms: sum(ok, p => p.desktop.forms.filter(f => f.visible).length),
    thirdPartyScriptHosts: [...hosts].sort(),
  };
}
