#!/usr/bin/env node
'use strict';
// T4 Formulare:
//  1. Felder: Beschriftung, Typ passend zum Inhalt (Datum, Zahl, E-Mail …), Dropdown-Optionen
//  2. Pflichtfelder: gekennzeichnet (*)? technisch Pflicht (required)? beides gleich?
//  3. Größen: Felder einer Form gleich hoch/breit? Datums-/Zeitfelder vs. Textfelder (Safari!)
//  4. Ausfüllen: übernimmt jedes Feld einen gültigen Wert unverändert?
//  5. Falscheingaben: werden ungültige Werte abgewiesen oder gemeldet?
//  6. Pflichtfeld-Logik beim Speichern: leeres Formular, jedes Pflichtfeld einzeln leer → Fehlermeldung?
//     Wird trotzdem gespeichert? Sind die Meldungen verständlich (keine Codes/Stacktraces)?
//
//   node forms.cjs --url http://localhost:5173 [--pages /a,/b] [--browser webkit] [--no-submit]
//                  [--out dir] [--storage-state …] [--cdp …]
//
// ACHTUNG: Ohne --no-submit werden Formulare abgeschickt (legt ggf. Daten an) – nur in Testumgebungen.

const path = require('path');
const { parseArgs, ensureDir, defaultOutDir, openTarget, writeJson, findCrypticTexts } = require('./_common.cjs');

// ---------- Felder einsammeln ----------
async function collectForms(page) {
  return page.evaluate(() => {
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
    };
    const labelOf = (el) => {
      // Label-Text ohne den Inhalt eingebetteter Felder (z. B. Optionen eines <select> im <label>)
      const own = (l) => [...l.childNodes].filter((n) => !(n.nodeType === 1 && n.matches('input,select,textarea,button'))).map((n) => n.textContent).join(' ');
      if (el.labels && el.labels.length) return [...el.labels].map(own).join(' ').replace(/\s+/g, ' ').trim();
      const lb = el.getAttribute('aria-labelledby');
      if (lb) return lb.split(/\s+/).map((id) => document.getElementById(id)?.innerText || '').join(' ').trim();
      return (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.name || '').trim();
    };
    let forms = [...document.forms].filter(visible);
    let pseudo = false;
    if (!forms.length) {
      // Kein <form>: alles im body als eine Form behandeln, wenn es einen Speichern-Button gibt
      pseudo = true;
      forms = [document.body];
    }
    const submitRe = /speicher|sichern|absenden|senden|anlegen|erstellen|hinzufügen|übernehmen|bestätigen|weiter|anmelden|registrier|save|submit|create|add|send/i;
    return forms.map((f, fi) => {
      f.setAttribute('data-uitest-form', String(fi));
      const fields = [...f.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image]),select,textarea,[contenteditable=true]')]
        .filter(visible)
        .map((el, i) => {
          el.setAttribute('data-uitest-field', `${fi}-${i}`);
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          const label = labelOf(el);
          const labelEls = el.labels ? [...el.labels] : [];
          const marker = /\*|pflicht|erforderlich|required/i.test(label) || labelEls.some((l) => /\*|required/.test(getComputedStyle(l, '::after').content || '') || l.querySelector('.required,[class*=required]'));
          return {
            id: `${fi}-${i}`,
            tag: el.tagName.toLowerCase(),
            type: el.tagName === 'SELECT' ? 'select' : el.tagName === 'TEXTAREA' ? 'textarea' : (el.getAttribute('type') || 'text').toLowerCase(),
            name: el.name || el.id || '',
            label,
            required: el.required || el.getAttribute('aria-required') === 'true',
            marked: !!marker,
            inputmode: el.getAttribute('inputmode') || '',
            pattern: el.getAttribute('pattern') || '',
            min: el.getAttribute('min') || '',
            max: el.getAttribute('max') || '',
            maxlength: el.getAttribute('maxlength') || '',
            w: Math.round(r.width),
            h: Math.round(r.height),
            font: cs.fontSize,
            options: el.tagName === 'SELECT' ? [...el.options].map((o) => ({ v: o.value, t: o.text.trim(), disabled: o.disabled })) : undefined,
          };
        });
      const btns = [...f.querySelectorAll('button,input[type=submit],[role=button]')].filter(visible);
      const submit = btns.find((b) => b.type === 'submit' && b.tagName !== 'A') || btns.find((b) => submitRe.test(b.innerText || b.value || b.getAttribute('aria-label') || ''));
      if (submit) submit.setAttribute('data-uitest-submit', String(fi));
      return { index: fi, pseudo, id: f.id || '', novalidate: f.noValidate || false, fields, submit: submit ? (submit.innerText || submit.value || '').trim() : null };
    });
  });
}

