// --- derive real (non-"any") language codes from config ---
const REAL_LANG_KEYS = Object.keys(LANGUAGES).filter(k => LANGUAGES[k].wikiCode);

let currentLang = 'uk';

function t(key) {
  const cfg = LANGUAGES[currentLang] || LANGUAGES.uk;
  return cfg.ui[key];
}

// --- render language tabs from config ---
function renderLangTabs() {
  const container = document.getElementById('langs');
  container.innerHTML = '';
  for (const key of Object.keys(LANGUAGES)) {
    const btn = document.createElement('button');
    btn.dataset.lang = key;
    btn.textContent = LANGUAGES[key].tabLabel;
    if (key === currentLang) btn.classList.add('active');
    container.appendChild(btn);
  }
}

function setActiveLangTab(key) {
  document.querySelectorAll('.langs button').forEach(b => {
    b.classList.toggle('active', b.dataset.lang === key);
  });
}

function applyUILang() {
  document.getElementById('getBtn').textContent = t('getBtn');
  const quoteEl = document.getElementById('quote');
  if (quoteEl.classList.contains('placeholder')) {
    quoteEl.textContent = t('placeholder');
  }
}

document.getElementById('langs').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-lang]');
  if (!btn) return;
  currentLang = btn.dataset.lang;
  setActiveLangTab(currentLang);
  applyUILang();
});

// --- device language auto-detect (works on install-as-PWA and on plain web too) ---
function detectDefaultLang() {
  const prefs = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language];
  for (const pref of prefs) {
    const primary = (pref || '').split('-')[0].toLowerCase();
    if (REAL_LANG_KEYS.includes(primary)) return primary;
  }
  return 'uk'; // fallback
}

const themeToggle = document.getElementById('themeToggle');
themeToggle.addEventListener('click', () => {
  document.body.classList.toggle('dark');
});

function pickWikiCode() {
  if (currentLang === 'any' || !LANGUAGES[currentLang].wikiCode) {
    return REAL_LANG_KEYS[Math.floor(Math.random() * REAL_LANG_KEYS.length)];
  }
  return LANGUAGES[currentLang].wikiCode;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (res.status === 429 || res.status === 503) {
    const retryAfter = parseFloat(res.headers.get('Retry-After')) || 1;
    await sleep(Math.min(retryAfter, 3) * 1000);
    throw new Error('rate-limited');
  }
  if (!res.ok) {
    throw new Error('http-' + res.status);
  }
  return res.json();
}

async function fetchRandomTitle(code) {
  const url = `https://${code}.wikiquote.org/w/api.php?action=query&list=random&rnnamespace=0&rnfilterredir=nonredirects&rnlimit=1&format=json&origin=*`;
  const data = await fetchJson(url);
  return data.query.random[0].title;
}

async function fetchWikitext(code, title) {
  const url = `https://${code}.wikiquote.org/w/api.php?action=query&prop=revisions&rvslots=main&rvprop=content&titles=${encodeURIComponent(title)}&format=json&origin=*`;
  const data = await fetchJson(url);
  const pages = data.query.pages;
  const page = Object.values(pages)[0];
  if (!page || page.missing !== undefined) return '';
  const rev = page.revisions && page.revisions[0];
  return rev ? rev.slots.main['*'] : '';
}

function stripTemplatesAndComments(wikitext) {
  let t = wikitext;
  t = t.replace(/<!--[\s\S]*?-->/g, '');
  t = t.replace(/<ref[^>]*\/>/gi, '');
  t = t.replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '');
  // templates can span multiple lines and nest one level deep; strip innermost-first, a few passes
  for (let i = 0; i < 5; i++) {
    const before = t;
    t = t.replace(/\{\{[^{}]*\}\}/g, '');
    if (t === before) break;
  }
  return t;
}

function decodeEntities(t) {
  return t
    .replace(/&nbsp;/g, ' ')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&laquo;/g, '«')
    .replace(/&raquo;/g, '»');
}

function cleanWikitext(line) {
  let t = line;
  t = t.replace(/\[\[([^\]|]*\|)?([^\]]+)\]\]/g, '$2');
  t = t.replace(/\[(https?:\/\/[^\s\]]+)\s+([^\]]+)\]/g, '$2');
  t = t.replace(/\[(https?:\/\/[^\s\]]+)\]/g, '');
  t = t.replace(/'''''/g, '').replace(/'''/g, '').replace(/''/g, '');
  t = t.replace(/<[^>]+>/g, '');
  t = t.replace(/^\*+\s*/, '');
  t = decodeEntities(t);
  t = t.replace(/\s+/g, ' ').trim();
  return t;
}

function isPureWikilink(bulletBody) {
  return /^\[\[[^\]]+\]\]\.?\s*$/.test(bulletBody.trim());
}

