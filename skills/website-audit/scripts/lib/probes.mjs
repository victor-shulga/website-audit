// JavaScript that runs INSIDE the audited page. Every probe is read-only:
// it measures and returns plain JSON, it never clicks, types or submits.

// Shared helpers, prepended to every probe.
const HELPERS = String.raw`
  const __vis = el => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const __part = el => {
    let s = el.tagName.toLowerCase();
    if (el.id) return s + '#' + el.id;
    const cls = (el.className && typeof el.className === 'string') ? el.className.trim().split(/\s+/).filter(c => !/[:\[\]\/]/.test(c)).slice(0, 2).join('.') : '';
    if (cls) return s + '.' + cls;
    const p = el.parentElement;
    if (p) { const same = [...p.children].filter(c => c.tagName === el.tagName); if (same.length > 1) s += ':nth-of-type(' + (same.indexOf(el) + 1) + ')'; }
    return s;
  };
  const __sel = el => {
    if (!el || !el.tagName) return '';
    const parts = [];
    for (let n = el, i = 0; n && n !== document.body && n !== document.documentElement && i < 3; n = n.parentElement, i++) {
      parts.unshift(__part(n));
      if (n.id) break;
    }
    return parts.join(' > ');
  };
  const __txt = el => ((el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('title') || '') + '').trim().replace(/\s+/g, ' ').slice(0, 70);
  const CTA_RE = /\b(contact|get in touch|book|schedule|call|demo|quote|estimate|get started|start now|start a project|hire|talk|consult|let'?s (talk|chat|go)|request|free (audit|assessment|trial|consultation)|sign ?up|apply|enquir|inquir|work with)|зв.?яж|зв.?яз|консульт|запис|замов|обговор|напиш|зателеф|демо|прорахун|розрах|заявк|почати|отримати|співпрац|заброн|бронюв|дзвін|зустріч|залиш|безкоштовн|связ|заказ|обсуд|получ|забронир|звонок|позвон|встреч/i;
  const BOOKING_RE = /calend|schedul|appointment|meeting|\/book(ing)?(\/|$|\?)|\/demo(\/|$|\?)/i;
  const __isBooking = href => { try { const u = new URL(href, location.href); if (/facebook|instagram|linkedin|twitter|x\.com|youtube/.test(u.hostname)) return false; return BOOKING_RE.test(u.hostname + u.pathname); } catch { return false; } };
  const __styled = el => {
    const cs = getComputedStyle(el);
    const bg = cs.backgroundColor;
    const hasBg = bg && bg !== 'transparent' && !/rgba\(\d+, \d+, \d+, 0\)/.test(bg);
    const hasBorder = parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none';
    const r = el.getBoundingClientRect();
    return (hasBg || hasBorder) && r.height >= 28;
  };
  // CTA candidates in the current viewport
  const __ctas = () => {
    const vh = window.innerHeight, vw = window.innerWidth;
    const out = [];
    for (const el of document.querySelectorAll('a[href], button, [role=button], input[type=submit]')) {
      if (!__vis(el)) continue;
      const t = __txt(el);
      const href = el.getAttribute('href') || '';
      const isContactHref = /^(mailto:|tel:)/i.test(href) || __isBooking(el.href || '') || /contact|kontakt|get-in-touch|zv.?yaz|quote|consult/i.test(href);
      if (!CTA_RE.test(t) && !isContactHref) continue;
      if (/^(mailto:|tel:)/i.test(href) && !CTA_RE.test(t)) continue; // bare footer email is contact info, not a CTA
      const r = el.getBoundingClientRect();
      out.push({ text: t, href: el.href || '', sel: __sel(el), aboveFold: r.top < vh && r.bottom > 0 && r.left < vw && r.right > 0,
        styled: __styled(el), inNav: !!el.closest('nav, header'), top: Math.round(r.top) });
    }
    return out;
  };
`;

// Installed before navigation: collects LCP and CLS.
export const PERF_INIT = String.raw`
  window.__wa = { lcp: 0, cls: 0 };
  try {
    new PerformanceObserver(l => { for (const e of l.getEntries()) window.__wa.lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__wa.cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
  } catch (e) {}
`;

// Scroll through the page so lazy images and reveal-on-scroll blocks load, then back to top.
export const SCROLL_THROUGH = String.raw`(async () => {
  const h = Math.min(document.documentElement.scrollHeight, 30000);
  for (let y = 0; y < h; y += Math.max(400, window.innerHeight)) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 120)); }
  document.querySelectorAll('.rv,.reveal,[data-reveal],[data-aos]').forEach(e => { e.style.opacity = 1; e.style.transform = 'none'; });
  window.scrollTo(0, 0);
  await new Promise(r => setTimeout(r, 400));
  return h;
})()`;