// ---------- Erwartungen an Feldtypen ----------
const KIND = [
  [/datum|date|geburt|tag\b|von\b|bis\b|frist|termin|fällig/i, 'date', ['date', 'datetime-local']],
  [/uhrzeit|zeit\b|time|beginn|ende|start/i, 'time', ['time', 'datetime-local']],
  [/e-?mail/i, 'email', ['email']],
  [/telefon|tel\b|phone|mobil|handy/i, 'tel', ['tel']],
  [/stunden|anzahl|menge|betrag|preis|summe|zahl|dauer|stück|alter|prozent|gewicht|minuten|kosten|\bh\b/i, 'number', ['number', 'range']],
  [/plz|postleitzahl/i, 'plz', ['text', 'number']],
  [/url|webseite|website|homepage|link/i, 'url', ['url']],
  [/passwort|kennwort|password/i, 'password', ['password']],
];
function expectedKind(f) {
  const hay = `${f.label} ${f.name}`;
  for (const [re, kind, types] of KIND) if (re.test(hay)) return { kind, types };
  return null;
}

function validValue(f) {
  const k = expectedKind(f);
  switch (f.type) {
    case 'email': return 'test@example.com';
    case 'number': return f.min ? String(Math.max(Number(f.min), 1)) : '2';
    case 'date': return '2026-11-21';
    case 'time': return '09:30';
    case 'datetime-local': return '2026-11-21T09:30';
    case 'month': return '2026-11';
    case 'tel': return '+49 170 1234567';
    case 'url': return 'https://example.com';
    case 'password': return 'Test1234!x';
    case 'color': return '#336699';
    case 'checkbox': case 'radio': return true;
    case 'select': { const o = f.options.find((x) => x.v && !x.disabled); return o ? o.v : null; }
  }
  if (k) {
    if (k.kind === 'date') return '21.11.2026';
    if (k.kind === 'time') return '09:30';
    if (k.kind === 'email') return 'test@example.com';
    if (k.kind === 'tel') return '+49 170 1234567';
    if (k.kind === 'number') return '2';
    if (k.kind === 'plz') return '12345';
    if (k.kind === 'url') return 'https://example.com';
  }
  if (/name/i.test(f.label + f.name)) return 'Max Mustermann';
  return 'Testeintrag';
}

function wrongValues(f) {
  const k = expectedKind(f);
  const kind = ['number', 'date', 'time', 'email', 'tel', 'url'].includes(f.type) ? f.type : k ? k.kind : 'text';
  const list = {
    number: ['abc', '-5', '1e309', '2,5,5', '99999999999'],
    date: ['31.02.2026', 'abc', '2026-13-45', '0000-00-00'],
    time: ['25:61', 'abc'],
    email: ['kein-at', 'a@', '@b.de', 'a b@c.de'],
    tel: ['abc', '12'],
    url: ['kein url', 'javascript:alert(1)'],
    plz: ['abc', '123', '1234567'],
    text: f.maxlength ? ['x'.repeat(Number(f.maxlength) + 10)] : [],
  };
  return list[kind] || [];
}

async function setField(page, f, value) {
  const loc = page.locator(`[data-uitest-field="${f.id}"]`);
  if (f.type === 'checkbox' || f.type === 'radio') return value ? loc.check({ timeout: 2000 }).catch(() => loc.click({ timeout: 2000 })) : loc.uncheck({ timeout: 2000 }).catch(() => {});
  if (f.type === 'select') return value === null ? undefined : loc.selectOption(value, { timeout: 2000 }).catch(() => {});
  try {
    await loc.fill(value === '' ? '' : String(value), { timeout: 2000 });
  } catch (_) {
    // z. B. Text in number/date: wie ein Mensch tippen
    await loc.click({ timeout: 2000 }).catch(() => {});
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a').catch(() => {});
    await page.keyboard.press('Backspace').catch(() => {});
    await page.keyboard.type(String(value)).catch(() => {});
  }
}

