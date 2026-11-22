#!/usr/bin/env node
'use strict';
// T2 Layout und Positionierung:
//  - verdeckte/überlagerte Elemente (Buttons, Links, Felder, Texte unter anderen Elementen)
//  - Dropdowns zu schmal für ihre Optionen
//  - abgeschnittene Texte und Tabellen (ohne Scrollmöglichkeit)
//  - Sidebar: Ein-/Ausklappen, Größe ändern per Ziehen, Verschieben – und ob der Inhalt sauber nachzieht
//
//   node layout.cjs --url http://localhost:5173 [--sizes 1280x800,375x667] [--pages /a,/b]
//                   [--no-sidebar] [--browser webkit] [--out dir] [--storage-state …] [--cdp …]

const path = require('path');
const { parseArgs, ensureDir, defaultOutDir, openTarget, writeJson, parseViewport } = require('./_common.cjs');

// ---------- Prüfungen im Browser ----------
function pageChecks() {
  const describe = (el) => {
    if (!el) return '?';
    let s = el.tagName.toLowerCase();
    if (el.id) s += `#${el.id}`;
    else if (el.classList.length) s += '.' + [...el.classList].slice(0, 2).join('.');
    const t = (el.getAttribute('aria-label') || (el.tagName === 'SELECT' ? (el.labels && el.labels[0] ? [...el.labels[0].childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' ') : el.name) : el.innerText || el.value) || '').replace(/\s+/g, ' ').trim().slice(0, 35);
    return t ? `${s} "${t}"` : s;
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
  };
  const related = (a, b) => a === b || a.contains(b) || b.contains(a) || (a.labels && [...a.labels].some((l) => l.contains(b)));
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;

  // 1. Verdeckte Elemente: Mittelpunkt + Ecken mit elementFromPoint prüfen
  const covered = [];
  const coverCount = new Map();
  const targets = [...document.querySelectorAll('a[href],button,input:not([type=hidden]),select,textarea,[role=button],[role=link],[role=tab],h1,h2,h3,label,th,td,p,li')]
    .filter(visible)
    .filter((el) => {
      const r = el.getBoundingClientRect();
      return r.top >= 0 && r.left >= 0 && r.bottom <= vh && r.right <= vw; // nur was im Fenster liegt
    });
  // Bei Textelementen zählt die Fläche des Textes, nicht die (oft fensterbreite) Blockbox
  const textRect = (el) => {
    if (['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(el.tagName) || el.getAttribute('role') === 'button') return el.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(el);
    const rr = range.getBoundingClientRect();
    return rr.width > 2 && rr.height > 2 ? rr : el.getBoundingClientRect();
  };
  for (const el of targets) {
    const r = textRect(el);
    // Raster aus 5×3 Messpunkten (leicht nach innen versetzt): Anteil der verdeckten Fläche schätzen
    const pts = [];
    for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++) pts.push([r.left + 2 + ((r.width - 4) * (i + 0.5)) / 5, r.top + 2 + ((r.height - 4) * (j + 0.5)) / 3]);
    let hits = 0;
    let by = null;
    for (const [x, y] of pts) {
      const top = document.elementFromPoint(x, y);
      if (top && !related(el, top) && !top.contains(el)) {
        hits++;
        by = by || top;
      }
    }
    const share = hits / pts.length;
    if (share >= 0.15) {
      // Überdeckendes Element auf sinnvolle Ebene hochziehen (positionierter Vorfahr)
      let c = by;
      while (c && c.parentElement && getComputedStyle(c).position === 'static') c = c.parentElement;
      covered.push({ el: describe(el), by: describe(c), percent: Math.round(share * 100) });
      coverCount.set(c, (coverCount.get(c) || 0) + 1);
    }
  }
  // Ein Element verdeckt sehr viel → wahrscheinlich offenes Modal/Overlay
  const overlays = [...coverCount.entries()].filter(([, n]) => n > 15).map(([c, n]) => `${describe(c)} verdeckt ${n} Elemente (offenes Modal/Overlay?)`);

  // 2. Dropdowns zu schmal
  const canvas = document.createElement('canvas').getContext('2d');
  const narrowSelects = [];
  for (const s of document.querySelectorAll('select')) {
    if (!visible(s)) continue;
    const cs = getComputedStyle(s);
    canvas.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const avail = s.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 20; // ~20px Pfeil
    const sel = s.options[s.selectedIndex];
    let widest = { w: 0, t: '' };
    for (const o of s.options) {
      const w = canvas.measureText(o.text).width;
      if (w > widest.w) widest = { w, t: o.text };
    }
    const selW = sel ? canvas.measureText(sel.text).width : 0;
    if (widest.w > avail + 2) {
      narrowSelects.push({
        el: describe(s),
        width: Math.round(s.clientWidth),
        needed: Math.round(widest.w + 20 + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight)),
        longest: widest.t.slice(0, 60),
        selectedCut: selW > avail + 2,
      });
    }
  }
  // Eigene Dropdowns (role=listbox/option, offene Menüs): Optionen abgeschnitten?
  for (const o of document.querySelectorAll('[role=option],[role=menuitem]')) {
    if (visible(o) && o.scrollWidth > o.clientWidth + 2) narrowSelects.push({ el: describe(o), width: o.clientWidth, needed: o.scrollWidth, longest: o.innerText.slice(0, 60), custom: true });
  }

  // 3. Abgeschnittene Texte
  const clipped = [];
  for (const el of document.body.querySelectorAll('*')) {
    if (el.children.length > 0 || !visible(el)) continue;
    const text = (el.innerText || '').trim();
    if (!text) continue;
    const cs = getComputedStyle(el);
    const hidesX = ['hidden', 'clip'].includes(cs.overflowX) || cs.textOverflow === 'ellipsis';
    const hidesY = ['hidden', 'clip'].includes(cs.overflowY);
    if ((hidesX && el.scrollWidth > el.clientWidth + 1) || (hidesY && el.scrollHeight > el.clientHeight + 2)) {
      clipped.push({ el: describe(el), how: cs.textOverflow === 'ellipsis' ? 'mit …' : 'hart abgeschnitten', title: el.title ? 'Tooltip vorhanden' : 'kein Tooltip' });
    }
  }
  // Text in Buttons/Feldern, der über den Rand läuft (ohne overflow hidden)
  for (const el of document.querySelectorAll('button,[role=button],label,th,td')) {
    if (!visible(el)) continue;
    if (el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflowX === 'visible' && getComputedStyle(el).whiteSpace !== 'normal')
      clipped.push({ el: describe(el), how: 'Text ragt über den Rand', title: '' });
  }

  // 4. Tabellen abgeschnitten (breiter als sichtbarer Bereich, aber kein Scrollen möglich)
  const tables = [];
  for (const t of document.querySelectorAll('table,[role=table],[role=grid]')) {
    if (!visible(t)) continue;
    const tr = t.getBoundingClientRect();
    let p = t.parentElement;
    let scrollable = false;
    let clipper = null;
    while (p && p !== document.documentElement) {
      const cs = getComputedStyle(p);
      if (['auto', 'scroll'].includes(cs.overflowX)) { scrollable = true; break; }
      if (['hidden', 'clip'].includes(cs.overflowX)) { clipper = p; break; }
      p = p.parentElement;
    }
    const pageScroll = document.documentElement.scrollWidth > vw + 1;
    if (clipper && t.scrollWidth > clipper.clientWidth + 1) tables.push({ el: describe(t), problem: `abgeschnitten durch ${describe(clipper)} (overflow hidden, kein Scrollen)`, width: Math.round(tr.width), visible: clipper.clientWidth });
    else if (!scrollable && tr.right > vw + 1) tables.push({ el: describe(t), problem: pageScroll ? 'ragt aus dem Fenster, nur ganze Seite scrollt horizontal' : 'ragt aus dem Fenster', width: Math.round(tr.width), visible: vw });
  }

  return {
    viewport: `${vw}x${vh}`,
    horizontalOverflowPx: Math.max(0, document.documentElement.scrollWidth - vw),
    covered: covered.slice(0, 25),
    coveredTotal: covered.length,
    overlays,
    narrowSelects,
    clipped: clipped.slice(0, 25),
    tables,
  };
}

