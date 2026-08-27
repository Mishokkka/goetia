import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  compareDrawingToSigil,
  createSpellSigil,
  createUnlockSigil,
  normalizeSigilForDisplay,
  UNLOCK_SIGIL_VERSION
} from "../scripts/sigil.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "module.json"), "utf8"));
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
assert.equal(manifest.id, "goetia-grimoire");
assert.equal(manifest.version, packageJson.version, "Manifest and package versions must match");
assert.equal(manifest.version, "0.7.7");
assert.equal(manifest.compatibility.verified, "13.351");
assert.equal(manifest.relationships.systems[0].compatibility.verified, "13.0.5");
for (const relativePath of [
  ...manifest.esmodules,
  ...manifest.styles,
  ...manifest.languages.map((entry) => entry.path)
]) {
  assert.equal(fs.existsSync(path.join(root, relativePath)), true, `Manifest path ${relativePath} must exist`);
}

let checked = 0;
for (let rank = 1; rank <= 6; rank += 1) {
  for (let index = 0; index < 80; index += 1) {
    const sigil = normalizeSigilForDisplay(createSpellSigil(`smoke:${rank}:${index}`, rank));
    assert.equal(sigil.elementCount, Math.min(6, rank + 1));
    const exact = compareDrawingToSigil(sigil.strokes, sigil, { tolerance: 0.06 });
    assert.equal(exact.complete, true, `Exact rank ${rank} sigil must be complete`);
    assert.ok(exact.score > 0.99, `Exact rank ${rank} sigil must score near 100%`);

    const missingElement = sigil.elements.slice(0, -1).flat();
    const incomplete = compareDrawingToSigil(missingElement, sigil, { tolerance: 0.06 });
    assert.equal(incomplete.complete, false, `Missing rank ${rank} element must be incomplete`);
    assert.ok(incomplete.score < 0.75, `Missing rank ${rank} element must not bind`);
    checked += 1;
  }
}

const unlock = createUnlockSigil("smoke:unlock");
assert.equal(unlock.version, UNLOCK_SIGIL_VERSION);
assert.ok(unlock.strokes.length >= 3);

globalThis.game = {
  settings: { get: (_module, key) => key === "magicTalentAliases" ? "Путь Пепла" : key === "psychicPowerAliases" ? "Дар Разума" : "" }
};
globalThis.foundry = { utils: { deepClone: (value) => structuredClone(value) } };
const { MODULE_ID, ITEM_ROLES, isMagicTalent, hasPsychicPower, spellSigilSeed, trainingSourceId, castingTalentRank, requiresChanceCasting } = await import("../scripts/config.js");
const flaggedTalent = { type: "talent", name: "Other", flags: { [MODULE_ID]: { role: ITEM_ROLES.MAGIC_TALENT } } };
const aliasedTalent = { type: "talent", name: "Путь Пепла", flags: {} };
const prefixedTalent = { type: "talent", name: "(S/D) Path Of Magma", system: { type: "profession" }, flags: {} };
assert.equal(isMagicTalent(flaggedTalent), true);
assert.equal(isMagicTalent(aliasedTalent), true);
assert.equal(isMagicTalent(prefixedTalent), true);
assert.equal(hasPsychicPower({ items: [{ type: "talent", name: "Дар Разума", flags: {} }] }), true);
const chanceActor = { items: [{ type: "talent", name: "(D) Path of Sight", system: { type: "profession", rank: "2" }, flags: {} }] };
const chanceSpell = { type: "spell", system: { rank: "3" }, flags: { "spell-compendium-builder": { discipline: "Awareness" } } };
assert.equal(castingTalentRank(chanceActor, chanceSpell), 2, "Casting must use the actor's highest magic talent rank");
assert.equal(requiresChanceCasting(chanceActor, chanceSpell), true, "A spell above the actor's highest magic talent rank must force Chance Casting");
assert.equal(requiresChanceCasting(chanceActor, { ...chanceSpell, system: { rank: "2" } }), false, "A spell at the actor's highest magic talent rank must not force Chance Casting");
const unrelatedChanceActor = { items: [{ type: "talent", name: "(S) Path of Blood", system: { type: "profession", rank: "5" }, flags: {} }] };
assert.equal(castingTalentRank(unrelatedChanceActor, chanceSpell), 5, "Magic school must not limit the rank used for Chance Casting");
assert.equal(requiresChanceCasting(unrelatedChanceActor, chanceSpell), false, "Any higher-rank magic talent must prevent forced Chance Casting");
const mixedTalentActor = { items: [
  { type: "talent", name: "(D) Path of Sight", system: { type: "profession", rank: "2" }, flags: {} },
  { type: "talent", name: "(S) Path of Blood", system: { type: "profession", rank: "5" }, flags: {} }
] };
assert.equal(castingTalentRank(mixedTalentActor, chanceSpell), 5, "Chance Casting must compare against the maximum rank across all magic talents");
const { yearZeroOnes } = await import("../scripts/year-zero-roll.js");
assert.equal(yearZeroOnes({ dice: [{ denomination: "b", results: [{ result: 1 }, { result: 6 }, { result: 1, discarded: true }, { result: 1, active: false }] }] }), 1, "Mishap counting must include only active non-discarded ones on spell dice");