// Desktop probe: SEO, links, forms, contact, trust, CTAs, broken images, perf timing.
export const PAGE_PROBE = String.raw`(() => {
  ${HELPERS}
  const q = s => document.querySelector(s);
  const meta = n => (q('meta[name="' + n + '"]') || q('meta[property="' + n + '"]'))?.getAttribute('content') || null;
  const text = (document.body?.innerText || '');
  // links
  const links = [];
  for (const a of document.querySelectorAll('a[href]')) {
    const raw = a.getAttribute('href') || '';
    links.push({ href: a.href, raw, text: __txt(a), nav: !!a.closest('nav, header'), footer: !!a.closest('footer'), sel: __sel(a) });
  }
  // forms
  const labelFor = id => id && document.querySelector('label[for="' + CSS.escape(id) + '"]');
  const forms = [...document.querySelectorAll('form')].map(f => {
    const fields = [...f.querySelectorAll('input, select, textarea')].filter(i => !['hidden', 'submit', 'button', 'reset', 'image'].includes((i.type || '').toLowerCase()));
    const unlabeled = [], placeholderOnly = [];
    for (const i of fields) {
      const named = labelFor(i.id) || i.closest('label') || i.getAttribute('aria-label') || i.getAttribute('aria-labelledby') || i.getAttribute('title');
      if (!named) (i.getAttribute('placeholder') ? placeholderOnly : unlabeled).push(__sel(i) + (i.name ? '[name=' + i.name + ']' : ''));
    }
    const submit = f.querySelector('button:not([type]), button[type=submit], input[type=submit], input[type=image]');
    return {
      sel: __sel(f), visible: __vis(f), actionAttr: f.getAttribute('action'), action: f.action, method: (f.getAttribute('method') || 'get').toLowerCase(),
      fields: fields.length, hasEmail: fields.some(i => i.type === 'email' || /mail/i.test(i.name || '')),
      hasPassword: fields.some(i => i.type === 'password'), isSearch: fields.some(i => i.type === 'search') || f.getAttribute('role') === 'search',
      hasSubmit: !!submit, submitText: submit ? __txt(submit) : '', unlabeled, placeholderOnly,
    };
  });
  const iframes = [...document.querySelectorAll('iframe[src]')].map(f => f.src).filter(Boolean);
  // contact info
  const mailto = links.filter(l => /^mailto:/i.test(l.raw)).map(l => l.raw.replace(/^mailto:/i, '').split('?')[0]);
  const tel = links.filter(l => /^tel:/i.test(l.raw)).map(l => l.raw.replace(/^tel:/i, ''));
  const emailsInText = [...new Set((text.match(/[\w.+-]+@[\w-]+\.[\w.-]{2,}/g) || []).slice(0, 5))];
  const phonesInText = [...new Set((text.match(/\+\d[\d\s().-]{8,16}\d/g) || []).slice(0, 5))];
  const booking = [...new Set([...links.map(l => l.href).filter(__isBooking), ...iframes.filter(__isBooking)])].slice(0, 5);
  // trust markers
  const lower = text.toLowerCase();
  const imgs = [...document.querySelectorAll('img')];
  const logoImgs = imgs.filter(i => !i.closest('header, nav') && /logo|client|partner|brand|customer/i.test((i.alt || '') + ' ' + (i.className || '') + ' ' + (i.src || '') + ' ' + (i.parentElement?.className || '')));
  const trust = {
    testimonials: /testimonial|what (our )?(clients|customers) say|client reviews|reviews|відгук|що кажуть|кажуть клієнти/.test(lower) || document.querySelectorAll('blockquote, [class*=testimonial], [class*=review]').length > 0,
    cases: links.some(l => /case|portfolio|\/work(\/|$)|\/projects?(\/|$)|kejs|keys/i.test(l.href) && !/showcase/i.test(l.href)) || /case stud|кейс/.test(lower),
    logos: logoImgs.length,
    numbers: (text.match(/\b\d[\d,.]*\s?\+|\b\d+(?:[.,]\d+)?\s?%|\b\d+\s?(?:years|clients|projects|countries|engineers|experts|people|companies|років|роки|клієнт|проєкт|проект|країн|інженер|експерт)/gi) || []).length,
    badges: /rated|rating|★|award|certified|\biso \d|нагород|сертиф|рейтинг/.test(lower),
  };
  // broken images (after the scroll-through)
  const brokenImgs = imgs.filter(i => (i.currentSrc || i.getAttribute('src')) && i.complete && i.naturalWidth === 0 && __vis(i))
    .map(i => ({ src: (i.currentSrc || i.src || '').slice(0, 200), sel: __sel(i) })).slice(0, 20);
  const emptySrcImgs = imgs.filter(i => { const s = i.getAttribute('src'); return s !== null && (s.trim() === '' || /^(undefined|null)$/.test(s.trim()) || /\{\{|\$\{/.test(s)); }).length;
  // template bleed
  const bleed = (text.match(/\{\{[^}]{0,40}\}\}|\[object Object\]|\{%[^%]{0,40}%\}/g) || []).slice(0, 5);
  // perf timing
  const nav = performance.getEntriesByType('navigation')[0] || {};
  const fcp = (performance.getEntriesByName('first-contentful-paint')[0] || {}).startTime || null;
  const res = performance.getEntriesByType('resource');
  const headBlocking = [...document.querySelectorAll('head script[src]:not([async]):not([defer]):not([type=module])')].length;
  const imgsNoDims = imgs.filter(i => !i.getAttribute('width') || !i.getAttribute('height')).length;
  return {
    finalUrl: location.href,
    title: document.title || '', description: meta('description'),
    canonical: q('link[rel="canonical"]')?.href || null,
    robots: meta('robots'), lang: document.documentElement.getAttribute('lang'),
    og: { title: meta('og:title'), description: meta('og:description'), image: meta('og:image') },
    h1: [...document.querySelectorAll('h1')].filter(__vis).map(h => h.innerText.trim().replace(/\s+/g, ' ').slice(0, 120)),
    viewportMeta: !!q('meta[name=viewport]'),
    jsonLd: document.querySelectorAll('script[type="application/ld+json"]').length,
    words: (text.match(/\S+/g) || []).length,
    links, forms, iframes,
    contact: { mailto: [...new Set(mailto)], tel: [...new Set(tel)], emailsInText, phonesInText, booking },
    trust, ctas: __ctas(), brokenImgs, emptySrcImgs, bleed,
    perf: { ttfb: nav.responseStart ? Math.round(nav.responseStart) : null, dcl: nav.domContentLoadedEventEnd ? Math.round(nav.domContentLoadedEventEnd) : null,
      load: nav.loadEventEnd ? Math.round(nav.loadEventEnd) : null, fcp: fcp ? Math.round(fcp) : null,
      lcp: window.__wa ? Math.round(window.__wa.lcp) || null : null, cls: window.__wa ? +window.__wa.cls.toFixed(3) : null,
      resources: res.length, headBlocking, imgs: imgs.length, imgsNoDims },
  };
})()`;