// ---------- Sidebar ----------
async function findSidebar(page) {
  return page.evaluate(() => {
    const vw = innerWidth;
    const vh = innerHeight;
    const cands = [...document.querySelectorAll('aside,nav,[role=navigation],[class*=sidebar i],[id*=sidebar i],[class*=sidenav i],[class*=drawer i],[class*=side-bar i]')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.height > vh * 0.5 && r.width > 30 && r.width < vw * 0.45 && (r.left < 5 || r.right > vw - 5);
      })
      // äußerstes Element nehmen
      .filter((el, _, arr) => !arr.some((o) => o !== el && o.contains(el)));
    if (!cands.length) return null;
    const sb = cands[0];
    sb.setAttribute('data-uitest-sidebar', '1');
    const side = sb.getBoundingClientRect().left < 5 ? 'links' : 'rechts';
    // Umschalt-Button suchen
    const btnRe = /men(ü|u)|einklapp|ausklapp|sidebar|seitenleiste|navigation|toggle|collapse|expand|☰|≡|«|»|‹|›/i;
    const buttons = [...document.querySelectorAll('button,[role=button]')].filter((b) => {
      const r = b.getBoundingClientRect();
      if (!r.width) return false;
      const label = `${b.getAttribute('aria-label') || ''} ${b.title || ''} ${b.innerText || ''} ${b.className || ''}`;
      const ctrl = b.getAttribute('aria-controls');
      return (ctrl && document.getElementById(ctrl) && (document.getElementById(ctrl) === sb || sb.contains(document.getElementById(ctrl)))) || btnRe.test(label);
    });
    const toggle = buttons.find((b) => sb.contains(b)) || buttons[0];
    if (toggle) toggle.setAttribute('data-uitest-toggle', '1');
    // Ziehgriff (Größe ändern) und Verschiebegriff suchen
    let resizer = null;
    let mover = null;
    for (const el of [...sb.querySelectorAll('*'), ...(sb.nextElementSibling ? [sb.nextElementSibling] : [])]) {
      const c = getComputedStyle(el).cursor;
      if (!resizer && /(col|ew|e|w)-resize/.test(c)) resizer = el;
      if (!mover && /^(move|grab)$/.test(c)) mover = el;
    }
    if (!resizer && /(col|ew|e|w)-resize/.test(getComputedStyle(sb).cursor)) resizer = sb;
    if (resizer) resizer.setAttribute('data-uitest-resizer', '1');
    if (mover) mover.setAttribute('data-uitest-mover', '1');
    const d = (el) => (el ? el.tagName.toLowerCase() + (el.id ? '#' + el.id : el.classList.length ? '.' + el.classList[0] : '') : null);
    return { sidebar: d(sb), side, toggle: toggle ? d(toggle) + ` "${(toggle.getAttribute('aria-label') || toggle.innerText || '').trim().slice(0, 30)}"` : null, resizer: d(resizer), mover: d(mover), draggable: sb.draggable };
  });
}

