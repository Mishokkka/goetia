function localize(key, fallback) {
  const value = game.i18n.localize(key);
  return value === key ? fallback : value;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function spellSystem(spell) {
  return spell?.system ?? spell?.item?.system ?? {};
}

export function displaySpellName(spell) {
  const value = typeof spell === "string" ? spell : spell?.name ?? spell?.item?.name;
  return String(value ?? "").replace(/^\s*\d+\s*[-–—:]\s*/, "").trim();
}

export function spellPlainText(value, maxLength = 520) {
  const template = document.createElement("template");
  template.innerHTML = String(value ?? "");
  const text = String(template.content.textContent ?? "").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}…` : text;
}

export function spellTooltipMarkup(spell) {
  const system = spellSystem(spell);
  const description = spellPlainText(system.description);
  return `<article class="gg-spell-tooltip-card">
    <h3>${escapeHtml(displaySpellName(spell))}</h3>
    <div class="gg-spell-tooltip-meta">
      <span><b>${escapeHtml(localize("GG.Rank", "Rank"))}</b>${escapeHtml(system.rank ?? spell?.rank ?? "")}</span>
      <span><b>${escapeHtml(localize("GG.Range", "Range"))}</b>${escapeHtml(system.range ?? "")}</span>
      <span><b>${escapeHtml(localize("GG.Duration", "Duration"))}</b>${escapeHtml(system.duration ?? "")}</span>
      <span><b>${escapeHtml(localize("GG.Ingredient", "Ingredient"))}</b>${escapeHtml(system.ingredient ?? "")}</span>
    </div>
    ${description ? `<p>${escapeHtml(description)}</p>` : ""}
  </article>`;
}
