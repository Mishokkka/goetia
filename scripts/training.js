import { ITEM_ROLES, MODULE_ID, isMagicTalent, normalizeName, trainingSourceId } from "./config.js";
import { createSpellSigil, normalizeSigilForDisplay, sigilToSvgMarkup } from "./sigil.js";
import { spellTooltipMarkup } from "./spell-tooltip.js";
import { bindDelayedSpellTooltip } from "./ui-interactions.js";
import { evaluateYearZeroRoll, getYearZeroRollClass, yearZeroSuccesses } from "./year-zero-roll.js";
import { drawConfiguredMishapTable, normalizeMishapLevel } from "./mishap-service.js";

const CATALOG_URL = `modules/${MODULE_ID}/data/training-catalog.json`;
const GENERAL_PATH_ID = "general";
const SPELL_XP = Object.freeze({ 1: 1, 2: 1, 3: 3, 4: 5, 5: 7 });
const TALENT_XP = Object.freeze({ 1: 5, 2: 5, 3: 10, 4: 15, 5: 25 });
const sigilCache = new Map();
const pathSigilCache = new Map();
let catalogPromise = null;

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

function stripTags(value) {
  const container = document.createElement("div");
  container.innerHTML = String(value ?? "");
  return String(container.textContent ?? "").replace(/\s+/g, " ").trim();
}

function spellName(value) {
  const name = typeof value === "string" ? value : value?.name;
  return String(name ?? "").replace(/^\s*\d+\s*[-–—:]\s*/, "").trim();
}

function normalizedSpellName(value) {
  return normalizeName(spellName(value));
}