async function measure(page) {
  return page.evaluate(() => {
    const sb = document.querySelector('[data-uitest-sidebar]');
    const r = sb.getBoundingClientRect();
    // Hauptinhalt: größtes sichtbares Geschwister-/Nachbarelement, das nicht die Sidebar ist
    const main = document.querySelector('main,[role=main]') || [...document.body.children].filter((e) => e !== sb && !e.contains(sb)).sort((a, b) => b.getBoundingClientRect().width * b.getBoundingClientRect().height - a.getBoundingClientRect().width * a.getBoundingClientRect().height)[0];
    const m = main ? main.getBoundingClientRect() : null;
    // Inhalt des Hauptbereichs, der unter der Sidebar liegt
    let hidden = 0;
    if (main) {
      for (const el of main.querySelectorAll('h1,h2,h3,p,label,button,input,select,a,th,td')) {
        const er = el.getBoundingClientRect();
        if (er.width && er.left < r.right - 1 && er.right > r.left + 1 && er.top < r.bottom && er.bottom > r.top) hidden++;
      }
    }
    const expanded = document.querySelector('[data-uitest-toggle]')?.getAttribute('aria-expanded') ?? null;
    return {
      sidebarWidth: Math.round(r.width),
      sidebarLeft: Math.round(r.left),
      mainLeft: m ? Math.round(m.left) : null,
      mainWidth: m ? Math.round(m.width) : null,
      mainHiddenUnderSidebar: hidden,
      gap: m ? Math.round(m.left - r.right) : null,
      ariaExpanded: expanded,
      overflowX: Math.max(0, document.documentElement.scrollWidth - innerWidth),
    };
  });
}