const trainedActor = {
  uuid: "Actor.sigil-smoke",
  flags: { [MODULE_ID]: { spellSigilSalts: { embedded: "salt" } } },
  getFlag: (_scope, key) => key === "spellSigilSalts" ? { embedded: "salt" } : null
};
const trainedSpell = {
  id: "embedded",
  flags: { [MODULE_ID]: { trainingSourceId: "catalog-spell" } },
  getFlag: (_scope, key) => key === "trainingSourceId" ? "catalog-spell" : null
};
assert.equal(trainingSourceId(trainedSpell), "catalog-spell");
assert.equal(spellSigilSeed(trainedActor, trainedSpell), "Actor.sigil-smoke:training:catalog-spell:salt", "Training-created spells must use one shared client/server sigil seed");
assert.equal(spellSigilSeed(trainedActor, { id: "embedded", flags: {} }), "Actor.sigil-smoke:embedded:salt");

const { activeAuthoritativeGm, isAuthoritativeGm } = await import("../scripts/user-authority.js");
globalThis.game.user = { id: "gm-b", isGM: true };
globalThis.game.users = [
  { id: "gm-b", active: true, isGM: true },
  { id: "gm-a", active: true, isGM: true },
  { id: "player", active: true, isGM: false }
];
assert.equal(activeAuthoritativeGm()?.id, "gm-a", "Authority selection must be deterministic");
assert.equal(isAuthoritativeGm(), false);
globalThis.game.user = { id: "gm-a", isGM: true };
assert.equal(isAuthoritativeGm(), true);

const { CURRENT_DATA_SCHEMA, migrateActorData, runWorldMigrations, shouldMigrateActorAfterItemCreate } = await import("../scripts/data-schema.js");
let migrationUpdate = null;
const migrationActor = {
  type: "character",
  uuid: "Actor.smoke",
  name: "Smoke",
  flags: {
    [MODULE_ID]: {
      spellPositions: { keep: { x: 1 }, stale: { x: 2 } },
      spellSigilSalts: { keep: "ok", stale: "remove" },
      contractHtml: 42,
      schemaVersion: 0
    }
  },
  items: [{ id: "keep", type: "spell" }],
  async update(update) { migrationUpdate = update; }
};
assert.equal(await migrateActorData(migrationActor), true);
assert.equal(migrationUpdate[`flags.${MODULE_ID}.schemaVersion`], CURRENT_DATA_SCHEMA);
assert.deepEqual(Object.keys(migrationUpdate[`flags.${MODULE_ID}.spellPositions`]), ["keep"]);
assert.deepEqual(Object.keys(migrationUpdate[`flags.${MODULE_ID}.spellSigilSalts`]), ["keep"]);
assert.equal(migrationUpdate[`flags.${MODULE_ID}.contractHtml`], "42");
assert.equal(migrationUpdate[`flags.${MODULE_ID}.unlockSigil`].version, UNLOCK_SIGIL_VERSION);

const currentSchemaActor = {
  type: "character",
  flags: {
    [MODULE_ID]: {
      schemaVersion: CURRENT_DATA_SCHEMA,
      unlockSigil: createUnlockSigil("smoke:current-schema"),
      contractHtml: ""
    }
  }
};
assert.equal(
  shouldMigrateActorAfterItemCreate(currentSchemaActor, { id: "spell", type: "spell", name: "Spell" }),
  false,
  "Creating an ordinary spell on a current-schema actor must not trigger a full migration"
);
assert.equal(
  shouldMigrateActorAfterItemCreate(currentSchemaActor, flaggedTalent),
  true,
  "Creating a magic talent must still initialize/migrate the actor when needed"
);

let schemaSetCalls = 0;
const failingActor = {
  type: "character",
  id: "failure",
  name: "Failure",
  flags: { [MODULE_ID]: { schemaVersion: 0 } },
  items: [],
  async update() { throw new Error("expected migration failure"); }
};
globalThis.game = {
  user: { id: "gm", isGM: true },
  users: [{ id: "gm", active: true, isGM: true }],
  actors: [failingActor],
  settings: {
    get: (_module, key) => key === "dataSchemaVersion" ? 0 : "",
    async set() { schemaSetCalls += 1; }
  }
};
const originalError = console.error;
const originalWarn = console.warn;
console.error = () => {};
console.warn = () => {};
try {
  await runWorldMigrations();
} finally {
  console.error = originalError;
  console.warn = originalWarn;
}
assert.equal(schemaSetCalls, 0, "A partial migration must not advance the world schema version");