async function readField(page, f) {
  const loc = page.locator(`[data-uitest-field="${f.id}"]`);
  return loc.evaluate((el) => ({ value: el.isContentEditable ? el.innerText : el.value, valid: el.validity ? el.validity.valid : true, msg: el.validationMessage || '', ariaInvalid: el.getAttribute('aria-invalid') })).catch(() => ({}));
}

async function visibleMessages(page) {
  return page.evaluate(() => {
    const sel = '[role=alert],[aria-live],[class*=error i],[class*=invalid i],[class*=fehler i],[class*=warn i],[id*=error i],[class*=msg i],[class*=message i],[class*=feedback i],[class*=hint i]';
    return [...document.querySelectorAll(sel)]
      .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && e.innerText.trim(); })
      .map((e) => e.innerText.replace(/\s+/g, ' ').trim().slice(0, 200));
  }).then((l) => [...new Set(l)]).catch(() => []);
}

async function submitAndObserve(page, form) {
  const writes = [];
  const onRes = (r) => { if (r.request().method() !== 'GET' && r.request().resourceType() !== 'image') writes.push({ method: r.request().method(), url: new URL(r.url()).pathname, status: r.status() }); };
  page.on('response', onRes);
  const errors = [];
  const onErr = (e) => errors.push(e.message);
  page.on('pageerror', onErr);
  const btn = page.locator(`[data-uitest-submit="${form.index}"]`);
  if (await btn.count()) await btn.click({ timeout: 3000 }).catch(() => {});
  else await page.locator(`[data-uitest-form="${form.index}"]`).evaluate((f) => f.requestSubmit && f.requestSubmit()).catch(() => {});
  await page.waitForTimeout(900);
  page.off('response', onRes);
  page.off('pageerror', onErr);
  const messages = await visibleMessages(page);
  const cryptic = await findCrypticTexts(page);
  const saved = writes.some((w) => w.status >= 200 && w.status < 300);
  return { writes, saved, messages, cryptic, errors };
}

async function fresh(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  return collectForms(page);
}