async function sidebarTests(page, outDir, prefix) {
  const info = await findSidebar(page);
  if (!info) return { found: false };
  const res = { found: true, ...info, states: {}, findings: [] };
  const shot = (n) => page.screenshot({ path: path.join(outDir, `${prefix}-sidebar-${n}.png`) }).catch(() => {});
  const f = (m) => res.findings.push(m);

  res.states.start = await measure(page);
  await shot('start');
  if (res.states.start.mainHiddenUnderSidebar) f(`Schon im Ausgangszustand liegen ${res.states.start.mainHiddenUnderSidebar} Inhaltselemente unter der Sidebar`);

  if (info.toggle) {
    const t = page.locator('[data-uitest-toggle]').first();
    await t.click({ timeout: 3000 }).catch((e) => f(`Umschalt-Button nicht klickbar: ${e.message.split('\n')[0]}`));
    await page.waitForTimeout(500); // Animation
    const a = (res.states.eingeklappt = await measure(page));
    await shot('eingeklappt');
    const s = res.states.start;
    if (Math.abs(a.sidebarWidth - s.sidebarWidth) < 5 && a.sidebarLeft === s.sidebarLeft) f('Klick auf Umschalt-Button verändert die Sidebar nicht');
    else {
      if (a.mainLeft !== null && s.mainLeft !== null && a.sidebarWidth < s.sidebarWidth && Math.abs(a.mainLeft - s.mainLeft) < 5)
        f(`Inhalt zieht beim Einklappen nicht nach: Sidebar ${s.sidebarWidth}→${a.sidebarWidth}px, Inhalt bleibt bei x=${a.mainLeft} (Lücke ${a.gap}px)`);
      if (a.mainHiddenUnderSidebar) f(`Eingeklappt liegen ${a.mainHiddenUnderSidebar} Inhaltselemente unter der Sidebar`);
      if (s.ariaExpanded !== null && s.ariaExpanded === a.ariaExpanded) f('aria-expanded des Umschalt-Buttons ändert sich nicht (Screenreader erfährt den Zustand nicht)');
      if (s.ariaExpanded === null) f('Umschalt-Button hat kein aria-expanded');
    }
    await t.click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(500);
    const b = (res.states.wiederAusgeklappt = await measure(page));
    if (Math.abs(b.sidebarWidth - s.sidebarWidth) > 3 || Math.abs((b.mainLeft ?? 0) - (s.mainLeft ?? 0)) > 3)
      f(`Nach erneutem Klick nicht im Ausgangszustand: Sidebar ${b.sidebarWidth}px (vorher ${s.sidebarWidth}px), Inhalt x=${b.mainLeft} (vorher ${s.mainLeft})`);
    // Schnelles Mehrfachklicken (gerade Anzahl → muss wieder im Ausgangszustand landen)
    for (let i = 0; i < 6; i++) await t.click({ timeout: 1000, noWaitAfter: true }).catch(() => {});
    await page.waitForTimeout(700);
    const mc = (res.states.nachMehrfachklick = await measure(page));
    if (Math.abs(mc.sidebarWidth - s.sidebarWidth) > 3) {
      f(`Nach 6× schnellem Klicken ist die Sidebar nicht im Ausgangszustand (${mc.sidebarWidth}px statt ${s.sidebarWidth}px)`);
      await page.reload();
      await page.waitForTimeout(500);
      await findSidebar(page);
    }
  } else f('Kein Button zum Ein-/Ausklappen der Sidebar gefunden (oder nicht erkennbar beschriftet)');

  if (info.resizer) {
    const h = page.locator('[data-uitest-resizer]').first();
    const box = await h.boundingBox();
    if (box) {
      const drag = async (dx) => {
        // Griffposition jedes Mal neu bestimmen – er wandert mit der Breite
        const b = await h.boundingBox();
        const x = b.x + b.width / 2;
        const y = b.y + Math.min(b.height / 2, 200);
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x + dx, y, { steps: 8 });
        await page.mouse.up();
        await page.waitForTimeout(300);
        return measure(page);
      };
      const s = await measure(page);
      const wider = (res.states.breiterGezogen = await drag(150));
      await shot('breiter');
      if (Math.abs(wider.sidebarWidth - s.sidebarWidth) < 5) f('Ziehen am Griff ändert die Breite nicht');
      else {
        if (wider.mainHiddenUnderSidebar) f(`Breiter gezogen (${wider.sidebarWidth}px) überdeckt die Sidebar ${wider.mainHiddenUnderSidebar} Inhaltselemente – Inhalt zieht nicht nach`);
        if (wider.overflowX) f(`Breiter gezogen entsteht horizontaler Überlauf (${wider.overflowX}px)`);
      }
      // Extreme: sehr schmal und sehr breit
      const tiny = (res.states.minimalGezogen = await drag(-2000));
      await shot('minimal');
      if (tiny.sidebarWidth < 40) f(`Sidebar lässt sich auf ${tiny.sidebarWidth}px zusammenschieben (keine Mindestbreite)`);
      const huge = (res.states.maximalGezogen = await drag(3000));
      await shot('maximal');
      const vw = (page.viewportSize() || { width: 1280 }).width;
      if (huge.sidebarWidth > vw * 0.6) f(`Sidebar lässt sich auf ${huge.sidebarWidth}px aufziehen (${Math.round((huge.sidebarWidth / vw) * 100)}% des Fensters, keine Maximalbreite)`);
      // Wird die Breite gespeichert?
      await page.reload();
      await page.waitForTimeout(500);
      await findSidebar(page);
      res.states.nachReload = await measure(page);
    }
  } else res.info = 'Kein Ziehgriff zum Ändern der Breite gefunden (Sidebar ist vermutlich nicht in der Größe veränderbar).';

  if (info.mover || info.draggable) {
    const mv = page.locator(info.mover ? '[data-uitest-mover]' : '[data-uitest-sidebar]').first();
    const box = await mv.boundingBox();
    if (box) {
      const s = await measure(page);
      await page.mouse.move(box.x + 10, box.y + 10);
      await page.mouse.down();
      await page.mouse.move(box.x + 400, box.y + 100, { steps: 10 });
      await page.mouse.up();
      await page.waitForTimeout(400);
      const m = (res.states.verschoben = await measure(page));
      await shot('verschoben');
      res.moved = m.sidebarLeft !== s.sidebarLeft ? `verschoben von x=${s.sidebarLeft} nach x=${m.sidebarLeft}` : 'Verschieben ohne Wirkung';
    }
  }
  return res;
}

