const SPELL_SECTION_SELECTORS = [
  ".talent-tab .spells",
  ".tab[data-tab='talent'] .spells",
  ".tab[data-tab='talents'] .spells",
  "[data-tab='talent'] .spells",
  "[data-tab='talents'] .spells",
  ".spells[data-application-part]"
];

const NAVIGATION_SELECTORS = [
  ".sheet-tabs",
  "nav.tabs",
  "[data-application-part='tabs']"
];

export function unwrapHtml(html) {
  if (html instanceof HTMLElement) return html;
  if (html?.[0] instanceof HTMLElement) return html[0];
  return null;
}

export function findSheetNavigation(html) {
  const sheet = unwrapHtml(html);
  if (!sheet) return null;
  return NAVIGATION_SELECTORS.map((selector) => sheet.querySelector(selector)).find(Boolean) ?? null;
}

export function resolveActorSheetTargets(app, html) {
  const sheet = unwrapHtml(html);
  const appElement = unwrapHtml(app?.element);
  const root = sheet?.closest?.(".window-app, .application") ?? appElement ?? null;
  if (!sheet || !root) return { root: null, section: null, talentTab: null, navigation: null };

  let section = null;
  for (const selector of SPELL_SECTION_SELECTORS) {
    section = sheet.querySelector(selector);
    if (section) break;
  }

  if (!section) {
    const candidate = [...sheet.querySelectorAll(".spells")].find((node) => {
      const tab = node.closest("[data-tab], .talent-tab");
      const name = String(tab?.dataset?.tab ?? tab?.className ?? "").toLocaleLowerCase();
      return name.includes("talent");
    });
    section = candidate ?? null;
  }

  const talentTab = section?.closest?.(".talent-tab, [data-tab='talent'], [data-tab='talents']") ?? null;
  return { root, section, talentTab, navigation: findSheetNavigation(sheet) };
}