function integer(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.floor(number) : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function randomId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  if (foundry.utils?.randomID) return foundry.utils.randomID(24);
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

async function getCatalog() {
  catalogPromise ??= (async () => {
    const loader = foundry.utils?.fetchJsonWithTimeout;
    const data = loader ? await loader(CATALOG_URL) : await fetch(CATALOG_URL).then((response) => response.json());
    const paths = Array.isArray(data?.paths) ? data.paths : [];
    const spells = Array.isArray(data?.spells) ? data.spells : [];
    const spellNameCounts = new Map();
    for (const entry of spells) {
      const name = normalizedSpellName(entry.name);
      spellNameCounts.set(name, (spellNameCounts.get(name) ?? 0) + 1);
    }
    return {
      paths,
      spells,
      pathById: new Map(paths.map((entry) => [entry.id, entry])),
      spellsById: new Map(spells.map((entry) => [entry.id, entry])),
      spellNameCounts
    };
  })().catch((error) => {
    catalogPromise = null;
    throw error;
  });
  return catalogPromise;
}

function trainingFlag(actor) {
  const source = actor.getFlag(MODULE_ID, "training");
  return source && typeof source === "object" && !Array.isArray(source)
    ? foundry.utils.deepClone(source)
    : {};
}

async function updateTrainingFlag(actor, patch) {
  const next = { ...trainingFlag(actor), ...patch };
  await actor.update({ [`flags.${MODULE_ID}.training`]: next }, { render: false, diff: true });
  return next;
}

function actorXp(actor) {
  return Math.max(0, integer(actor.system?.bio?.experience?.value));
}

function actorCurrency(actor) {
  return {
    gold: Math.max(0, integer(actor.system?.currency?.gold?.value)),
    silver: Math.max(0, integer(actor.system?.currency?.silver?.value)),
    copper: Math.max(0, integer(actor.system?.currency?.copper?.value))
  };
}

function currencyToCopper(currency) {
  return currency.gold * 100 + currency.silver * 10 + currency.copper;
}

function currencyFromCopper(total) {
  const safe = Math.max(0, integer(total));
  const gold = Math.floor(safe / 100);
  const remaining = safe - gold * 100;
  const silver = Math.floor(remaining / 10);
  return { gold, silver, copper: remaining - silver * 10 };
}

function currencyMarkup(currency) {
  return `<span><b>${currency.gold}</b> G</span><span><b>${currency.silver}</b> S</span><span><b>${currency.copper}</b> C</span>`;
}

function pathCatalogEntryForItem(item, catalog) {
  const id = trainingSourceId(item);
  if (id && catalog.pathById.has(id)) return catalog.pathById.get(id);
  const documentSources = [item?.flags?.core?.sourceId, item?._stats?.compendiumSource].filter(Boolean);
  for (const documentSource of documentSources) {
    const sourceDocumentId = String(documentSource).split(".").pop();
    if (catalog.pathById.has(sourceDocumentId)) return catalog.pathById.get(sourceDocumentId);
  }
  const normalized = normalizeName(item?.name);
  const exact = catalog.paths.find((entry) => normalizeName(entry.name) === normalized);
  if (exact) return exact;

  const normalizedLabel = normalizeName(pathLabel(item));
  const byLabel = catalog.paths.find((entry) => normalizeName(pathLabel(entry)) === normalizedLabel);
  if (byLabel) return byLabel;

  const flaggedDiscipline = item?.getFlag?.(MODULE_ID, "trainingDiscipline")
    ?? item?.flags?.[MODULE_ID]?.trainingDiscipline
    ?? null;
  if (flaggedDiscipline) {
    const byFlag = catalog.paths.find((entry) => normalizeName(entry.discipline) === normalizeName(flaggedDiscipline));
    if (byFlag) return byFlag;
  }

  const description = normalizeName(stripTags(item?.system?.description));
  if (description) {
    const candidates = catalog.paths.filter((entry) => description.includes(normalizeName(entry.discipline)));
    if (candidates.length === 1) return candidates[0];
  }
  return null;
}

function knownPathRecords(actor, catalog) {
  return actor.items
    .filter((item) => item.type === "talent" && isMagicTalent(item))
    .map((item) => ({ item, catalog: pathCatalogEntryForItem(item, catalog) }))
    .sort((first, second) => first.item.name.localeCompare(second.item.name, game.i18n.lang));
}

function spellDiscipline(item) {
  return item?.getFlag?.(MODULE_ID, "trainingDiscipline")
    ?? item?.flags?.[MODULE_ID]?.trainingDiscipline
    ?? item?.flags?.["spell-compendium-builder"]?.discipline
    ?? null;
}

function knownSpellMaps(actor, catalog) {
  const bySource = new Map();
  const byName = new Map();
  const byNameAndDiscipline = new Map();
  for (const item of actor.items.filter((entry) => entry.type === "spell")) {
    const id = trainingSourceId(item);
    if (id) bySource.set(id, item);
    const name = normalizedSpellName(item);
    const discipline = spellDiscipline(item);
    if (discipline) byNameAndDiscipline.set(`${name}::${normalizeName(discipline)}`, item);
    if ((catalog?.spellNameCounts?.get(name) ?? 1) === 1) byName.set(name, item);
  }
  return { bySource, byName, byNameAndDiscipline };
}

function knownSpellItem(entry, maps) {
  const name = normalizedSpellName(entry.name);
  const disciplineKey = `${name}::${normalizeName(entry.discipline)}`;
  return maps.bySource.get(entry.id) ?? maps.byNameAndDiscipline.get(disciplineKey) ?? maps.byName.get(name) ?? null;
}

function pathCurrentRank(record) {
  if (!record?.item) return 0;
  return clamp(integer(record.item.system?.rank, 1), 1, 5);
}

function highestKnownPathRank(records) {
  return records.reduce((highest, record) => Math.max(highest, pathCurrentRank(record)), 0);
}

function countTalents(actor) {
  return actor.items.filter((item) => item.type === "talent").length;
}

function pathXpCost(actor, rank, state, includeNewTalent = false) {
  const base = TALENT_XP[rank] ?? TALENT_XP[5];
  const totalTalents = countTalents(actor) + (includeNewTalent ? 1 : 0);
  const excess = Math.max(0, totalTalents - 5);
  const cap = state.cap ? 5 : 0;
  const xcap = state.xcap ? 2 : 1;
  return (base + excess + cap) * 2 * xcap;
}

function spellXpCost(rank) {
  return SPELL_XP[rank] ?? SPELL_XP[5];
}

function casterAllows(caster, pathCaster) {
  if (!caster) return false;
  return pathCaster === "both" || pathCaster === caster;
}

function pathLabel(entry) {
  return String(entry?.name ?? "").replace(/^\((?:S\/D|S|D)\)\s*/i, "").trim();
}

function pathSigilMarkup(entry) {
  const identity = entry?.id ?? normalizeName(entry?.name) ?? "unknown";
  let sigil = pathSigilCache.get(identity);
  if (!sigil) {
    sigil = normalizeSigilForDisplay(createSpellSigil(`goetia:path:${identity}`, 5));
    pathSigilCache.set(identity, sigil);
    if (pathSigilCache.size > 100) pathSigilCache.delete(pathSigilCache.keys().next().value);
  }
  return sigilToSvgMarkup(sigil, { className: "gg-training-path-sigil-svg" });
}

function spellSigilMarkup(actor, entry) {
  const key = `${actor.uuid}:${entry.id}:${entry.rank}`;
  let sigil = sigilCache.get(key);
  if (!sigil) {
    sigil = normalizeSigilForDisplay(createSpellSigil(`${actor.uuid}:training:${entry.id}:`, entry.rank));
    sigilCache.set(key, sigil);
    if (sigilCache.size > 600) sigilCache.delete(sigilCache.keys().next().value);
  }
  return sigilToSvgMarkup(sigil, { className: "gg-training-sigil-svg" });
}

function targetName(selection, catalog) {
  if (!selection) return "";
  if (selection.kind === "spell") return spellName(catalog.spellsById.get(selection.targetId)?.name);
  const path = catalog.pathById.get(selection.pathId);
  if (selection.kind === "path") return pathLabel(path);
  return `${pathLabel(path)}, ${localize("GG.Rank", "Rank")} ${selection.targetRank}`;
}

function selectedPathRecord(runtime, records, catalog) {
  const id = runtime.trainingSelectedPathId;
  if (id === GENERAL_PATH_ID) return { general: true, item: null, catalog: null };
  const existing = records.find((record) => record.catalog?.id === id || record.item.id === id);
  if (existing) return existing;
  const catalogPath = catalog.pathById.get(id);
  if (catalogPath) return { item: null, catalog: catalogPath, newPath: true };
  return records[0] ?? { general: true, item: null, catalog: null };
}

function ensureRuntimeState(runtime, records) {
  if (runtime.trainingSelectedPathId === undefined) {
    runtime.trainingSelectedPathId = records[0]?.catalog?.id ?? records[0]?.item?.id ?? GENERAL_PATH_ID;
  } else if (!runtime.trainingNewPathMode && runtime.trainingSelectedPathId === null) {
    runtime.trainingSelectedPathId = records[0]?.catalog?.id ?? records[0]?.item?.id ?? GENERAL_PATH_ID;
  }
  runtime.trainingSelectedRank = clamp(integer(runtime.trainingSelectedRank, 1), 1, 5);
  runtime.trainingSelection ??= null;
  runtime.trainingSetupOpen ??= false;
  runtime.trainingNewPathMode ??= false;
}

function leftPathMarkup(record, selectedId, activeProject) {
  const id = record.catalog?.id ?? record.item.id;
  const selected = id === selectedId;
  const rank = pathCurrentRank(record);
  const active = activeProject?.pathId === id;
  return `<button type="button" class="gg-training-path ${selected ? "is-selected" : ""} ${active ? "has-project" : ""}" data-training-path="${escapeHtml(id)}">
    <span class="gg-training-path-icon">${pathSigilMarkup(record.catalog ?? { id, name: record.item.name })}</span>
    <span class="gg-training-path-name">${escapeHtml(pathLabel(record.catalog ?? record.item))}</span>
    <span class="gg-training-path-rank">${rank}</span>
  </button>`;
}

function availableNewPaths(state, records, catalog) {
  const known = new Set(records.map((record) => record.catalog?.id).filter(Boolean));
  return catalog.paths.filter((entry) => casterAllows(state.caster, entry.caster) && !known.has(entry.id));
}

function rankTabsMarkup({ currentRank, selectedRank, general, maximumGeneralRank }) {
  return Array.from({ length: 5 }, (_, index) => index + 1).map((rank) => {
    const learned = !general && rank <= currentRank;
    const next = !general && rank === currentRank + 1 && rank <= 5;
    const availableGeneral = general && rank <= maximumGeneralRank;
    const locked = general ? !availableGeneral : !(learned || next);
    const classes = [rank === selectedRank ? "is-selected" : "", learned ? "is-learned" : "", next ? "is-next" : "", locked ? "is-locked" : ""].filter(Boolean).join(" ");
    const suffix = next ? `<i class="fa-solid fa-plus" aria-hidden="true"></i>` : learned ? `<i class="fa-solid fa-check" aria-hidden="true"></i>` : "";
    return `<button type="button" class="gg-training-rank ${classes}" data-training-rank="${rank}" ${locked ? "disabled" : ""}><span>${rank}</span>${suffix}</button>`;
  }).join("");
}

function selectionSummaryMarkup(selection, catalog, actor, state) {
  if (!selection) return "";
  const rank = clamp(integer(selection.targetRank, 1), 1, 5);
  const cost = selection.kind === "spell" ? spellXpCost(rank) : pathXpCost(actor, rank, state, selection.kind === "path");
  return `<section class="gg-training-selection">
    <div><span>${escapeHtml(localize("GG.TrainingSelected", "Selected"))}</span><strong>${escapeHtml(targetName(selection, catalog))}</strong></div>
    <div class="gg-training-selection-cost"><b>${cost}</b> XP</div>
    <button type="button" class="gg-training-learn" data-training-action="prepare">${escapeHtml(localize("GG.Learn", "LEARN"))}</button>
  </section>`;
}

function setupMarkup(selection, catalog, actor, state) {
  if (!selection) return "";
  const rank = clamp(integer(selection.targetRank, 1), 1, 5);
  const cost = selection.kind === "spell" ? spellXpCost(rank) : pathXpCost(actor, rank, state, selection.kind === "path");
  const spell = selection.kind === "spell" ? catalog.spellsById.get(selection.targetId) : null;
  const researchSilver = selection.kind === "spell" ? cost * 5 : 0;
  const target = targetName(selection, catalog);
  const pathOrRank = selection.kind !== "spell";
  return `<div class="gg-training-setup-backdrop" data-training-action="close-setup">
    <form class="gg-training-setup" data-training-setup-form data-training-method-state="teacher">
      <button type="button" class="gg-training-setup-close" data-training-action="close-setup">×</button>
      <h3>${escapeHtml(localize("GG.TrainingPrepare", "Prepare training"))}</h3>
      <p class="gg-training-setup-target">${escapeHtml(target)}</p>
      <div class="gg-training-cost-breakdown"><span>${escapeHtml(localize("GG.TrainingXpCost", "XP cost"))}</span><b>${cost} XP</b></div>
      ${pathOrRank ? `<label class="gg-training-check"><input type="checkbox" name="hasTeacher"><span>${escapeHtml(localize("GG.HasTeacher", "There is a teacher"))}</span></label>
        <p>${escapeHtml(localize("GG.TeacherManualHint", "The player states whether a suitable teacher is available. The module does not verify the teacher."))}</p>
        ${rank >= 4 ? `<p class="gg-training-attempt-price">${escapeHtml(localize("GG.NoTeacherAttemptCost", "Without a teacher, each attempt costs"))}: <b>${rank} S</b>.</p>` : ""}` : `<fieldset class="gg-training-methods">
          <legend>${escapeHtml(localize("GG.TrainingMethod", "Training method"))}</legend>
          <label><input type="radio" name="method" value="teacher" checked><span>${escapeHtml(localize("GG.MethodTeacher", "Teacher"))}</span></label>
          <label><input type="radio" name="method" value="source"><span>${escapeHtml(localize("GG.MethodSource", "Notes / source"))}</span></label>
          <label><input type="radio" name="method" value="research"><span>${escapeHtml(localize("GG.MethodResearch", "Independent research"))}</span></label>
        </fieldset>
        <label class="gg-training-source-quality" data-training-method-only="source"><span>${escapeHtml(localize("GG.SourceQuality", "Source quality"))}</span><input type="number" name="sourceQuality" min="-5" max="10" value="2"></label>
        <p class="gg-training-research-price" data-training-method-only="research">${escapeHtml(localize("GG.ResearchIngredients", "Research ingredients"))}: <b>${researchSilver} S</b>. ${escapeHtml(localize("GG.IngredientsPersist", "They are purchased once and remain after failed attempts."))}</p>
        <p class="gg-training-spell-rules">${escapeHtml(localize("GG.TrainingSpellRank", "Spell rank"))}: ${rank}. ${escapeHtml(spell?.discipline ?? "")}</p>`}
      <div class="gg-training-setup-actions">
        <button type="button" data-training-action="close-setup">${escapeHtml(localize("GG.Cancel", "Cancel"))}</button>
        <button type="submit">${escapeHtml(localize("GG.StartTraining", "START TRAINING"))}</button>
      </div>
    </form>
  </div>`;
}

function projectTargetName(project) {
  return project?.targetName ?? localize("GG.Training", "Training");
}

function projectMarkup(project) {
  if (!project) return "";
  const complete = integer(project.successes) >= integer(project.requiredSuccesses, 1);
  const methodKey = {
    teacher: localize("GG.MethodTeacher", "Teacher"),
    source: localize("GG.MethodSource", "Notes / source"),
    research: localize("GG.MethodResearch", "Independent research")
  }[project.method] ?? project.method;
  return `<section class="gg-training-project ${complete ? "is-ready" : ""}">
    <header><span>${escapeHtml(localize("GG.ActiveTraining", "Active training"))}</span><strong>${escapeHtml(projectTargetName(project))}</strong></header>
    <div class="gg-training-project-grid">
      <div><span>${escapeHtml(localize("GG.TrainingMethod", "Method"))}</span><b>${escapeHtml(methodKey)}</b></div>
      <div><span>${escapeHtml(localize("GG.Attempts", "Attempts"))}</span><b>${integer(project.attempts)}</b></div>
      <div><span>${escapeHtml(localize("GG.Progress", "Progress"))}</span><b>${integer(project.successes)} / ${integer(project.requiredSuccesses, 1)}</b></div>
      <div><span>${escapeHtml(localize("GG.QuarterDays", "Quarter days"))}</span><b>${integer(project.quarterDays)}</b></div>
      ${integer(project.attemptSilverCost) > 0 ? `<div><span>${escapeHtml(localize("GG.AttemptCost", "Cost per attempt"))}</span><b>${integer(project.attemptSilverCost)} S</b></div>` : ""}
    </div>
    <div class="gg-training-project-actions">
      <button type="button" data-training-action="cancel-project">${escapeHtml(localize("GG.CancelTraining", "Cancel"))}</button>
      <button type="button" class="is-primary" data-training-action="attempt">${escapeHtml(project.method === "teacher" ? localize("GG.CompleteQuarterDay", "COMPLETE QUARTER DAY") : complete ? localize("GG.CompleteTraining", "COMPLETE TRAINING") : localize("GG.MakeAttempt", "MAKE ATTEMPT"))}</button>
    </div>
  </section>`;
}

function pathPickerMarkup(paths) {
  return `<section class="gg-training-picker">
    <h2>${escapeHtml(localize("GG.NewMagicPath", "New magic path"))}</h2>
    ${paths.length ? `<div class="gg-training-picker-grid">${paths.map((entry) => `<button type="button" data-training-new-path="${escapeHtml(entry.id)}"><span class="gg-training-picker-sigil">${pathSigilMarkup(entry)}</span><span>${escapeHtml(pathLabel(entry))}</span><small>${escapeHtml(entry.caster === "both" ? "S/D" : entry.caster === "druid" ? "D" : "S")}</small></button>`).join("")}</div>` : `<p class="gg-training-empty">${escapeHtml(localize("GG.NoAvailablePaths", "No available paths for the selected caster type."))}</p>`}
  </section>`;
}

function spellGridMarkup({ actor, path, selectedRank, currentRank, general, highestRank, knownMaps, selection, activeProject, catalog }) {
  const pathEntry = path?.catalog ?? path;
  const discipline = general ? "General Spells" : pathEntry?.discipline;
  const normalizedDiscipline = normalizeName(discipline);
  const spells = catalog.spells.filter((entry) => normalizeName(entry.discipline) === normalizedDiscipline && entry.rank === selectedRank);
  const pathKnown = !path?.newPath;
  const eligibleRank = general ? highestRank > 0 && selectedRank <= highestRank + 1 : pathKnown && selectedRank <= currentRank + 1;
  return `<div class="gg-training-spell-grid">${spells.map((entry) => {
    const known = Boolean(knownSpellItem(entry, knownMaps));
    const selected = selection?.kind === "spell" && selection.targetId === entry.id;
    const active = activeProject?.kind === "spell" && activeProject.targetId === entry.id;
    const eligible = !known && eligibleRank && !activeProject;
    const classes = [known ? "is-known" : "", eligible ? "is-eligible" : "is-locked", selected ? "is-selected" : "", active ? "has-project" : ""].filter(Boolean).join(" ");
    const unavailable = known || !eligible;
    return `<button type="button" class="gg-training-spell ${classes}" data-training-spell="${escapeHtml(entry.id)}" aria-disabled="${String(unavailable)}">
      <span class="gg-training-sigil">${spellSigilMarkup(actor, entry)}</span>
      <span class="gg-training-spell-name">${escapeHtml(spellName(entry.name))}</span>
      ${known ? `<i class="fa-solid fa-check" aria-hidden="true"></i>` : active ? `<i class="fa-solid fa-hourglass-half" aria-hidden="true"></i>` : ""}
    </button>`;
  }).join("") || `<p class="gg-training-empty">${escapeHtml(localize("GG.NoSpells", "No spells"))}</p>`}</div>`;
}

export async function trainingMarkup(runtime) {
  const catalog = await getCatalog();
  runtime.trainingCatalog = catalog;
  const actor = runtime.actor;
  const state = trainingFlag(actor);
  const records = knownPathRecords(actor, catalog);
  const knownMaps = knownSpellMaps(actor, catalog);
  ensureRuntimeState(runtime, records);
  const activeProject = state.activeProject ?? null;
  const current = selectedPathRecord(runtime, records, catalog);
  const general = Boolean(current.general);
  const path = current.catalog;
  const currentRank = general ? 0 : pathCurrentRank(current);
  const highestRank = highestKnownPathRank(records);
  const maximumGeneralRank = clamp(highestRank + 1, 1, 5);
  if (!general && runtime.trainingSelectedRank > Math.max(1, currentRank + 1)) runtime.trainingSelectedRank = Math.max(1, currentRank + 1);
  if (general && runtime.trainingSelectedRank > maximumGeneralRank) runtime.trainingSelectedRank = maximumGeneralRank;
  const selection = runtime.trainingSelection;
  const newPaths = availableNewPaths(state, records, catalog);
  const selectedId = runtime.trainingNewPathMode && runtime.trainingSelectedPathId === null
    ? null
    : general ? GENERAL_PATH_ID : path?.id ?? current.item?.id;

  const left = `<aside class="gg-training-left">
    <div class="gg-training-resources">
      <div><span>${escapeHtml(localize("GG.AvailableXp", "Available XP"))}</span><strong>${actorXp(actor)}</strong></div>
      <div class="gg-training-wallet"><span>${escapeHtml(localize("GG.Wallet", "Wallet"))}</span><strong>${currencyMarkup(actorCurrency(actor))}</strong></div>
    </div>
    <div class="gg-training-switches">
      <label><input type="checkbox" data-training-setting="cap" ${state.cap ? "checked" : ""}><span>CAP</span></label>
      <label><input type="checkbox" data-training-setting="xcap" ${state.xcap ? "checked" : ""}><span>XCAP</span></label>
    </div>
    <div class="gg-training-caster">
      <span>${escapeHtml(localize("GG.CasterType", "Caster"))}</span>
      <label><input type="checkbox" data-training-caster="druid" ${state.caster === "druid" ? "checked" : ""}><span>${escapeHtml(localize("GG.Druid", "Druid"))}</span></label>
      <label><input type="checkbox" data-training-caster="sorcerer" ${state.caster === "sorcerer" ? "checked" : ""}><span>${escapeHtml(localize("GG.Sorcerer", "Sorcerer"))}</span></label>
    </div>
    <div class="gg-training-paths">
      <h3>${escapeHtml(localize("GG.Paths", "Paths"))}</h3>
      ${records.map((record) => leftPathMarkup(record, selectedId, activeProject)).join("")}
      <button type="button" class="gg-training-path gg-training-general ${selectedId === GENERAL_PATH_ID ? "is-selected" : ""}" data-training-path="${GENERAL_PATH_ID}"><span class="gg-training-path-icon">${pathSigilMarkup({ id: GENERAL_PATH_ID, name: "General Spells" })}</span><span class="gg-training-path-name">${escapeHtml(localize("GG.GeneralSpells", "General spells"))}</span></button>
      <button type="button" class="gg-training-add-path" data-training-action="new-path" ${!state.caster || activeProject ? "disabled" : ""}><i class="fa-solid fa-plus"></i><span>${escapeHtml(localize("GG.NewPath", "New path"))}</span></button>
    </div>
  </aside>`;

  let body;
  if (runtime.trainingNewPathMode && !runtime.trainingSelectedPathId) body = pathPickerMarkup(newPaths);
  else if (runtime.trainingNewPathMode && runtime.trainingSelectedPathId && current.newPath) {
    body = `<section class="gg-training-path-detail">
      <header><div>${pathSigilMarkup(path)}</div><span>${escapeHtml(path?.caster === "both" ? "S/D" : path?.caster === "druid" ? "D" : "S")}</span><h2>${escapeHtml(pathLabel(path))}</h2></header>
      <p class="gg-training-new-path-note">${escapeHtml(localize("GG.NewPathSelected", "This path will be learned at rank 1."))}</p>
      ${spellGridMarkup({ actor, path: current, selectedRank: 1, currentRank: 0, general: false, highestRank, knownMaps, selection, activeProject, catalog })}
    </section>`;
  } else {
    const title = general ? localize("GG.GeneralSpells", "General spells") : pathLabel(path ?? current.item);
    body = `<section class="gg-training-path-detail">
      <header><div>${pathSigilMarkup(general ? { id: GENERAL_PATH_ID, name: "General Spells" } : path ?? { id: current.item?.id, name: current.item?.name })}</div><span>${general ? "GENERAL" : escapeHtml(path?.caster === "both" ? "S/D" : path?.caster === "druid" ? "D" : path?.caster === "sorcerer" ? "S" : "")}</span><h2>${escapeHtml(title)}</h2></header>
      <div class="gg-training-ranks">${rankTabsMarkup({ currentRank, selectedRank: runtime.trainingSelectedRank, general, maximumGeneralRank })}</div>
      ${spellGridMarkup({ actor, path: current, selectedRank: runtime.trainingSelectedRank, currentRank, general, highestRank, knownMaps, selection, activeProject, catalog })}
    </section>`;
  }

  const footerClass = activeProject
    ? "has-training-footer has-training-project"
    : selection ? "has-training-footer has-training-selection" : "";
  return `<div class="gg-training-layout">${left}<main class="gg-training-right ${footerClass}">${body}${activeProject ? projectMarkup(activeProject) : selectionSummaryMarkup(selection, catalog, actor, state)}</main>${runtime.trainingSetupOpen ? setupMarkup(selection, catalog, actor, state) : ""}</div>`;
}

function selectionForRank(runtime, record, rank) {
  if (!record?.catalog || record.general || rank !== pathCurrentRank(record) + 1) return null;
  return { kind: "rank", pathId: record.catalog.id, targetRank: rank };
}

function selectionForSpell(runtime, entry, selectedPath) {
  return { kind: "spell", pathId: selectedPath.general ? GENERAL_PATH_ID : selectedPath.catalog?.id, targetId: entry.id, targetRank: entry.rank };
}

function validateSelection(actor, selection, catalog, state) {
  if (!selection) return localize("GG.NoTrainingSelection", "Select a path, rank, or spell first.");
  const rank = clamp(integer(selection.targetRank, 1), 1, 5);
  const xpCost = selection.kind === "spell" ? spellXpCost(rank) : pathXpCost(actor, rank, state, selection.kind === "path");
  if (actorXp(actor) < xpCost) return localize("GG.NotEnoughXp", "Not enough XP.");
  if (selection.kind === "path") {
    const entry = catalog.pathById.get(selection.pathId);
    if (!entry || !casterAllows(state.caster, entry.caster)) return localize("GG.PathUnavailable", "This path is unavailable to the selected caster type.");
  }
  if (selection.kind === "rank") {
    const entry = catalog.pathById.get(selection.pathId);
    const record = knownPathRecords(actor, catalog).find((candidate) => candidate.catalog?.id === entry?.id);
    if (!record || rank !== pathCurrentRank(record) + 1) return localize("GG.InvalidRankTraining", "This rank cannot be trained now.");
    if (rank >= 2) {
      const known = knownSpellMaps(actor, catalog);
      const hasRequiredSpell = catalog.spells.some((spell) => spell.discipline === entry.discipline && spell.rank === rank && knownSpellItem(spell, known));
      if (!hasRequiredSpell) return localize("GG.NeedSpellOfRank", "You must know at least one spell of the target rank.");
    }
  }
  if (selection.kind === "spell") {
    const spell = catalog.spellsById.get(selection.targetId);
    if (!spell || spell.rank !== rank) return localize("GG.SpellUnavailable", "This spell cannot be trained now.");
    const known = knownSpellMaps(actor, catalog);
    if (knownSpellItem(spell, known)) return localize("GG.SpellAlreadyKnown", "This spell is already known.");
    const records = knownPathRecords(actor, catalog);
    if (selection.pathId === GENERAL_PATH_ID) {
      const highestRank = highestKnownPathRank(records);
      if (highestRank < 1 || rank > highestRank + 1) return localize("GG.SpellUnavailable", "This spell cannot be trained now.");
    } else {
      const record = records.find((candidate) => candidate.catalog?.id === selection.pathId);
      if (!record || record.catalog?.discipline !== spell.discipline || rank > pathCurrentRank(record) + 1) {
        return localize("GG.SpellUnavailable", "This spell cannot be trained now.");
      }
    }
  }
  return null;
}

async function writeCurrency(actor, currency) {
  await actor.update({
    "system.currency.gold.value": currency.gold,
    "system.currency.silver.value": currency.silver,
    "system.currency.copper.value": currency.copper
  }, { render: true, diff: true });
}

async function deductSilver(actor, silverCost, messageKey = "GG.NotEnoughMoney", fallback = "Not enough money.") {
  const current = actorCurrency(actor);
  const total = currencyToCopper(current);
  const cost = Math.max(0, integer(silverCost)) * 10;
  if (total < cost) throw new Error(localize(messageKey, fallback));
  await writeCurrency(actor, currencyFromCopper(total - cost));
  return current;
}

async function deductResearchSilver(actor, silverCost) {
  return deductSilver(actor, silverCost, "GG.NotEnoughMoney", "Not enough money for research ingredients.");
}

function requiredSuccesses(kind, rank) {
  if (kind === "rank" && rank === 4) return 2;
  if (kind === "rank" && rank === 5) return 4;
  return 1;
}

async function startProject(runtime, form) {
  const actor = runtime.actor;
  const catalog = runtime.trainingCatalog ?? await getCatalog();
  const state = trainingFlag(actor);
  if (state.activeProject) throw new Error(localize("GG.OnlyOneTraining", "Only one training project can be active."));
  const selection = runtime.trainingSelection;
  const validation = validateSelection(actor, selection, catalog, state);
  if (validation) throw new Error(validation);
  const rank = clamp(integer(selection.targetRank, 1), 1, 5);
  const xpCost = selection.kind === "spell" ? spellXpCost(rank) : pathXpCost(actor, rank, state, selection.kind === "path");
  let method;
  let sourceQuality = 0;
  if (selection.kind === "spell") {
    const data = new FormData(form);
    method = String(data.get("method") ?? "teacher");
    if (!["teacher", "source", "research"].includes(method)) method = "teacher";
    sourceQuality = clamp(integer(data.get("sourceQuality"), 2), -5, 10);
  } else {
    method = form.querySelector("[name='hasTeacher']")?.checked ? "teacher" : "research";
  }
  const silverCost = selection.kind === "spell" && method === "research" ? xpCost * 5 : 0;
  const currentRecord = selection.pathId === GENERAL_PATH_ID ? null : knownPathRecords(actor, catalog).find((record) => record.catalog?.id === selection.pathId);
  const project = {
    id: randomId(),
    kind: selection.kind,
    pathId: selection.pathId,
    targetId: selection.targetId ?? null,
    targetRank: rank,
    targetName: targetName(selection, catalog),
    method,
    sourceQuality,
    xpCost,
    silverCost,
    attemptSilverCost: selection.kind !== "spell" && method !== "teacher" && rank >= 4 ? rank : 0,
    ingredientsPurchased: silverCost > 0,
    attempts: 0,
    successes: 0,
    requiredSuccesses: method === "teacher" ? 1 : requiredSuccesses(selection.kind, rank),
    quarterDays: 0,
    currentRank: pathCurrentRank(currentRecord),
    startedAt: Date.now()
  };
  let currencyBefore = null;
  try {
    if (silverCost > 0) currencyBefore = await deductResearchSilver(actor, silverCost);
    await updateTrainingFlag(actor, { activeProject: project });
  } catch (error) {
    if (currencyBefore) await writeCurrency(actor, currencyBefore).catch(() => {});
    throw error;
  }
  runtime.trainingSelection = null;
  runtime.trainingSetupOpen = false;
}

function poolForProject(actor, project) {
  const wits = Math.max(0, integer(actor.system?.attribute?.wits?.value ?? actor.system?.attribute?.wits?.max));
  const terms = [];
  const summary = [];
  const add = (term, number, flavor, display = flavor) => {
    const amount = Math.max(0, integer(number));
    if (!amount) return;
    terms.push({ term, number: amount, flavor });
    summary.push(`${display} ${amount}d${term}`);
  };

  add("b", wits, "WITS");
  if (project.kind !== "spell") {
    add("n", project.currentRank, "RANK", `${localize("GG.Rank", "Rank")} -${Math.max(0, integer(project.currentRank))}`);
    return { label: "WITS", terms, summary: summary.join(" + ") || "0" };
  }

  if (project.method === "source") {
    const lore = Math.max(0, integer(actor.system?.skill?.lore?.value));
    const quality = integer(project.sourceQuality);
    add("s", lore, "LORE");
    if (quality > 0) add("s", quality, "SOURCE", `${localize("GG.SourceQuality", "Source quality")} +${quality}`);
    else if (quality < 0) add("n", -quality, "SOURCE", `${localize("GG.SourceQuality", "Source quality")} ${quality}`);
    return { label: "WITS + LORE", terms, summary: summary.join(" + ") || "0" };
  }

  return { label: "WITS", terms, summary: summary.join(" + ") || "0" };
}

async function evaluateTrainingPool(actor, project, pool) {
  const dice = pool.terms.filter((term) => term.number > 0);
  if (!dice.some((term) => term.term !== "n")) return { roll: null, successes: 0 };

  const speaker = ChatMessage.getSpeaker({ actor });
  const RollClass = getYearZeroRollClass(localize("GG.TrainingRollUnavailable", "Forbidden Lands training dice are unavailable."));
  const options = {
    name: project.targetName,
    title: project.targetName,
    type: "skill",
    actorId: speaker.actor ?? actor.id,
    actorType: actor.type,
    alias: speaker.alias ?? actor.name,
    tokenId: speaker.token ?? null,
    sceneId: speaker.scene ?? null,
    maxPush: "0",
    yzGame: CONFIG.YZUR?.game
  };
  const roll = RollClass.forge(
    dice,
    { yzGame: CONFIG.YZUR?.game, maxPush: 0, title: project.targetName },
    options
  );
  await evaluateYearZeroRoll(roll, localize("GG.TrainingRollFailed", "Forbidden Lands could not evaluate the training roll."));
  return { roll, successes: yearZeroSuccesses(roll) };
}

async function rollFormulaTotal(formula) {
  if (!formula || formula === "0" || formula === "-") return 0;
  if (/^\d+$/.test(formula)) return integer(formula);
  const roll = await new Roll(formula).evaluate();
  return Math.max(0, integer(roll.total));
}

function talentMishapFormula(rank) {
  return ({ 1: "0", 2: "1d2-1", 3: "1", 4: "1d2", 5: "1d3" })[rank] ?? "0";
}

function spellMishapFormula(rank) {
  return ({ 1: "0", 2: "0", 3: "1d2-1", 4: "1", 5: "1d2" })[rank] ?? "0";
}

async function drawMishaps(actor, count, targetNameValue, { includeZero = false } = {}) {
  const amount = Math.max(0, integer(count));
  if (!includeZero && !amount) return;
  await drawConfiguredMishapTable({
    actor,
    level: normalizeMishapLevel(amount),
    targetName: targetNameValue,
    context: "training"
  });
}


async function postAttempt(actor, project, result, mishaps, { showMishap = false } = {}) {
  const outcome = result.successes > 0 ? localize("GG.Success", "Success") : localize("GG.Failure", "Failure");
  const hasMishap = showMishap || Math.max(0, integer(mishaps)) > 0;
  const flavor = `<div class="gg-training-roll-flavor"><h3>${escapeHtml(project.targetName)}</h3><p>${escapeHtml(result.label)}: <b>${escapeHtml(result.poolSummary)}</b> · ${escapeHtml(outcome)}</p><p>${escapeHtml(localize("GG.Progress", "Progress"))}: <b>${result.nextSuccesses} / ${project.requiredSuccesses}</b>${hasMishap ? ` · ${escapeHtml(localize("GG.MagicMishap", "Magic Mishap"))}: <b>${Math.max(0, integer(mishaps))}</b>` : ""}</p></div>`;
  if (result.roll?.toMessage) await result.roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor });
  else await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: flavor });
}

