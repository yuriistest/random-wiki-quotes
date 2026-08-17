/**
 * Language registry for the Wikiquote random-quote generator.
 *
 * To add a new language:
 *   1. Add a new entry below with a unique key (ISO 639-1 code, e.g. "fr").
 *   2. Fill in wikiCode (the <code>.wikiquote.org subdomain) and the `ui` strings.
 *   3. Optionally fill in skipSectionWords / externalLinkPhrases / bibliographyWords /
 *      pageUnitAbbrev to improve junk filtering for that language's Wikiquote edition.
 *      These are OPTIONAL — if omitted, filtering still works via language-agnostic
 *      structural heuristics (ISBN, domain names, pure wikilinks), just slightly noisier.
 *   4. Nothing else needs to change — tabs, filters and API calls all read from this file.
 *
 * The special key "any" must always exist: it has no wikiCode (a random real
 * language is picked per request) and is not included in the union of filter word lists.
 */

const LANGUAGES = {
  uk: {
    tabLabel: 'УКР',
    wikiCode: 'uk',
    ui: {
      getBtn: 'ОТРИМАТИ ЦИТАТУ',
      placeholder: "тут з'явиться цитата з Wikiquote",
      loading: 'завантаження...',
      notFound: 'не вдалося знайти цитату, спробуйте ще раз',
      error: 'помилка запиту, спробуйте ще раз',
    },
    skipSectionWords: [
      'джерела', 'бібліографія', 'посилання', 'зовнішні посилання',
      'примітки', 'виноски', 'література', 'див\\.?\\s*також',
    ],
    externalLinkPhrases: ['на сайті'],
    bibliographyWords: [
      'Вступна стаття', 'Упорядкував', 'Переклад(ач)?:', 'Зібрані твори',
      'Видавництво', 'Наклад',
    ],
    pageUnitAbbrev: ['с\\.', 'стор\\.'],
  },

  de: {
    tabLabel: 'DEU',
    wikiCode: 'de',
    ui: {
      getBtn: 'ZITAT HOLEN',
      placeholder: 'hier erscheint ein Zitat von Wikiquote',
      loading: 'lädt...',
      notFound: 'kein Zitat gefunden, bitte erneut versuchen',
      error: 'Fehler bei der Anfrage, bitte erneut versuchen',
    },
    skipSectionWords: [
      'quellen', 'weblinks', 'einzelnachweise', 'literatur', 'siehe auch',
    ],
    externalLinkPhrases: ['auf der (Website|Seite)'],
    bibliographyWords: ['Herausgeg(eben)?', 'Auflage', 'Verlag'],
    pageUnitAbbrev: ['S\\.'],
  },

  en: {
    tabLabel: 'ENG',
    wikiCode: 'en',
    ui: {
      getBtn: 'GET QUOTE',
      placeholder: 'a quote from Wikiquote will appear here',
      loading: 'loading...',
      notFound: 'no quote found, try again',
      error: 'request failed, try again',
    },
    skipSectionWords: [
      'external links?', 'see also', 'references?', 'notes?', 'sources?',
      'about', 'bibliography', 'further reading', 'citations?',
    ],
    externalLinkPhrases: ['on the site'],
    bibliographyWords: ['Editor', 'Publisher', 'Translated by'],
    pageUnitAbbrev: ['pp?\\.'],
  },
};

// Language-agnostic fallback words, always included regardless of which
// languages are configured above (some Wikiquote editions borrow English
// heading names even on non-English wikis).
const CORE_SKIP_SECTION_WORDS = [
  'external links?', 'see also', 'references?', 'notes?', 'sources?', 'about',
];
const CORE_PAGE_UNIT_ABBREV = ['p\\.', 'pp\\.'];
