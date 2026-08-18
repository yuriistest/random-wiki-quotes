// --- derive real (non-"any") language codes from config ---
const REAL_LANG_KEYS = Object.keys(LANGUAGES).filter(k => LANGUAGES[k].wikiCode);

let currentLang = 'uk';
let fetchInFlight = false;
let currentAbortController = null;

// session-scoped dedup: remembers recently shown quotes so we don't repeat
// them back-to-back. Capped so memory doesn't grow forever; resets on reload
// (no localStorage, per artifact constraints).
const SEEN_LIMIT = 20;
const seenQuotes = [];
function rememberQuote(text) {
  seenQuotes.push(text);
  if (seenQuotes.length > SEEN_LIMIT) seenQuotes.shift();
}
function wasRecentlyShown(text) {
  return seenQuotes.includes(text);
}

function buildSourceUrl(code, title) {
  return `https://${code}.wikiquote.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
}

function setSourceLink(url) {
  const link = document.getElementById('sourceLink');
  if (url) {
    link.href = url;
    link.classList.remove('disabled');
    link.removeAttribute('aria-disabled');
  } else {
    link.removeAttribute('href');
    link.classList.add('disabled');
    link.setAttribute('aria-disabled', 'true');
  }
}

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
  if (fetchInFlight) return;
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

async function fetchJson(url, signal) {
  const res = await fetch(url, { signal });
  if (res.status === 429 || res.status === 503) {
    const retryAfter = parseFloat(res.headers.get('Retry-After')) || 1;
    await sleep(Math.min(retryAfter, 3) * 1000);
    throw new Error('rate-limited');
  }
  if (!res.ok) {
    throw new Error('http-' + res.status);
  }
  const data = await res.json();
  if (data.error) {
    throw new Error('mediawiki-api-error: ' + (data.error.info || data.error.code || 'unknown'));
  }
  return data;
}

async function fetchRandomTitle(code, signal) {
  const url = `https://${code}.wikiquote.org/w/api.php?action=query&list=random&rnnamespace=0&rnfilterredir=nonredirects&rnlimit=1&format=json&origin=*`;
  const data = await fetchJson(url, signal);
  if (!data.query || !data.query.random || !data.query.random[0]) {
    throw new Error('unexpected-response: missing query.random');
  }
  return data.query.random[0].title;
}

async function fetchWikitext(code, title, signal) {
  const url = `https://${code}.wikiquote.org/w/api.php?action=query&prop=revisions&rvslots=main&rvprop=content&titles=${encodeURIComponent(title)}&format=json&origin=*`;
  const data = await fetchJson(url, signal);
  const pages = data.query && data.query.pages;
  if (!pages) throw new Error('unexpected-response: missing query.pages');
  const page = Object.values(pages)[0];
  if (!page || page.missing !== undefined) return '';
  const rev = page.revisions && page.revisions[0];
  return rev && rev.slots && rev.slots.main ? rev.slots.main['*'] : '';
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
  t = t.replace(/^:+\s*/, '');
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
  // \p{Lu}/\p{L}/\p{M} cover any script's letters and combining diacritics, not just Latin/Cyrillic.
  if (/^[\p{Lu}][\p{L}\p{M}ʼ'-]+,\s*[\p{Lu}]/u.test(cleaned) && /\d{4}/.test(cleaned)) return true;
  return false;
}

function looksLikeExternalLinkLine(cleaned) {
  if (EXTERNAL_LINK_PHRASE_RE && EXTERNAL_LINK_PHRASE_RE.test(cleaned)) return true;
  if (/\b[\w-]+\.(com|org|net|ua|de|info)\b/i.test(cleaned)) return true;
  return false;
}

// "Name Name (1818—1881) — occupation description." — a biographical lede,
// not a quote. \p{L}\p{M} covers letters plus combining diacritics (e.g.
// Сергі́й has a combining acute accent as a separate code point).
const BIO_INTRO_RE = /^[\p{L}\p{M}][\p{L}\p{M}''\-]*(?:\s+[\p{L}\p{M}][\p{L}\p{M}''\-]*){0,5}\s*\([^)]*\d{3,4}[^)]*\)\s*[—-]\s*/u;
function looksLikeBioIntro(cleaned) {
  return BIO_INTRO_RE.test(cleaned);
}

// A complete quote shouldn't end mid-clause. Allowed endings: letters/digits,
// closing quote marks, sentence-final punctuation (. ! ? …), closing brackets.
// Not allowed: any dash (\p{Pd} covers -, –, —, and other scripts' dashes),
// comma, colon, semicolon — these signal a truncated fragment, not a complete
// quote. Includes CJK fullwidth punctuation for forward-compatibility with
// languages not yet in the registry.
const BAD_ENDING_RE = /[\p{Pd},:;，：；]\s*$/u;
function endsWithBadPunctuation(cleaned) {
  return BAD_ENDING_RE.test(cleaned);
}

// A courtroom-transcript-style bullet with several "Speaker: line" turns
// concatenated into one entry — technically real text, but not a single quote.
function looksLikeDialogueTranscript(cleaned) {
  const matches = cleaned.match(/\b[\p{Lu}][\p{L}\p{M}''-]{1,24}:\s/gu);
  return !!matches && matches.length >= 2;
}