(async () => {
  const args = parseArgs();
  const outDir = ensureDir(path.resolve(args.out || defaultOutDir('layout')));
  const sizes = String(args.sizes || '1280x800,375x667').split(',').map((s) => parseViewport(s.trim()));
  const { page, close } = await openTarget(args);
  const base = page.url();
  const urls = [base, ...String(args.pages || '').split(',').filter(Boolean).map((p) => new URL(p, base).href)];

  const results = [];
  for (const url of urls) {
    for (const size of sizes) {
      await page.setViewportSize(size);
      if (page.url() !== url) await page.goto(url, { waitUntil: 'domcontentloaded' });
      else await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(300);
      const prefix = `${results.length}-${size.width}x${size.height}`;
      const checks = await page.evaluate(pageChecks);
      await page.screenshot({ path: path.join(outDir, `${prefix}.png`), fullPage: true }).catch(() => {});
      const sidebar = args['no-sidebar'] ? { skipped: true } : await sidebarTests(page, outDir, prefix);
      results.push({ url, size: `${size.width}x${size.height}`, ...checks, sidebar });
    }
  }
  writeJson(path.join(outDir, 'layout.json'), { results });

  let total = 0;
  for (const r of results) {
    console.log(`\n=== ${r.url} @ ${r.size}`);
    const line = (m) => { total++; console.log(`  ! ${m}`); };
    if (r.horizontalOverflowPx) line(`horizontaler Überlauf ${r.horizontalOverflowPx}px`);
    for (const o of r.overlays) console.log(`  ℹ ${o}`);
    for (const c of r.covered.slice(0, 10)) line(`verdeckt (${c.percent}%): ${c.el} ← von ${c.by}`);
    if (r.coveredTotal > 10) console.log(`    … ${r.coveredTotal - 10} weitere verdeckte Elemente`);
    for (const s of r.narrowSelects) line(`Dropdown zu schmal: ${s.el} ist ${s.width}px, braucht ~${s.needed}px für "${s.longest}"${s.selectedCut ? ' (auch Auswahl abgeschnitten)' : ''}`);
    for (const c of r.clipped.slice(0, 10)) line(`Text abgeschnitten: ${c.el} (${c.how}${c.title ? ', ' + c.title : ''})`);
    for (const t of r.tables) line(`Tabelle: ${t.el} ${t.problem} (${t.width}px Inhalt, ${t.visible}px sichtbar)`);
    if (r.sidebar.found) {
      console.log(`  Sidebar ${r.sidebar.sidebar} (${r.sidebar.side}); Umschalter: ${r.sidebar.toggle || '–'}; Ziehgriff: ${r.sidebar.resizer || '–'}; verschiebbar: ${r.sidebar.mover || r.sidebar.draggable ? 'ja' : 'nein'}`);
      for (const f of r.sidebar.findings) line(`Sidebar: ${f}`);
      if (r.sidebar.info) console.log(`  ℹ ${r.sidebar.info}`);
      if (r.sidebar.moved) console.log(`  ℹ Verschieben: ${r.sidebar.moved}`);
    } else if (!r.sidebar.skipped) console.log('  ℹ keine Sidebar erkannt');
  }
  console.log(`\nGesamt: ${total} Befunde. Screenshots und Details: ${outDir}`);
  console.log('Screenshots ansehen: Überlappende Texte, falsche Abstände und Ausrichtung erkennt nur das Auge.');
  await close();
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