(async () => {
  const args = parseArgs();
  const outDir = ensureDir(path.resolve(args.out || defaultOutDir('forms')));
  const target = await openTarget(args);
  const { page } = target;
  const base = page.url();
  const urls = [base, ...String(args.pages || '').split(',').filter(Boolean).map((p) => new URL(p, base).href)];
  const browserName = target.browserName || 'chromium';

  const report = [];
  for (const url of urls) {
    const forms = await fresh(page, url);
    for (const form of forms) {
      if (!form.fields.length) continue;
      const fr = { url, form: form.id || `Formular ${form.index + 1}`, submit: form.submit, novalidate: form.novalidate, fields: [], findings: [] };
      const F = (cat, msg) => fr.findings.push({ cat, msg });
      const nm = (f) => `"${f.label || f.name || f.id}"`;

      // 1 + 2: Typ, Beschriftung, Pflicht-Kennzeichnung, Dropdowns
      for (const f of form.fields) {
        if (!f.label) F('Beschriftung', `Feld ${f.name || f.id} (${f.type}) hat keine Beschriftung`);
        const k = expectedKind(f);
        if (k && !k.types.includes(f.type) && !(k.kind === 'number' && (f.inputmode === 'decimal' || f.inputmode === 'numeric' || f.pattern)))
          F('Format', `${nm(f)} sieht nach ${k.kind === 'number' ? 'einer Zahl' : k.kind === 'date' ? 'einem Datum' : k.kind} aus, ist aber type="${f.type}"${f.pattern ? '' : ' ohne pattern'} – Falscheingaben werden nicht verhindert`);
        if (f.required && !f.marked) F('Pflichtfeld', `${nm(f)} ist Pflicht (required), aber nicht gekennzeichnet (kein * / „Pflichtfeld“)`);
        if (!f.required && f.marked) F('Pflichtfeld', `${nm(f)} ist als Pflicht gekennzeichnet, aber technisch nicht required – Logik prüfen (siehe Speichern-Test)`);
        if (f.type === 'select') {
          const texts = f.options.map((o) => o.t);
          const dups = texts.filter((t, i) => t && texts.indexOf(t) !== i);
          if (dups.length) F('Dropdown', `${nm(f)} hat doppelte Optionen: ${[...new Set(dups)].join(', ')}`);
          if (f.options.some((o) => !o.t && o.v)) F('Dropdown', `${nm(f)} hat Optionen ohne Text`);
          if (f.required && !f.options.some((o) => !o.v)) F('Dropdown', `${nm(f)} ist Pflicht, hat aber keine leere „Bitte wählen“-Option – die erste Option ist stillschweigend vorausgewählt`);
          if (f.options.length > 15) {
            const t = f.options.filter((o) => o.v).map((o) => o.t);
            const sorted = [...t].sort((a, b) => a.localeCompare(b, 'de'));
            if (t.join('|') !== sorted.join('|')) F('Dropdown', `${nm(f)} hat ${t.length} Optionen, nicht alphabetisch sortiert – schwer zu finden`);
          }
        }
      }

      // 3: Größen (Datum/Zeit vs. Text) – hier fällt das Safari-Problem auf
      const textLike = form.fields.filter((f) => ['text', 'email', 'tel', 'url', 'number', 'password', 'search', 'select'].includes(f.type));
      if (textLike.length) {
        const hs = textLike.map((f) => f.h).sort((a, b) => a - b);
        const medH = hs[Math.floor(hs.length / 2)];
        const ws = textLike.map((f) => f.w).sort((a, b) => a - b);
        const medW = ws[Math.floor(ws.length / 2)];
        for (const f of form.fields) {
          if (['checkbox', 'radio', 'range', 'color', 'file', 'textarea'].includes(f.type)) continue;
          const isDate = ['date', 'time', 'datetime-local', 'month', 'week'].includes(f.type);
          if (Math.abs(f.h - medH) > 3) F('Größe', `${nm(f)} (${f.type}) ist ${f.h}px hoch, die anderen Felder ${medH}px${isDate ? ` – Datumsfeld weicht ab (in ${browserName} gemessen; in Safari/WebKit gegenprüfen: --browser webkit)` : ''}`);
          if (isDate && f.w < medW * 0.6) F('Größe', `${nm(f)} (${f.type}) ist nur ${f.w}px breit, andere Felder ${medW}px`);
        }
      }

      // 4 + 5: Ausfüllen und Falscheingaben (jeweils ohne Abschicken)
      let current = await fresh(page, url);
      let cf = current.find((x) => x.index === form.index) || form;
      for (const f of cf.fields) {
        const v = validValue(f);
        if (v === null || v === true) continue;
        await setField(page, f, v);
        const r = await readField(page, f);
        const entry = { field: f.label || f.name, type: f.type, filled: v, readBack: r.value, wrong: [] };
        if (r.value !== undefined && String(r.value) !== String(v)) F('Ausfüllen', `${nm(f)}: eingegeben "${v}", im Feld steht "${r.value}"`);
        const accepted = [];
        for (const w of wrongValues(f)) {
          await setField(page, f, '');
          await setField(page, f, w);
          const rw = await readField(page, f);
          const rejected = rw.value === '' || rw.value === undefined || (rw.value !== w && f.type !== 'text');
          const flagged = rw.valid === false || rw.ariaInvalid === 'true';
          entry.wrong.push({ input: w, value: rw.value, rejected, flagged, msg: rw.msg });
          if (!rejected && !flagged) accepted.push(w.length > 30 ? w.slice(0, 30) + '…' : w);
        }
        if (accepted.length) F('Falscheingabe', `${nm(f)} akzeptiert ohne Hinweis: ${accepted.map((a) => `"${a}"`).join(', ')}`);
        await setField(page, f, v);
        fr.fields.push(entry);
      }
      await page.screenshot({ path: path.join(outDir, `form-${report.length}-ausgefuellt.png`), fullPage: true }).catch(() => {});

      // 6: Pflichtfeld-Logik beim Speichern
      if (!args['no-submit'] && form.submit !== null) {
        // a) komplett leer
        current = await fresh(page, url);
        cf = current.find((x) => x.index === form.index) || form;
        const empty = await submitAndObserve(page, cf);
        await page.screenshot({ path: path.join(outDir, `form-${report.length}-leer-gespeichert.png`), fullPage: true }).catch(() => {});
        fr.emptySubmit = empty;
        const reqFields = cf.fields.filter((f) => f.required || f.marked);
        if (empty.saved) F('Pflichtfeld', `Leeres Formular wurde gespeichert (${empty.writes.map((w) => `${w.method} ${w.url} → ${w.status}`).join(', ')})`);
        if (!empty.messages.length && reqFields.length) {
          const native = [];
          for (const f of reqFields) { const r = await readField(page, f); if (r.msg) native.push(`${nm(f)}: "${r.msg}"`); }
          if (native.length) F('Fehlermeldung', `Beim leeren Speichern nur Browser-Standardblasen (sehen je Browser anders aus, verschwinden sofort): ${native.slice(0, 3).join('; ')}`);
          else F('Fehlermeldung', 'Beim Speichern des leeren Formulars erscheint keine Fehlermeldung');
        }
        for (const c of empty.cryptic) F('Fehlermeldung', `Unverständliche Meldung (${c.reason}): "${c.text}"`);
        for (const e of empty.errors) F('Fehler', `JS-Fehler beim Speichern: ${e}`);

        // b) je Pflichtfeld: alle anderen gültig, nur dieses leer
        for (const target of reqFields) {
          current = await fresh(page, url);
          cf = current.find((x) => x.index === form.index) || form;
          for (const f of cf.fields) {
            if (f.id === target.id) continue;
            const v = validValue(f);
            if (v !== null) await setField(page, f, v);
          }
          const res = await submitAndObserve(page, cf);
          const r = await readField(page, target);
          const mentions = res.messages.some((m) => (target.label && m.toLowerCase().includes(target.label.replace(/\*/g, '').trim().toLowerCase())) || /pflicht|erforderlich|ausfüllen|fehlt|leer|required/i.test(m));
          if (res.saved) F('Pflichtfeld', `${nm(target)} leer → trotzdem gespeichert (${res.writes.map((w) => `${w.method} ${w.url} → ${w.status}`).join(', ')})`);
          else if (!mentions && !r.msg && r.ariaInvalid !== 'true') F('Fehlermeldung', `${nm(target)} leer → keine Meldung, die auf das Feld hinweist${res.messages.length ? ` (angezeigt: "${res.messages[0]}")` : ''}`);
          for (const c of res.cryptic) F('Fehlermeldung', `Unverständliche Meldung bei leerem ${nm(target)} (${c.reason}): "${c.text}"`);
          for (const e of res.errors) F('Fehler', `JS-Fehler bei leerem ${nm(target)}: ${e}`);
        }

        // c) Falscheingaben abschicken: wird Ungültiges gespeichert?
        for (const f of cf.fields) {
          const wv = wrongValues(f)[0];
          if (!wv) continue;
          current = await fresh(page, url);
          const cf2 = current.find((x) => x.index === form.index) || form;
          for (const g of cf2.fields) { const v = g.id === f.id ? wv : validValue(g); if (v !== null) await setField(page, g, v); }
          // Hat das Feld den falschen Wert überhaupt angenommen? Sonst ist das Feld schon geschützt.
          const held = await readField(page, f);
          if (held.value !== wv) continue;
          const res = await submitAndObserve(page, cf2);
          if (res.saved) F('Falscheingabe', `${nm(f)} = "${wv}" wurde gespeichert (${res.writes.map((w) => `${w.method} ${w.url} → ${w.status}`).join(', ')})`);
          else if (res.writes.some((w) => w.status >= 500)) F('Falscheingabe', `${nm(f)} = "${wv}" führt zu Serverfehler ${res.writes.find((w) => w.status >= 500).status} statt verständlicher Ablehnung`);
          for (const c of res.cryptic) F('Fehlermeldung', `Unverständliche Meldung bei ${nm(f)} = "${wv}" (${c.reason}): "${c.text}"`);
        }
      }
      report.push(fr);
    }
  }
  writeJson(path.join(outDir, 'forms.json'), { browser: browserName, results: report });

  let total = 0;
  for (const fr of report) {
    console.log(`\n=== ${fr.form} @ ${fr.url}  (Speichern-Button: ${fr.submit ? `"${fr.submit}"` : '–'}, Browser: ${browserName})`);
    const seen = new Set();
    for (const x of fr.findings) {
      const key = x.cat + x.msg;
      if (seen.has(key)) continue;
      seen.add(key);
      total++;
      console.log(`  ! [${x.cat}] ${x.msg}`);
    }
    if (!fr.findings.length) console.log('  ✔ keine Befunde');
  }
  if (!report.length) console.log('Keine Formulare gefunden.');
  console.log(`\nGesamt: ${total} Befunde. Details: ${path.join(outDir, 'forms.json')}`);
  await target.close();
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