// Very short fragments containing an ellipsis tend to be template/documentation
// placeholder examples ("Sprichwort-Text" - Aus …land) rather than real quotes.
// Narrow and imperfect on purpose — better to under-filter here than to risk
// cutting genuine short quotes that happen to use "…".
function looksLikePlaceholderFragment(cleaned) {
  return /…/.test(cleaned) && cleaned.split(/\s+/).length < 8;
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
    if (!/\p{L}/u.test(cleaned)) continue;
    if (looksLikeBibliography(cleaned)) continue;
    if (looksLikeExternalLinkLine(cleaned)) continue;
    if (looksLikeBioIntro(cleaned)) continue;
    if (endsWithBadPunctuation(cleaned)) continue;
    if (looksLikeDialogueTranscript(cleaned)) continue;
    if (looksLikePlaceholderFragment(cleaned)) continue;
    result.push(cleaned);
  }
  return result;
}

async function getQuote() {
  if (fetchInFlight) return; // guard against overlapping calls
  fetchInFlight = true;

  // capture the UI language *now*, so late-resolving status text always
  // matches the tab the user actually clicked, even if they somehow switch
  // language mid-request (tabs are also disabled below as a second guard).
  const localT = (key) => t(key);

  const getBtn = document.getElementById('getBtn');
  const quoteEl = document.getElementById('quote');
  getBtn.disabled = true;
  quoteEl.classList.add('placeholder');
  quoteEl.textContent = localT('loading');
  setSourceLink(null);

  currentAbortController = new AbortController();
  const signal = currentAbortController.signal;

  const code = pickWikiCode();
  const maxAttempts = 20;
  let attempts = 0;

  try {
    while (attempts < maxAttempts) {
      attempts++;
      try {
        const title = await fetchRandomTitle(code, signal);
        const wikitext = await fetchWikitext(code, title, signal);
        if (!wikitext || /^#REDIRECT/i.test(wikitext.trim())) continue;
        const candidates = extractQuoteLines(wikitext, title);
        const fresh = candidates.filter(c => !wasRecentlyShown(c));
        const pool = fresh.length > 0 ? fresh : candidates; // fall back to repeats if the whole page is exhausted
        if (pool.length > 0) {
          const quote = pool[Math.floor(Math.random() * pool.length)];
          rememberQuote(quote);
          quoteEl.classList.remove('placeholder');
          quoteEl.textContent = quote;
          setSourceLink(buildSourceUrl(code, title));
          fetchInFlight = false;
          getBtn.disabled = false;
          return;
        }
      } catch (err) {
        if (err.name === 'AbortError') throw err; // propagate, don't retry an intentionally cancelled request
        console.warn('[wikiquote] attempt failed, retrying:', err.message || err);
        await sleep(150 + Math.random() * 200);
        continue;
      }
    }
    quoteEl.textContent = localT('notFound');
  } catch (err) {
    if (err.name !== 'AbortError') {
      console.error('[wikiquote] getQuote aborted unexpectedly:', err);
      quoteEl.textContent = localT('error');
    }
  } finally {
    fetchInFlight = false;
    getBtn.disabled = false;
    currentAbortController = null;
  }
}

document.getElementById('getBtn').addEventListener('click', getQuote);

document.getElementById('copyBtn').addEventListener('click', () => {
  const text = document.getElementById('quote').textContent;
  navigator.clipboard.writeText(text).catch(() => {});
});

// --- PWA install prompt: only ever surfaced on mobile devices ---
function isMobileDevice() {
  if (navigator.userAgentData && typeof navigator.userAgentData.mobile === 'boolean') {
    return navigator.userAgentData.mobile;
  }
  return /Android|iPhone|iPad|iPod|Mobi/i.test(navigator.userAgent);
}

function isIOS() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPadOS reports as Mac
}

function isStandaloneAlready() {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

let deferredInstallPrompt = null;

function showInstallBanner({ text, actionLabel, onAction }) {
  const banner = document.getElementById('installBanner');
  const textEl = document.getElementById('installBannerText');
  const actionEl = document.getElementById('installBannerAction');
  const closeEl = document.getElementById('installBannerClose');

  textEl.textContent = text;
  actionEl.textContent = actionLabel || '';

  const hide = () => banner.classList.remove('visible');
  actionEl.onclick = () => { if (onAction) onAction(); hide(); };
  closeEl.onclick = hide;

  banner.classList.add('visible');
}

// Android/Chrome-family: browser fires this before showing its own mini-infobar.
// We suppress the default and show our own banner instead, but only on mobile.
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  if (!isMobileDevice() || isStandaloneAlready()) return;
  showInstallBanner({
    text: t('installPrompt'),
    actionLabel: t('installAction'),
    onAction: () => {
      deferredInstallPrompt.prompt();
      deferredInstallPrompt = null;
    },
  });
});

// iOS Safari never fires beforeinstallprompt — there is no programmatic
// install API there, so the best we can do is a one-time instructional hint.
window.addEventListener('load', () => {
  if (isIOS() && isMobileDevice() && !isStandaloneAlready()) {
    showInstallBanner({ text: t('iosInstallPrompt'), actionLabel: '', onAction: null });
  }
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch((err) => {
      console.warn('[wikiquote] service worker registration failed:', err);
    });
  });
}

// --- init ---
currentLang = detectDefaultLang();
renderLangTabs();
applyUILang();