const { normalizedCanvasStrokes } = await import("../scripts/drawing-controller.js");
const fakeCanvas = {
  clientWidth: 100,
  clientHeight: 50,
  getBoundingClientRect: () => ({ width: 100, height: 50 })
};
assert.deepEqual(normalizedCanvasStrokes(fakeCanvas, [
  [{ x: 0, y: 0 }, { x: 100, y: 50 }],
  null,
  [{ x: Number.NaN, y: 4 }]
]), [[{ x: 0, y: 0 }, { x: 1, y: 1 }]]);

class FakeContext2D {
  constructor() { this.drawImageCalls = 0; }
  setTransform() {}
  clearRect() {}
  save() {}
  restore() {}
  beginPath() {}
  moveTo() {}
  lineTo() {}
  stroke() {}
  setLineDash() {}
  drawImage() { this.drawImageCalls += 1; }
}

class FakeClassList {
  constructor(...values) { this.values = new Set(values); }
  contains(value) { return this.values.has(value); }
  add(...values) { for (const value of values) this.values.add(value); }
  remove(...values) { for (const value of values) this.values.delete(value); }
  toggle(value, force) {
    if (force === true) this.values.add(value);
    else if (force === false) this.values.delete(value);
    else if (this.values.has(value)) this.values.delete(value);
    else this.values.add(value);
  }
}

class FakeDrawingCanvas {
  constructor(classes = []) {
    this.width = 0;
    this.height = 0;
    this.clientWidth = 200;
    this.clientHeight = 200;
    this.parentElement = null;
    this.isConnected = true;
    this.style = {};
    this.classList = new FakeClassList(...classes);
    this.context = new FakeContext2D();
    this.listeners = new Map();
    this.host = { classList: new FakeClassList() };
  }
  getContext() { return this.context; }
  getBoundingClientRect() { return { left: 10, top: 20, width: 200, height: 200 }; }
  closest() { return this.host; }
  setAttribute() {}
  setPointerCapture() {}
  hasPointerCapture() { return false; }
  releasePointerCapture() {}
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  removeEventListener(type) { this.listeners.delete(type); }
  async dispatch(type, event) { return this.listeners.get(type)?.(event); }
}

const rafTimers = new Map();
let rafId = 0;
globalThis.window = globalThis;
globalThis.devicePixelRatio = 1;
globalThis.requestAnimationFrame = (callback) => {
  const id = ++rafId;
  const timer = setTimeout(() => { rafTimers.delete(id); callback(performance.now()); }, 0);
  rafTimers.set(id, timer);
  return id;
};
globalThis.cancelAnimationFrame = (id) => {
  const timer = rafTimers.get(id);
  if (timer) clearTimeout(timer);
  rafTimers.delete(id);
};
globalThis.ResizeObserver = class {
  constructor(callback) { this.callback = callback; }
  observe() {}
  disconnect() {}
};
globalThis.document = { createElement: () => new FakeDrawingCanvas() };
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.game.settings.get = () => false;
const { attachDrawing } = await import("../scripts/drawing-controller.js");
const interactiveCanvas = new FakeDrawingCanvas(["gg-ritual-canvas"]);
let drawingChanges = 0;
const drawingController = attachDrawing(interactiveCanvas, { onChange: () => { drawingChanges += 1; } });
await new Promise((resolve) => setTimeout(resolve, 5));
await interactiveCanvas.dispatch("pointerdown", { button: 0, pointerId: 1, clientX: 20, clientY: 30, preventDefault() {}, stopPropagation() {} });
await interactiveCanvas.dispatch("pointermove", { pointerId: 1, clientX: 80, clientY: 90, preventDefault() {}, getCoalescedEvents() { return [this]; } });
await interactiveCanvas.dispatch("pointerup", { pointerId: 1, clientX: 120, clientY: 130, preventDefault() {}, getCoalescedEvents() { return [this]; } });
await drawingController.whenIdle();
await new Promise((resolve) => setTimeout(resolve, 5));
assert.equal(drawingController.getStrokes().length, 1, "A completed pointer gesture must commit one stroke");
assert.equal(drawingChanges, 1, "A completed stroke must emit one change notification");
assert.ok(interactiveCanvas.context.drawImageCalls > 0, "The visible canvas must be composed from its backing layer");
const autoTarget = normalizeSigilForDisplay(createUnlockSigil('smoke:auto')).strokes;
await drawingController.autoDraw(autoTarget, { duration: 10, normalized: true, replace: true });
await drawingController.whenIdle();
assert.ok(drawingController.getStrokes().length >= 3, "Auto-draw should commit the target sigil strokes");
drawingController.destroy();

const cancellingCanvas = new FakeDrawingCanvas(["gg-unlock-canvas"]);
const cancellingController = attachDrawing(cancellingCanvas);
await new Promise((resolve) => setTimeout(resolve, 5));
const cancelledAutoDraw = cancellingController.autoDraw(autoTarget, { duration: 1000, normalized: true, replace: true });
cancellingController.destroy();
assert.deepEqual(await cancelledAutoDraw, [], "Destroying a controller must settle active auto-draw without rejection");
await cancellingController.whenIdle();