function cleanEmbeddedSource(source, sourceIdValue, discipline, role = null) {
  const item = foundry.utils.deepClone(source ?? {});
  delete item._id;
  delete item.folder;
  delete item.ownership;
  delete item._stats;
  const flags = item.flags && typeof item.flags === "object" ? item.flags : {};
  delete flags["scene-packer"];
  flags[MODULE_ID] = {
    ...(flags[MODULE_ID] ?? {}),
    trainingSourceId: sourceIdValue,
    trainingDiscipline: discipline,
    ...(role ? { role } : {})
  };
  item.flags = flags;
  return item;
}

async function finalizeProject(runtime, project) {
  const actor = runtime.actor;
  const catalog = runtime.trainingCatalog ?? await getCatalog();
  const liveState = trainingFlag(actor);
  if (liveState.activeProject?.id !== project.id) throw new Error(localize("GG.TrainingChanged", "The training project has changed."));
  const xp = actorXp(actor);
  if (xp < project.xpCost) throw new Error(localize("GG.NotEnoughXp", "Not enough XP."));
  let created = null;
  let updatedItem = null;
  let previousRank = null;
  try {
    if (project.kind === "path") {
      const entry = catalog.pathById.get(project.pathId);
      if (!entry) throw new Error(localize("GG.PathUnavailable", "Path data is unavailable."));
      const existing = knownPathRecords(actor, catalog).find((record) => record.catalog?.id === entry.id);
      if (existing) throw new Error(localize("GG.PathAlreadyKnown", "This path is already known."));
      const source = cleanEmbeddedSource(entry.item, entry.id, entry.discipline, ITEM_ROLES.MAGIC_TALENT);
      source.type = "talent";
      source.system ??= {};
      source.system.rank = "1";
      source.system.type ||= "profession";
      source.system.category ||= "general";
      [created] = await actor.createEmbeddedDocuments("Item", [source], { render: false });
      if (!created?.id || created.type !== "talent") {
        throw new Error(localize("GG.PathTalentCreationFailed", "The path talent could not be added to the actor."));
      }
    } else if (project.kind === "rank") {
      const record = knownPathRecords(actor, catalog).find((candidate) => candidate.catalog?.id === project.pathId);
      if (!record) throw new Error(localize("GG.PathUnavailable", "Path data is unavailable."));
      previousRank = record.item.system.rank;
      updatedItem = record.item;
      await updatedItem.update({ "system.rank": String(project.targetRank) }, { render: false, diff: true });
    } else if (project.kind === "spell") {
      const entry = catalog.spellsById.get(project.targetId);
      if (!entry) throw new Error(localize("GG.SpellUnavailable", "Spell data is unavailable."));
      if (knownSpellItem(entry, knownSpellMaps(actor, catalog))) throw new Error(localize("GG.SpellAlreadyKnown", "This spell is already known."));
      const source = cleanEmbeddedSource(entry.item, entry.id, entry.discipline);
      [created] = await actor.createEmbeddedDocuments("Item", [source], { render: false });
    }
    await actor.update({
      "system.bio.experience.value": xp - project.xpCost,
      [`flags.${MODULE_ID}.training.activeProject`]: null
    }, { render: true, diff: true });
  } catch (error) {
    if (created?.id) await actor.deleteEmbeddedDocuments("Item", [created.id], { render: false }).catch(() => {});
    if (updatedItem && previousRank != null) await updatedItem.update({ "system.rank": previousRank }, { render: false }).catch(() => {});
    throw error;
  }
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="gg-training-chat is-complete"><h3>${escapeHtml(localize("GG.TrainingComplete", "Training complete"))}</h3><p>${escapeHtml(project.targetName)}</p><p>${escapeHtml(localize("GG.Spent", "Spent"))}: <b>${project.xpCost} XP</b></p></div>`
  });
}

async function attemptProject(runtime) {
  const actor = runtime.actor;
  const state = trainingFlag(actor);
  const project = state.activeProject;
  if (!project) throw new Error(localize("GG.NoActiveTraining", "There is no active training project."));
  if (integer(project.successes) >= integer(project.requiredSuccesses, 1)) {
    await finalizeProject(runtime, project);
    return;
  }
  if (project.method === "teacher") {
    const next = { ...project, attempts: integer(project.attempts) + 1, quarterDays: integer(project.quarterDays) + 1, successes: integer(project.requiredSuccesses, 1) };
    await updateTrainingFlag(actor, { activeProject: next });
    await finalizeProject(runtime, next);
    return;
  }
  const latest = trainingFlag(actor).activeProject;
  if (latest?.id !== project.id || integer(latest.attempts) !== integer(project.attempts) || integer(latest.successes) !== integer(project.successes)) {
    throw new Error(localize("GG.TrainingChanged", "The training project has changed."));
  }
  let currencyBefore = null;
  let rolled;
  let success;
  let successes;
  let next;
  let mishaps;
  let zeroLevelSpellMishap = false;
  const pool = poolForProject(actor, project);
  try {
    if (integer(project.attemptSilverCost) > 0) {
      currencyBefore = await deductSilver(actor, project.attemptSilverCost, "GG.NotEnoughAttemptMoney", "Not enough money for this training attempt.");
    }
    rolled = await evaluateTrainingPool(actor, project, pool);
    success = rolled.successes > 0;
    successes = success ? integer(project.successes) + 1 : 0;
    successes = Math.min(successes, integer(project.requiredSuccesses, 1));
    next = {
      ...project,
      attempts: integer(project.attempts) + 1,
      quarterDays: integer(project.quarterDays) + 1,
      successes
    };
    let mishapFormula = "0";
    if (project.kind !== "spell") mishapFormula = talentMishapFormula(project.targetRank);
    else if (project.method === "source" && !success) {
      mishapFormula = spellMishapFormula(Math.max(1, project.targetRank - 1));
      zeroLevelSpellMishap = true;
    } else if (project.method === "research") {
      mishapFormula = spellMishapFormula(project.targetRank);
      zeroLevelSpellMishap = true;
    }
    mishaps = await rollFormulaTotal(mishapFormula);
    await updateTrainingFlag(actor, { activeProject: next });
  } catch (error) {
    if (currencyBefore) await writeCurrency(actor, currencyBefore).catch(() => {});
    throw error;
  }
  await postAttempt(actor, project, { ...rolled, label: pool.label, poolSummary: pool.summary, nextSuccesses: successes }, mishaps, { showMishap: project.kind === "spell" && zeroLevelSpellMishap });
  await drawMishaps(actor, mishaps, project.targetName, { includeZero: project.kind === "spell" && zeroLevelSpellMishap });
  if (successes >= next.requiredSuccesses) await finalizeProject(runtime, next);
}

function confirmTrainingCancellation(runtime, message) {
  const book = runtime.overlay?.querySelector?.(".gg-book");
  if (!book) return Promise.resolve(globalThis.window?.confirm?.(message) ?? false);

  runtime.trainingConfirmCleanup?.();

  return new Promise((resolve) => {
    const titleId = `gg-training-confirm-${randomId()}`;
    const backdrop = document.createElement("div");
    backdrop.className = "gg-training-confirm-backdrop";
    backdrop.innerHTML = `
      <section class="gg-training-confirm" role="dialog" aria-modal="true" aria-labelledby="${escapeHtml(titleId)}">
        <h3 id="${escapeHtml(titleId)}">${escapeHtml(localize("GG.CancelTraining", "Cancel training"))}</h3>
        <p>${escapeHtml(message)}</p>
        <div class="gg-training-confirm-actions">
          <button type="button" data-training-confirm="no">${escapeHtml(localize("GG.ContinueTraining", "Continue training"))}</button>
          <button type="button" class="is-danger" data-training-confirm="yes">${escapeHtml(localize("GG.CancelTraining", "Cancel training"))}</button>
        </div>
      </section>`;

    const previousFocus = document.activeElement;
    let settled = false;
    const finish = (confirmed) => {
      if (settled) return;
      settled = true;
      document.removeEventListener("keydown", onKeyDown, true);
      backdrop.remove();
      if (runtime.trainingConfirmBackdrop === backdrop) runtime.trainingConfirmBackdrop = null;
      if (runtime.trainingConfirmCleanup === cleanup) runtime.trainingConfirmCleanup = null;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
      resolve(confirmed);
    };
    const cleanup = () => finish(false);
    const onKeyDown = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      finish(false);
    };

    backdrop.addEventListener("click", (event) => {
      const answer = event.target.closest?.("[data-training-confirm]")?.dataset?.trainingConfirm;
      if (answer === "yes") finish(true);
      else if (answer === "no" || event.target === backdrop) finish(false);
    });
    document.addEventListener("keydown", onKeyDown, true);
    runtime.trainingConfirmBackdrop = backdrop;
    runtime.trainingConfirmCleanup = cleanup;
    book.append(backdrop);
    requestAnimationFrame(() => backdrop.querySelector('[data-training-confirm="no"]')?.focus());
  });
}

async function cancelProject(runtime) {
  const project = trainingFlag(runtime.actor).activeProject;
  if (!project) return;
  const message = project.ingredientsPurchased
    ? localize("GG.CancelTrainingIngredients", "Cancel this training? Purchased research ingredients are not refunded.")
    : localize("GG.CancelTrainingConfirm", "Cancel this training?");
  if (!await confirmTrainingCancellation(runtime, message)) return;
  await updateTrainingFlag(runtime.actor, { activeProject: null });
}

export function bindTraining(runtime, { rerender }) {
  if (runtime.activeTab !== "training") return;
  const root = runtime.overlay?.querySelector(".gg-training-layout");
  if (!root) return;
  const catalog = runtime.trainingCatalog;
  const doRerender = () => Promise.resolve(rerender()).catch((error) => {
    console.error("Goetia Grimoire | Training render failed.", error);
    ui.notifications.error(localize("GG.UiActionFailed", "The grimoire action could not be completed."));
  });
  const run = async (task) => {
    if (runtime.trainingBusy) return;
    runtime.trainingBusy = true;
    root.classList.add("is-busy");
    try {
      await task();
      await doRerender();
    } catch (error) {
      console.error("Goetia Grimoire | Training action failed.", error);
      ui.notifications.error(error?.message || localize("GG.UiActionFailed", "The grimoire action could not be completed."));
    } finally {
      runtime.trainingBusy = false;
      root.classList.remove("is-busy");
    }
  };

  root.querySelectorAll("[data-training-setting]").forEach((input) => input.addEventListener("change", () => run(async () => {
    await updateTrainingFlag(runtime.actor, { [input.dataset.trainingSetting]: input.checked });
  })));

  root.querySelectorAll("[data-training-caster]").forEach((input) => input.addEventListener("change", () => run(async () => {
    const caster = input.checked ? input.dataset.trainingCaster : null;
    await updateTrainingFlag(runtime.actor, { caster });
    runtime.trainingNewPathMode = false;
    runtime.trainingSelection = null;
    runtime.trainingSelectedPathId = null;
  })));

  root.querySelectorAll("[data-training-path]").forEach((button) => button.addEventListener("click", () => {
    runtime.trainingSelectedPathId = button.dataset.trainingPath;
    runtime.trainingNewPathMode = false;
    runtime.trainingSelection = null;
    runtime.trainingSelectedRank = 1;
    void doRerender();
  }));

  root.querySelector("[data-training-action='new-path']")?.addEventListener("click", () => {
    runtime.trainingNewPathMode = true;
    runtime.trainingSelectedPathId = null;
    runtime.trainingSelection = null;
    void doRerender();
  });

  root.querySelectorAll("[data-training-new-path]").forEach((button) => button.addEventListener("click", () => {
    const pathId = button.dataset.trainingNewPath;
    runtime.trainingSelectedPathId = pathId;
    runtime.trainingNewPathMode = true;
    runtime.trainingSelectedRank = 1;
    runtime.trainingSelection = { kind: "path", pathId, targetRank: 1 };
    void doRerender();
  }));

  root.querySelectorAll("[data-training-rank]").forEach((button) => button.addEventListener("click", () => {
    const rank = integer(button.dataset.trainingRank, 1);
    runtime.trainingSelectedRank = rank;
    const records = knownPathRecords(runtime.actor, catalog);
    const selected = selectedPathRecord(runtime, records, catalog);
    runtime.trainingSelection = selectionForRank(runtime, selected, rank);
    void doRerender();
  }));

  root.querySelectorAll("[data-training-spell]").forEach((button) => {
    const entry = catalog.spellsById.get(button.dataset.trainingSpell);
    if (entry) bindDelayedSpellTooltip(runtime, button, spellTooltipMarkup(entry), { delay: 500 });
    button.addEventListener("click", () => {
      if (button.getAttribute("aria-disabled") === "true" || !entry) return;
      const records = knownPathRecords(runtime.actor, catalog);
      const selected = selectedPathRecord(runtime, records, catalog);
      runtime.trainingSelection = selectionForSpell(runtime, entry, selected);
      void doRerender();
    });
  });

  root.querySelector("[data-training-action='prepare']")?.addEventListener("click", () => {
    const error = validateSelection(runtime.actor, runtime.trainingSelection, catalog, trainingFlag(runtime.actor));
    if (error) {
      ui.notifications.error(error);
      return;
    }
    runtime.trainingSetupOpen = true;
    void doRerender();
  });

  root.querySelectorAll("[data-training-action='close-setup']").forEach((button) => button.addEventListener("click", (event) => {
    if (event.target !== event.currentTarget && event.currentTarget.classList.contains("gg-training-setup-backdrop")) return;
    runtime.trainingSetupOpen = false;
    void doRerender();
  }));

  const setupForm = root.querySelector("[data-training-setup-form]");
  setupForm?.querySelectorAll("input[name='method']").forEach((input) => input.addEventListener("change", () => {
    if (input.checked) setupForm.dataset.trainingMethodState = input.value;
  }));
  setupForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    void run(() => startProject(runtime, event.currentTarget));
  });

  root.querySelector("[data-training-action='attempt']")?.addEventListener("click", () => void run(() => attemptProject(runtime)));
  root.querySelector("[data-training-action='cancel-project']")?.addEventListener("click", () => void run(() => cancelProject(runtime)));
}