// --- build combined filter regexes from the union of every configured real language ---
function buildUnionRegex(words) {
  const unique = [...new Set(words)];
  return unique.length ? new RegExp(unique.join('|'), 'i') : null;
}

function collectField(field) {
  const out = [];
  for (const key of REAL_LANG_KEYS) {
    const list = LANGUAGES[key][field];
    if (list) out.push(...list);
  }
  return out;
}

const SKIP_SECTIONS_RE = buildUnionRegex([
  ...CORE_SKIP_SECTION_WORDS,
  ...collectField('skipSectionWords'),
].map(w => `^${w}$`));

const EXTERNAL_LINK_PHRASE_RE = buildUnionRegex(collectField('externalLinkPhrases'));
const BIBLIOGRAPHY_WORD_RE = buildUnionRegex(collectField('bibliographyWords'));
const PAGE_UNIT_RE = buildUnionRegex([
  ...CORE_PAGE_UNIT_ABBREV,
  ...collectField('pageUnitAbbrev'),
].map(u => `\\d+\\s*(${u})\\s*$`));

function looksLikeBibliography(cleaned) {
  if (/\bISBN\b/i.test(cleaned)) return true;
  if (PAGE_UNIT_RE && PAGE_UNIT_RE.test(cleaned)) return true;
  if (BIBLIOGRAPHY_WORD_RE && BIBLIOGRAPHY_WORD_RE.test(cleaned)) return true;
  // "Surname, Name." at the very start, combined with a year — typical of a bibliography entry.
  // Latin + Cyrillic ranges only; languages using other scripts won't match this particular
  // heuristic but still get the language-agnostic checks above.
  if (/^[А-ЯЇІЄҐA-Z][\wʼ'-]+,\s*[А-ЯЇІЄҐA-Z]/.test(cleaned) && /\d{4}/.test(cleaned)) return true;
  return false;
}

function looksLikeExternalLinkLine(cleaned) {
  if (EXTERNAL_LINK_PHRASE_RE && EXTERNAL_LINK_PHRASE_RE.test(cleaned)) return true;
  if (/\b[\w-]+\.(com|org|net|ua|de|info)\b/i.test(cleaned)) return true;
  return false;
}

function extractQuoteLines(rawWikitext, title) {
  const wikitext = stripTemplatesAndComments(rawWikitext);
  const rawLines = wikitext.split('\n');
  const result = [];
  let skipSection = false;
  for (const raw of rawLines) {
    const trimmed = raw.trim();
    if (/^={2,}/.test(trimmed)) {
      const heading = trimmed.replace(/=/g, '').trim();
      skipSection = SKIP_SECTIONS_RE ? SKIP_SECTIONS_RE.test(heading) : false;
      continue;
    }
    if (skipSection) continue;
    // only top-level bullets: "* text", not "** text" (those are citations)
    if (!/^\*(?!\*)/.test(trimmed)) continue;
    const bulletBody = trimmed.replace(/^\*+\s*/, '');
    if (isPureWikilink(bulletBody)) continue;
    const cleaned = cleanWikitext(trimmed);
    if (!cleaned || cleaned.toLowerCase() === title.toLowerCase()) continue;
    if (cleaned.length < 15 || cleaned.length > 400) continue;
    if (!/[a-zA-Zà-žÀ-Žа-яА-ЯіїєґІЇЄҐ]/.test(cleaned)) continue;
    if (looksLikeBibliography(cleaned)) continue;
    if (looksLikeExternalLinkLine(cleaned)) continue;
    result.push(cleaned);
  }
  return result;
}

async function getQuote() {
  const getBtn = document.getElementById('getBtn');
  const quoteEl = document.getElementById('quote');
  getBtn.disabled = true;
  quoteEl.classList.add('placeholder');
  quoteEl.textContent = t('loading');

  const code = pickWikiCode();
  const maxAttempts = 8;
  let attempts = 0;

  while (attempts < maxAttempts) {
    attempts++;
    try {
      const title = await fetchRandomTitle(code);
      const wikitext = await fetchWikitext(code, title);
      if (!wikitext || /^#REDIRECT/i.test(wikitext.trim())) continue;
      const candidates = extractQuoteLines(wikitext, title);
      if (candidates.length > 0) {
        const quote = candidates[Math.floor(Math.random() * candidates.length)];
        quoteEl.classList.remove('placeholder');
        quoteEl.textContent = quote;
        getBtn.disabled = false;
        return;
      }
    } catch (err) {
      // single request failed (404, network blip, rate limit) — just try another random page
      continue;
    }
  }
  quoteEl.textContent = t('notFound');
  getBtn.disabled = false;
}

document.getElementById('getBtn').addEventListener('click', getQuote);

document.getElementById('copyBtn').addEventListener('click', () => {
  const text = document.getElementById('quote').textContent;
  navigator.clipboard.writeText(text).catch(() => {});
});

// --- init ---
currentLang = detectDefaultLang();
renderLangTabs();
applyUILang();