const grimoireSource = fs.readFileSync(path.join(root, "scripts/grimoire.js"), "utf8");
const castFxSource = fs.readFileSync(path.join(root, "scripts/cast-fx.js"), "utf8");
const audioSource = fs.readFileSync(path.join(root, "scripts/audio-service.js"), "utf8");
const uiInteractionsSource = fs.readFileSync(path.join(root, "scripts/ui-interactions.js"), "utf8");
const mainSource = fs.readFileSync(path.join(root, "scripts/main.js"), "utf8");
const authoritySource = fs.readFileSync(path.join(root, "scripts/user-authority.js"), "utf8");
const drawingSource = fs.readFileSync(path.join(root, "scripts/drawing-controller.js"), "utf8");
const sigilSource = fs.readFileSync(path.join(root, "scripts/sigil.js"), "utf8");
const coverCss = fs.readFileSync(path.join(root, "styles/grimoire.css"), "utf8");
const bookCss = fs.readFileSync(path.join(root, "styles/book.css"), "utf8");
const auxiliaryCss = fs.readFileSync(path.join(root, "styles/auxiliary.css"), "utf8");
const effectsCss = fs.readFileSync(path.join(root, "styles/effects.css"), "utf8");
const trainingSource = fs.readFileSync(path.join(root, "scripts/training.js"), "utf8");
const castNetworkSource = fs.readFileSync(path.join(root, "scripts/cast-network.js"), "utf8");
const yearZeroRollSource = fs.readFileSync(path.join(root, "scripts/year-zero-roll.js"), "utf8");
const mishapSource = fs.readFileSync(path.join(root, "scripts/mishap-service.js"), "utf8");
const contractSource = fs.readFileSync(path.join(root, "scripts/contract-view.js"), "utf8");
const contractCss = fs.readFileSync(path.join(root, "styles/contract.css"), "utf8");
const tooltipSource = fs.readFileSync(path.join(root, "scripts/spell-tooltip.js"), "utf8");
const trainingCatalog = JSON.parse(fs.readFileSync(path.join(root, "data/training-catalog.json"), "utf8"));
assert.ok(grimoireSource.split("\n").length < 1900, "grimoire.js should remain decomposed");
assert.equal(trainingCatalog.paths.length, 15, "Training catalog must include every supplied magic path");
assert.equal(trainingCatalog.spells.length, 352, "Training catalog must include every supplied rank 1-5 spell");
assert.equal(new Set(trainingCatalog.paths.map((entry) => entry.id)).size, trainingCatalog.paths.length, "Training path IDs must be unique");
assert.equal(new Set(trainingCatalog.spells.map((entry) => entry.id)).size, trainingCatalog.spells.length, "Training spell IDs must be unique");
const pathSigilFingerprints = trainingCatalog.paths.map((entry) => JSON.stringify(createSpellSigil(`goetia:path:${entry.id}`, 5).elements));
assert.equal(new Set(pathSigilFingerprints).size, trainingCatalog.paths.length, "Every magic path must receive a distinct procedural sigil");
assert.ok(trainingCatalog.spells.some((entry) => entry.discipline === "General Spells"), "General spells must remain an independent training discipline");
assert.ok(trainingCatalog.spells.every((entry) => Number(entry.rank) >= 1 && Number(entry.rank) <= 5), "Training must exclude unsupported rank 6 spells");
assert.ok(trainingSource.includes('const GENERAL_PATH_ID = "general"'), "Training must expose the General spell section");
assert.ok(trainingSource.includes("activeProject"), "Training must persist an active project");
assert.ok(trainingSource.includes('createEmbeddedDocuments("Item"'), "Training completion must create embedded Items");
assert.ok(trainingSource.includes("ITEM_ROLES.MAGIC_TALENT"), "Learning a path must tag the created Item as a magic talent");
assert.ok(trainingSource.includes('source.type = "talent"'), "Learning a path must create a talent Item explicitly");
assert.ok(trainingSource.includes("[`flags.${MODULE_ID}.training.activeProject`]: null\n    }, { render: true, diff: true })"), "Completed training must retain Foundry actor-sheet refresh semantics");
assert.ok(trainingSource.includes("RollClass.forge"), "Training checks must use the Forbidden Lands Year Zero roll class");
assert.ok(trainingSource.includes('add("b", wits'), "Training must roll Wits as base dice");
assert.ok(trainingSource.includes('add("s", lore'), "Source study must roll Lore as skill dice");
assert.ok(trainingSource.includes('add("n"'), "Training penalties must use Forbidden Lands negative dice");
assert.equal(trainingSource.includes("evaluateD6Pool"), false, "Training must not use a plain d6 pool evaluator");
assert.ok(yearZeroRollSource.includes("successCount"), "Shared Year Zero roll handling must read the system success count");
assert.ok(trainingSource.includes("gg-training-confirm-backdrop"), "Training cancellation must use an in-grimoire confirmation");
assert.equal(trainingSource.includes("Dialog.confirm"), false, "Training cancellation must not open a dialog beneath the grimoire");
assert.ok(bookCss.includes(".gg-training-confirm-backdrop"), "The in-grimoire cancellation confirmation must be styled");
assert.ok(trainingSource.includes("deductResearchSilver"), "Independent research must charge ingredients");
assert.ok(trainingSource.includes("const pathEntry = path?.catalog ?? path"), "Spell grids must resolve the discipline from the selected catalog path record");
assert.ok(trainingSource.includes("runtime.trainingSelectedPathId === undefined"), "New-path mode must preserve its intentional null selection");
assert.ok(trainingSource.includes("pathSigilMarkup"), "Training paths must use deterministic procedural sigils");
assert.ok(trainingSource.includes('{ render: true, diff: true }'), "Wallet and completion writes must retain Foundry actor-sheet rerender semantics");
assert.equal(trainingSource.includes('actor.sheet?.rendered'), false, "Training must not request a second explicit full ActorSheet render after actor.update");
assert.equal(trainingSource.includes('actor.sheet.render(false)'), false, "Training must not request a second explicit full ActorSheet render after actor.update");
assert.ok(trainingSource.includes("runtime.trainingConfirmCleanup"), "Training confirmation must register lifecycle cleanup");
assert.ok(trainingSource.includes("bindDelayedSpellTooltip(runtime, button, spellTooltipMarkup(entry)"), "Training spells must use the shared delayed spell tooltip");
assert.equal(trainingSource.includes("title=\"${escapeHtml(spellTooltip(entry))}"), false, "Training must not fall back to browser title tooltips");
assert.ok(tooltipSource.includes("gg-spell-tooltip-card"), "Shared spell tooltip markup must retain the grimoire card layout");
assert.ok(contractSource.includes("foundry.applications?.handlebars?.editor"), "Contract editing must retain Foundry's standard editor helper fallback");
assert.ok(contractSource.includes("HTMLProseMirrorElement"), "Contract editing must create Foundry's standard ProseMirror element directly");
assert.ok(contractSource.includes('querySelector("prose-mirror")'), "Contract editing must mount the standard Foundry prose-mirror element");
assert.ok(contractSource.includes("relativeTo: actor"), "Contract display must enrich document links relative to the actor");
assert.ok(contractCss.includes(":is(strong, b)"), "Contract display must preserve bold rich text");
assert.ok(contractCss.includes(":is(em, i)"), "Contract display must preserve italic rich text");
assert.ok(contractCss.includes(":is(s, strike, del)"), "Contract display must preserve strike-through rich text");
assert.ok(contractSource.includes("destroyContractEditor"), "Contract editor instances must be destroyed during rerenders");
assert.ok(trainingSource.includes("has-training-footer"), "Training must reserve footer space without growing the right page");
assert.ok(bookCss.includes(".gg-training-spell-grid::-webkit-scrollbar"), "Training spell overflow must not expose a layout-shifting scrollbar");
assert.equal((coverCss.match(/\.gg-closed\s*\{/g) ?? []).length, 1, "Closed cover must have one owning rule");
assert.equal(coverCss.includes("gg-cover-haunt"), false, "Legacy entrance CSS must remain removed");
assert.ok(coverCss.includes("gg-cover-shadow"), "Closed cover should include wandering shadow styling");
for (const staleClass of ["gg-cover-backdrop", "gg-cover-ring", "gg-cover-needle", "gg-cover-title", "gg-cover-aura", "gg-cover-wave"]) {
  assert.equal(coverCss.includes(staleClass), false, `Obsolete selector ${staleClass} must be removed`);
}
assert.ok(coverCss.includes("gg-cover-shadow-wander"), "Closed cover should animate wandering shadows");
assert.ok(coverCss.includes("gg-cover-visual--ossuary"), "Ossuary entrance styling must be bundled");
assert.ok(coverCss.includes("gg-cover-visual--eye"), "Abyssal Eye entrance styling must be bundled");
assert.ok(coverCss.includes("gg-cover-visual--wax"), "Waxen Litany entrance styling must be bundled");
assert.ok(coverCss.includes("animation-play-state: paused !important"), "Inactive entrance themes must pause their animations");
assert.ok(coverCss.includes(".gg-section-open .gg-closed .gg-cover-visual"), "Closed-cover animations must pause while the grimoire is open");
assert.ok(grimoireSource.includes('id: "ossuary"') && grimoireSource.includes('id: "eye"') && grimoireSource.includes('id: "wax"'), "All additional entrance themes must participate in the cycle");
assert.equal(auxiliaryCss.includes("gg-cover-aura"), false, "Reduced-motion rules must not retain removed aura selectors");
assert.equal(auxiliaryCss.includes("gg-cover-wave"), false, "Reduced-motion rules must not retain removed wave selectors");
assert.ok(auxiliaryCss.includes(".gg-safe-cast"), "Responsive rules must include Safe Casting");
assert.ok(auxiliaryCss.includes(".gg-halo-orbit") && auxiliaryCss.includes(".gg-cathedral-chain"), "Reduced-motion rules must cover Halo and Cathedral entrance animations");
assert.ok(uiInteractionsSource.includes("runtime.spellTooltipFrame = requestAnimationFrame"), "Spell tooltip movement must be frame-coalesced");
assert.ok(grimoireSource.includes("constellationLayoutCache"), "Constellation geometry must use a bounded deterministic layout cache");
assert.ok(castFxSource.includes("resolve?.();"), "Cast FX disposal must settle the active queue promise");
assert.ok(audioSource.includes("durationPromise"), "Cast audio handles must expose the resolved audio duration");
assert.ok(castFxSource.includes("castFxSoundDurationMultiplier"), "Cast sigil duration must use the configurable sound-duration multiplier");
assert.ok(castFxSource.includes('range: { min: 0.5, max: 2, step: 0.05 }'), "Cast sigil sound-duration multiplier must expose a 0.5-2.0 slider");
assert.ok(castFxSource.includes('overlay.classList.add("is-visible")'), "Cast FX must reveal only after the overlay has been committed to a frame");
assert.equal(effectsCss.includes("animation: gg-cast-fx-in"), false, "Full-screen cast overlay must not animate transform/opacity together because Chromium can flash the dark backing layer");
assert.equal(castFxSource.includes("stopSound(state.audioHandle"), false, "Cast FX cleanup must not cut off one-shot cast audio");
assert.ok(castNetworkSource.includes("messageDataFactory"), "Cast audit flags must be embedded in the initial roll message instead of requiring a second ChatMessage update");
assert.ok(castNetworkSource.includes("schedulePostCastTask"), "Mishap RollTable work must be deferred until after the cast FX is published");
assert.ok(audioSource.includes("randomPlaylistSource"), "Audio settings must support randomized Foundry Playlist sources");
assert.ok(audioSource.includes("SoundPlaylist"), "Every audio slot must register a shared playlist source setting");
assert.ok(audioSource.includes('"castFxHighPower"'), "Audio settings must expose a dedicated high-power cast source");
assert.ok(audioSource.includes('"castFxMishap"'), "Audio settings must expose a dedicated mishap cast source");
assert.ok(castFxSource.includes('playConfiguredSound("castFxMishap", { minimumInterval: 0 })'), "Mishap casts must select the dedicated mishap sound");
assert.ok(castFxSource.includes('if (payload?.mishap)'), "Mishap sound selection must take precedence over PL > 5 sound selection");
assert.equal(castFxSource.includes("feDisplacementMap"), false, "Mishap FX must avoid the expensive animated SVG displacement filter");
assert.ok(effectsCss.includes("gg-cast-fx-mishap-warp"), "Mishap cast sigils must retain a transform-only distortion animation");
assert.ok(effectsCss.includes("gg-cast-fx-mishap-twist"), "Mishap cast sigils must receive a twisted presentation animation");
assert.ok(castNetworkSource.includes("requiresChanceCasting(actor, spell)"), "The authoritative GM must force Chance Casting when spell rank exceeds the actor's highest magic talent rank");
assert.ok(castNetworkSource.includes("mishapUnits: castResult.mishapUnits"), "Authoritative cast results and FX payloads must carry mishap severity data");
assert.ok(yearZeroRollSource.includes("yearZeroOnes"), "Shared Year Zero roll handling must expose spell-die one counting");
assert.ok(mishapSource.includes('registerMenu(MODULE_ID, "mishapMenu"'), "Mishap RollTables must be configurable in a dedicated GM settings menu");
assert.ok(mishapSource.includes("MAX_MISHAP_LEVEL = 6"), "Mishap table routing must cap at the configured 0-6 scale");
assert.ok(castFxSource.includes("Number(payload?.powerLevel ?? 0) > 5"), "Final PL above 5 must select the dedicated cast sound when configured");
assert.ok(castFxSource.includes('playConfiguredSound("castFx", { minimumInterval: 0 })'), "High-power casts must retain fallback to the normal cast sound");
assert.ok(castNetworkSource.includes("powerLevel: castResult.powerLevel"), "Cast FX payloads must carry authoritative final Power Level");
assert.ok(auxiliaryCss.includes(".gg-audio-playlist-control select"), "Sound manager playlist controls must receive explicit dark styling");
assert.ok(mainSource.includes("shutdownCastFx();"), "Foundry shutdown must dispose cast effects");
assert.ok(mainSource.includes("userId ? game.user?.id !== userId : !isAuthoritativeGm()"), "Deleted-spell cleanup must run only on the initiating client or authority fallback");
assert.ok(mainSource.includes("isAuthoritativeGm()"), "Document migrations must use the shared GM authority");
assert.ok(authoritySource.includes("activeAuthoritativeGm"), "Shared GM authority module must exist");
assert.ok(drawingSource.includes('"lostpointercapture"'), "Drawing must cancel safely on pointer-capture loss");
assert.ok(drawingSource.includes("backingCanvas"), "Drawing must cache completed strokes in a backing canvas");
assert.ok(drawingSource.includes("autoDraw(strokes"), "Drawing controller must expose auto-draw support");
assert.ok(drawingSource.includes("if (destroyed) return;"), "Destroyed drawing controllers must not schedule new redraw frames");
assert.equal(drawingSource.includes("animationReject"), false, "Auto-draw cancellation must not reject into detached UI handlers");
assert.ok(drawingSource.includes("getCoalescedEvents"), "Drawing must consume coalesced pointer samples");
assert.ok(sigilSource.includes("comparisonTargetCache"), "Recognition must cache target-only geometry");
assert.ok(grimoireSource.includes("scheduleOverlayPosition"), "Overlay geometry work must be frame-coalesced");
assert.ok(grimoireSource.includes("scheduleTabVisibilityCheck"), "Leaving the Talents tab must close an open grimoire");
assert.ok(grimoireSource.includes("runtime.app?.minimized"), "Minimizing the actor sheet must hide the grimoire overlay");
assert.ok(grimoireSource.includes("runtimeByApp.get(app.appId) !== runtime"), "Async sheet setup must reject stale runtimes");
assert.ok(grimoireSource.includes("destroyActorSheet(app);"), "Ineligible actor rerenders must dispose stale runtimes");
assert.ok(grimoireSource.includes("UNLOCK_SIGIL_VERSION"), "Runtime unlock validation must use the shared schema version");
assert.equal(grimoireSource.includes("function spellSigilSeed"), false, "The grimoire must use the shared sigil seed implementation");
assert.equal(castNetworkSource.includes("function spellSigilSeed"), false, "The authoritative cast resolver must use the shared sigil seed implementation");
assert.ok(grimoireSource.includes("spellSigilSeed"), "The grimoire must import the shared spell sigil seed");
assert.ok(castNetworkSource.includes("spellSigilSeed"), "The cast resolver must import the shared spell sigil seed");
assert.ok(grimoireSource.includes('spell.sendToChat()'), "Spell chat must use the Forbidden Lands item method");
assert.equal(grimoireSource.includes("gg-chat-spell"), false, "Custom spell chat cards must remain removed");
assert.ok(grimoireSource.includes("bindDelayedSpellTooltip"), "Spell nodes must expose delayed hover tooltips");
assert.ok(grimoireSource.includes("positionFloatingAtClient(menu, layer, event.clientX, event.clientY)"), "Context menus must use click coordinates relative to their actual layer");
assert.ok(uiInteractionsSource.includes("1400 + Math.random() * 7200"), "Constellation sparks must use random intervals");
assert.ok(uiInteractionsSource.includes("Math.floor(Math.random() * liveLinks.length)"), "Constellation sparks must select random links");
assert.ok(audioSource.includes('registerMenu(MODULE_ID, "audioMenu"'), "Sound controls must live in a dedicated settings menu");
assert.ok(audioSource.includes("config: false"), "Individual sound settings must not clutter the main settings panel");
assert.ok(audioSource.includes("previewAudio"), "The sound palette must preview unsaved path and volume values");
assert.equal(/addEventListener\("submit"[\s\S]{0,900}\{ once: true \}/.test(audioSource), false, "Audio settings submit must remain usable after a failed save");
assert.ok(audioSource.includes("dataset.ggSubmitBound"), "Repeated Application V2 audio renders must not duplicate submit listeners");
assert.ok(audioSource.includes("dataset.ggBound"), "Repeated Application V2 audio renders must not duplicate control listeners");
const appearanceSource = fs.readFileSync(path.join(root, "scripts/appearance-settings.js"), "utf8");
assert.equal(/addEventListener\("submit"[\s\S]{0,900}\{ once: true \}/.test(appearanceSource), false, "Appearance settings submit must remain usable after a failed save");
assert.ok(appearanceSource.includes("dataset.ggSubmitBound"), "Repeated Application V2 appearance renders must not duplicate submit listeners");
assert.ok(appearanceSource.includes("dataset.ggBound"), "Repeated Application V2 appearance renders must not duplicate browse listeners");
assert.ok(effectsCss.includes(".gg-cast-fx-enhancement .gg-ink-main"), "Enhancement cast effects must retain explicit ink styling");
assert.ok(effectsCss.includes("stroke: rgba(255, 249, 244, 0.98)"), "Enhancement lines must use the same white ink as the main cast sigil");
for (const template of ["templates/mishap-settings.hbs", "templates/mishap-settings-v2.hbs"]) {
  assert.equal(fs.existsSync(path.join(root, template)), true, `${template} must exist`);
  const templateSource = fs.readFileSync(path.join(root, template), "utf8");
  assert.ok(templateSource.includes("gg-mishap-settings-list"), `${template} must expose the 0-6 RollTable mapping`);
}
for (const template of ["templates/audio-settings.hbs", "templates/audio-settings-v2.hbs"]) {
  assert.equal(fs.existsSync(path.join(root, template)), true, `${template} must exist`);
  const templateSource = fs.readFileSync(path.join(root, template), "utf8");
  assert.ok(templateSource.includes("gg-audio-grid"), `${template} must use the compact sound palette grid`);
  assert.ok(templateSource.includes("gg-audio-preview"), `${template} must expose preview controls`);
  assert.equal(templateSource.includes("gg-audio-setting"), false, `${template} must not retain the oversized legacy sound cards`);
}
assert.equal(grimoireSource.includes('<animate attributeName="d"'), false, "Closed-cover paths must not run per-path geometry animations");
assert.equal(/\.gg-book\s*\{[^}]*filter\s*:/s.test(bookCss), false, "Dynamic book descendants must not sit under a full-book filter");
assert.ok((grimoireSource.match(/lostpointercapture/g) ?? []).length >= 2, "Spell-seal dragging must clean up pointer-capture loss");
assert.equal(grimoireSource.includes("runtime.unlocked"), false, "Unused unlock runtime state must remain removed");
assert.equal(grimoireSource.includes("runtime.selectedSpellId"), false, "Unused selected-spell runtime state must remain removed");
assert.equal(grimoireSource.includes("sigilSimilarityScore"), false, "Unused similarity runtime state must remain removed");
assert.equal(grimoireSource.includes("read-only in this prototype"), false, "Prototype wording must not leak into the production UI");
assert.equal(sigilSource.includes("flattenSigil"), false, "Unused sigil helper must remain removed");

const staleLocalizationKeys = [
  "GG.Ritual", "GG.NoWillpowerDraw", "GG.ContractTooLong", "GG.BonusPower",
  "GG.PerfectSigilBonus", "GG.RequiredSimilarity", "GG.SigilTooImprecise", "GG.SigilIncomplete",
  "GG.Dice", "GG.PowerLevel", "GG.Seal"
];
const en = JSON.parse(fs.readFileSync(path.join(root, "lang/en.json"), "utf8"));
const ru = JSON.parse(fs.readFileSync(path.join(root, "lang/ru.json"), "utf8"));
assert.deepEqual(Object.keys(en), Object.keys(ru), "English and Russian localization keys must stay aligned");
for (const key of staleLocalizationKeys) {
  assert.equal(Object.hasOwn(en, key), false, `Obsolete English localization key ${key} must be removed`);
  assert.equal(Object.hasOwn(ru, key), false, `Obsolete Russian localization key ${key} must be removed`);
}
assert.equal(en['GG.AutoDraw'], 'Auto-draw sigil');
assert.equal(ru['GG.AutoDraw'], 'Автоначертание сигилла');
const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
assert.ok(readme.startsWith(`# Goetia Grimoire ${manifest.version}`), "README title must match the package version");
assert.equal(fs.existsSync(path.join(root, "AUDIT-0.6.5.md")), false, "Stale audit documents must be removed");
assert.equal(fs.existsSync(path.join(root, `AUDIT-${manifest.version}.md`)), true, "The current audit document must be included");

const scriptPaths = [...fs.readdirSync(path.join(root, "scripts"))]
  .filter((name) => name.endsWith(".js"))
  .map((name) => path.join("scripts", name));
const importGraph = new Map(scriptPaths.map((relativePath) => [relativePath, []]));
for (const relativePath of scriptPaths) {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  for (const match of source.matchAll(/from\s+["'](\.\/[^"']+)["']/g)) {
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(relativePath), match[1]));
    if (importGraph.has(target)) importGraph.get(relativePath).push(target);
  }
}
const reachable = new Set();
const pending = ["scripts/main.js"];
while (pending.length) {
  const current = pending.pop();
  if (reachable.has(current)) continue;
  reachable.add(current);
  pending.push(...(importGraph.get(current) ?? []));
}
assert.deepEqual([...reachable].sort(), scriptPaths.sort(), "Every JavaScript source file must be reachable from main.js");

const literalLocalizationKeys = new Set();
for (const relativePath of [...scriptPaths, ...fs.readdirSync(path.join(root, "templates")).filter((name) => name.endsWith(".hbs")).map((name) => path.join("templates", name))]) {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  for (const match of source.matchAll(/["'](GG\.[A-Za-z0-9_.-]+)["']/g)) literalLocalizationKeys.add(match[1]);
}
for (const key of literalLocalizationKeys) {
  assert.equal(Object.hasOwn(en, key), true, `Literal localization key ${key} must exist in English`);
  assert.equal(Object.hasOwn(ru, key), true, `Literal localization key ${key} must exist in Russian`);
}

console.log(`Goetia Grimoire smoke tests passed: ${checked} generated spell sigils.`);