// Mobile/tablet layout probe (port of the 360/390/768 mobile QA) + CTA above the fold.
export const LAYOUT_PROBE = String.raw`(() => {
  ${HELPERS}
  const vw = document.documentElement.clientWidth;
  const sw = Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0);
  const clipped = el => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX;
      if (ox === 'hidden' || ox === 'auto' || ox === 'scroll' || ox === 'clip') return true;
    }
    return false;
  };
  const offenders = [];
  for (const el of document.body.querySelectorAll('*')) {
    if (!__vis(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.right > vw + 2 || r.left < -2) {
      if (clipped(el)) continue;
      if (getComputedStyle(el).position === 'fixed' && r.left >= vw) continue; // off-canvas menu
      if (r.right <= 0) continue; // parked off-screen on purpose (skip links, sr-only)
      if (offenders.some(o => o.el.contains(el))) continue;
      offenders.push({ el, sel: __sel(el), right: Math.round(r.right), left: Math.round(r.left), width: Math.round(r.width), text: __txt(el).slice(0, 50) });
    }
  }
  const tiny = []; const seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const n = walker.currentNode, el = n.parentElement;
    if (!el || seen.has(el) || !n.textContent.trim()) continue;
    seen.add(el);
    if (!__vis(el)) continue;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs < 12) tiny.push({ sel: __sel(el), fs, text: n.textContent.trim().slice(0, 40) });
  }
  const taps = [];
  for (const el of document.querySelectorAll('a[href], button, [role=button], input, select, textarea')) {
    if (!__vis(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 32 || r.height < 32) {
      const inline = getComputedStyle(el).display === 'inline' && el.closest('p, li, td');
      if (!inline) taps.push({ sel: __sel(el), w: Math.round(r.width), h: Math.round(r.height), text: __txt(el).slice(0, 30) });
    }
  }
  return {
    viewportMeta: !!document.querySelector('meta[name=viewport]'), vw, sw, overflowPx: sw - vw,
    offenders: offenders.slice(0, 10).map(({ el, ...o }) => o), offenderCount: offenders.length,
    tiny: tiny.slice(0, 6), tinyCount: tiny.length, taps: taps.slice(0, 6), tapCount: taps.length,
    ctas: __ctas(),
  };
})()`;
