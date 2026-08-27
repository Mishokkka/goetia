import {
  MODULE_ID,
  PERFECT_SIGIL_SIMILARITY,
  SPELL_BIND_MIN_SIMILARITY,
  hasPsychicPower,
  isMagicTalent,
  isMiracleWorker,
  requiresChanceCasting,
  spellSigilSeed
} from "./config.js";
import {
  compareDrawingToSigil,
  createSpellSigil,
  createUnlockSigil,
  hashString,
  mulberry32,
  normalizeSigilForDisplay,
  sigilToSvgMarkup,
  UNLOCK_SIGIL_VERSION
} from "./sigil.js";
import { requestAuthoritativeCast } from "./cast-network.js";
import { playConfiguredSound } from "./audio-service.js";
import { DEFAULT_DRAWING_LIMITS, attachDrawing, denormalizeCanvasStrokes, normalizedCanvasStrokes } from "./drawing-controller.js";
import { findSheetNavigation, resolveActorSheetTargets, unwrapHtml } from "./sheet-adapter.js";
import { bindContractEditor, contractMarkup, destroyContractEditor, destroyContractPagination } from "./contract-view.js";
import {
  bindDelayedSpellTooltip,
  clearLinkSparkSchedule,
  closeSpellTooltip,
  positionFloatingAtClient,
  scheduleRandomLinkSparks
} from "./ui-interactions.js";
import { bindTraining, trainingMarkup } from "./training.js";
import { spellTooltipMarkup } from "./spell-tooltip.js";

const runtimeByApp = new Map();
const spellSigilCache = new Map();
const constellationLayoutCache = new Map();
const MAX_SPELL_SIGIL_CACHE = 512;
const MAX_CONSTELLATION_LAYOUT_CACHE = 128;
const BOOKMARK_RISE = 112;
const MIN_BOOK_WIDTH = 720;
const MIN_BOOK_HEIGHT = 470;
const MAX_EXTRA_MARKS = 12;

function localize(key, fallback) {
  const value = game.i18n.localize(key);
  return value === key ? fallback : value;
}

function runUiTask(label, task) {
  void Promise.resolve().then(task).catch((error) => {
    console.error(`Goetia Grimoire | ${label} failed.`, error);
    ui.notifications.error(localize("GG.UiActionFailed", "The grimoire action could not be completed."));
  });
}

function upperLabel(value) {
  return String(value ?? "").toLocaleUpperCase(game.i18n?.lang ?? "en-US");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function tooltipAttributes(label, direction = "UP") {
  const escaped = escapeHtml(label);
  return `aria-label="${escaped}" data-gg-tooltip="${escaped}" data-gg-tooltip-direction="${direction}"`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function fitTextEntries(entries) {
  const pending = entries
    .filter(({ element }) => element instanceof HTMLElement && element.clientWidth >= 2)
    .map(({ element, minFontSize }) => {
      element.style.fontSize = "";
      element.style.letterSpacing = "";
      element.style.removeProperty("--gg-fit-scale");
      return { element, minFontSize };
    });
  if (!pending.length) return;

  // Batch all writes and all geometry reads by search round. The resulting
  // font sizes are the same binary-search result as before, but Chromium only
  // needs to reconcile layout once per round instead of once per label.
  const active = [];
  for (const entry of pending) {
    const computed = getComputedStyle(entry.element);
    const maxFontSize = Math.max(entry.minFontSize, Number.parseFloat(computed.fontSize) || 16);
    const availableWidth = entry.element.clientWidth;
    if (entry.element.scrollWidth <= availableWidth + 1) continue;
    active.push({ ...entry, maxFontSize, availableWidth, low: entry.minFontSize, high: maxFontSize });
  }
  if (!active.length) return;

  for (let index = 0; index < 8; index += 1) {
    for (const entry of active) {
      entry.size = (entry.low + entry.high) / 2;
      entry.element.style.fontSize = `${entry.size}px`;
    }
    for (const entry of active) {
      if (entry.element.scrollWidth <= entry.availableWidth + 1) entry.low = entry.size;
      else entry.high = entry.size;
    }
  }

  for (const entry of active) {
    entry.element.style.fontSize = `${Math.max(entry.minFontSize, entry.low - 0.15).toFixed(2)}px`;
  }

  const needsTightSpacing = active.filter((entry) => entry.element.scrollWidth > entry.availableWidth + 1);
  for (const entry of needsTightSpacing) entry.element.style.letterSpacing = "0";

  for (const entry of needsTightSpacing) {
    const width = entry.element.scrollWidth;
    if (width <= entry.availableWidth + 1) continue;
    const scale = Math.max(0.01, entry.availableWidth / width);
    entry.element.style.setProperty("--gg-fit-scale", scale.toFixed(4));
  }
}

function fitSpellTitles(container) {
  if (!container?.querySelectorAll) return;
  fitTextEntries([
    ...[...container.querySelectorAll(".gg-ritual-title h2")].map((element) => ({ element, minFontSize: 8 })),
    ...[...container.querySelectorAll(".gg-node-label")].map((element) => ({ element, minFontSize: 5.5 }))
  ]);
}

function scheduleTitleFit(runtime) {
  if (!runtime?.overlay?.isConnected || runtime.titleFitFrame) return;
  runtime.titleFitFrame = requestAnimationFrame(() => {
    runtime.titleFitFrame = 0;
    if (runtime.overlay?.isConnected) fitSpellTitles(runtime.overlay);
  });
}

function cloneNormalizedStrokes(strokes) {
  return (Array.isArray(strokes) ? strokes : [])
    .filter(Array.isArray)
    .map((stroke) => stroke
      .filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y))
      .map((point) => ({ x: point.x, y: point.y })))
    .filter((stroke) => stroke.length >= 2);
}

function captureRuntimeState(runtime) {
  if (!runtime) return null;
  const overlayOpen = Boolean(runtime.overlay?.isConnected);
  if (!overlayOpen) return { overlayOpen: false };
  const currentView = overlayOpen && runtime.currentSpellId ? "ritual" : "tab";
  return {
    overlayOpen,
    activeTab: runtime.activeTab,
    selectedRank: runtime.selectedRank,
    trainingState: {
      selectedPathId: runtime.trainingSelectedPathId ?? null,
      selectedRank: runtime.trainingSelectedRank ?? 1,
      selection: foundry.utils.deepClone(runtime.trainingSelection ?? null),
      setupOpen: Boolean(runtime.trainingSetupOpen),
      newPathMode: Boolean(runtime.trainingNewPathMode)
    },
    currentView,
    currentSpellId: runtime.currentSpellId ?? null,
    ritualState: currentView === "ritual"
      ? {
          spellId: runtime.currentSpellId ?? null,
          mainSigilAccepted: Boolean(runtime.mainSigilAccepted),
          perfectPowerBonus: Math.max(0, Number(runtime.perfectPowerBonus) || 0),
          autoDrawUsed: Boolean(runtime.autoDrawUsed),
          options: foundry.utils.deepClone(runtime.options ?? {}),
          lastBoundSigil: cloneNormalizedStrokes(runtime.lastBoundSigil),
          mainStrokes: runtime.ritualController?.canvas?.isConnected
            ? cloneNormalizedStrokes(normalizedCanvasStrokes(runtime.ritualController.canvas, runtime.ritualController.getStrokes()))
            : cloneNormalizedStrokes(runtime.lastBoundSigil),
          extraMarks: (runtime.extraControllers?.length ? runtime.extraControllers : runtime.extraMarks).map((entry, index) => {
            if (entry?.canvas?.isConnected) {
              const strokes = cloneNormalizedStrokes(normalizedCanvasStrokes(entry.canvas, entry.getStrokes()));
              return strokes.length ? { strokes } : null;
            }
            const mark = runtime.extraMarks?.[index];
            return mark?.strokes?.length ? { strokes: cloneNormalizedStrokes(mark.strokes) } : null;
          })
        }
      : null
  };
}


async function confirmAction({ title, content }) {
  const DialogV2 = foundry.applications?.api?.DialogV2;
  if (DialogV2?.confirm) return DialogV2.confirm({ window: { title }, content, rejectClose: false });
  if (globalThis.Dialog?.confirm) return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    Dialog.confirm({
      title,
      content,
      yes: () => finish(true),
      no: () => finish(false),
      close: () => finish(false),
      defaultYes: false
    });
  });
  return window.confirm(`${title}\n\n${content.replace(/<[^>]+>/g, "")}`);
}



async function enrichHtml(content) {
  const editor = foundry.applications?.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
  if (!editor?.enrichHTML) return content;
  return editor.enrichHTML(content ?? "", { async: true, secrets: Boolean(game.user?.isGM) });
}

async function getUnlockSigil(actor) {
  const stored = actor.getFlag(MODULE_ID, "unlockSigil");
  if (Number(stored?.version) >= UNLOCK_SIGIL_VERSION && stored?.strokes?.length) return stored;
  const generated = createUnlockSigil(`${actor.uuid}:${actor.name}`);
  if (actor.isOwner) {
    await actor.update({ [`flags.${MODULE_ID}.unlockSigil`]: generated }, { render: false, diff: true }).catch(() => {});
  }
  return generated;
}

function similarityPercent(result) {
  return Math.round((result?.score ?? 0) * 1000) / 10;
}

function similarityText(result) {
  return `${localize("GG.Similarity", "Similarity")}: ${similarityPercent(result)}%`;
}

function recognized(result, threshold = 0.36) {
  return result.score >= threshold && result.majorCoverage >= 0.16 && result.coverage >= 0.18;
}

function spellKindLabel(spell) {
  const system = spell?.system ?? {};
  const candidates = [
    system.spellType,
    system.spelltype,
    system.kind,
    system.classification,
    system.category,
    system.spellKind,
    system.powerType,
    system.powerWordType,
    system.type
  ];
  const raw = candidates.find((entry) => typeof entry === "string" && entry.trim());
  if (!raw) return localize("GG.SpellType.Ritual", "Ritual");
  const normalized = String(raw)
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("en-US");
  if (normalized.includes("power word") || normalized.includes("powerword")) {
    return localize("GG.SpellType.PowerWord", "Power Word");
  }
  if (normalized.includes("ritual")) return localize("GG.SpellType.Ritual", "Ritual");
  if (normalized.includes("spell")) return localize("GG.SpellType.Spell", "Spell");
  const words = String(raw).trim().split(/\s+/);
  return words.filter((word, index) => index === 0 || word.toLocaleLowerCase() !== words[index - 1].toLocaleLowerCase()).join(" ");
}

function coverThemes() {
  return [
    { id: "threads", label: localize("GG.EntranceTheme.ThreadedVault", "Threaded Vault") },
    { id: "halo", label: localize("GG.EntranceTheme.InfernalHalo", "Infernal Halo") },
    { id: "cathedral", label: localize("GG.EntranceTheme.CathedralOfTeeth", "Cathedral of Teeth") },
    { id: "ossuary", label: localize("GG.EntranceTheme.OssuaryMechanism", "Ossuary Mechanism") },
    { id: "eye", label: localize("GG.EntranceTheme.AbyssalEye", "Abyssal Eye") },
    { id: "wax", label: localize("GG.EntranceTheme.WaxenLitany", "Waxen Litany") }
  ];
}

function resolveCoverTheme(themeId) {
  const themes = coverThemes();
  return themes.find((theme) => theme.id === themeId) ?? themes[0];
}

function storedCoverThemeId() {
  try {
    return resolveCoverTheme(game.settings.get(MODULE_ID, "entranceTheme")).id;
  } catch (_error) {
    return "threads";
  }
}

function nextCoverTheme(themeId) {
  const themes = coverThemes();
  const index = themes.findIndex((theme) => theme.id === themeId);
  return themes[(index + 1 + themes.length) % themes.length] ?? themes[0];
}

async function persistCoverTheme(themeId) {
  try {
    await game.settings.set(MODULE_ID, "entranceTheme", resolveCoverTheme(themeId).id);
  } catch (error) {
    console.error("Goetia Grimoire | Failed to store entrance theme.", error);
  }
}

function coverThemeSwitchTooltip(theme) {
  return `${localize("GG.EntranceTheme.Switch", "Switch entrance style")}: ${theme.label}`;
}

function coverThreadMarkup(actor) {
  const random = mulberry32(hashString(`${actor?.uuid ?? actor?.id ?? "cover"}:cover-lines-v3`));
  const count = 72;
  const paths = [];
  const pathFor = (baseX, pull, phase) => {
    const wave = Math.sin((baseX * 0.09) + phase) * (3.5 + random() * 4.5);
    const c1x = baseX + pull * (0.42 + random() * 0.18) + wave;
    const c1y = 18 + random() * 17;
    const c2x = baseX - pull * (0.24 + random() * 0.24) - wave * 0.65 + (random() - 0.5) * 5;
    const c2y = 57 + random() * 18;
    const endX = baseX + pull * (0.10 + random() * 0.16) + wave * 0.35 + (random() - 0.5) * 3.5;
    return `M ${baseX.toFixed(2)} -8 C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${endX.toFixed(2)} 108`;
  };
  for (let index = 0; index < count; index += 1) {
    const progress = count <= 1 ? 0.5 : index / (count - 1);
    const baseX = -7 + progress * 114 + (random() - 0.5) * 1.8;
    const pull = (0.5 - progress) * (28 + random() * 38);
    const path = pathFor(baseX, pull, random() * Math.PI * 2);
    const width = (0.22 + random() * 0.62).toFixed(2);
    const opacity = (0.018 + random() * 0.052).toFixed(3);
    paths.push(`<path class="gg-cover-thread" style="--gg-thread-width:${width}" stroke-opacity="${opacity}" d="${path}"></path>`);
  }
  const animated = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ? "" : " is-animated";
  return `<svg class="gg-cover-threadfield${animated}" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${paths.join("")}</svg>`;
}

function coverThreadsThemeMarkup(actor) {
  return `
    <div class="gg-cover-visual gg-cover-visual--threads" aria-hidden="true">
      <div class="gg-cover-shadows">
        <span class="gg-cover-shadow shadow-a"></span>
        <span class="gg-cover-shadow shadow-b"></span>
        <span class="gg-cover-shadow shadow-c"></span>
      </div>
      ${coverThreadMarkup(actor)}
    </div>`;
}

function coverHaloThemeMarkup(actor) {
  const random = mulberry32(hashString(`${actor?.uuid ?? actor?.id ?? "cover"}:cover-halo-v2`));
  const rays = Array.from({ length: 18 }, (_value, index) => {
    const rotate = (360 / 18) * index + (random() - 0.5) * 7;
    const height = 22 + random() * 20;
    const delay = (random() * -6).toFixed(2);
    const opacity = (0.18 + random() * 0.18).toFixed(3);
    return `<span class="gg-halo-ray" style="--gg-ray-rotate:${rotate.toFixed(2)}deg;--gg-ray-height:${height.toFixed(2)}%;--gg-ray-delay:${delay}s;--gg-ray-opacity:${opacity};"></span>`;
  }).join("");
  const embers = Array.from({ length: 13 }, () => {
    const x = 8 + random() * 84;
    const y = 8 + random() * 84;
    const size = 4 + random() * 10;
    const delay = (random() * -8).toFixed(2);
    const duration = (6 + random() * 9).toFixed(2);
    return `<span class="gg-halo-ember" style="left:${x.toFixed(2)}%;top:${y.toFixed(2)}%;--gg-ember-size:${size.toFixed(2)}px;--gg-ember-delay:${delay}s;--gg-ember-duration:${duration}s;"></span>`;
  }).join("");
  return `
    <div class="gg-cover-visual gg-cover-visual--halo" aria-hidden="true">
      <div class="gg-cover-halo-core">
        <div class="gg-halo-orbits">
          <span class="gg-halo-orbit ring-a"></span>
          <span class="gg-halo-orbit ring-b"></span>
          <span class="gg-halo-orbit ring-c"></span>
          <span class="gg-cover-halo-glyph"></span>
        </div>
        <div class="gg-cover-halo-rays">${rays}</div>
      </div>
      <div class="gg-cover-halo-embers">${embers}</div>
    </div>`;
}

function coverCathedralThemeMarkup(actor) {
  const random = mulberry32(hashString(`${actor?.uuid ?? actor?.id ?? "cover"}:cover-cathedral-v2`));
  const chains = Array.from({ length: 8 }, (_value, index) => {
    const x = 9 + index * 11 + (random() - 0.5) * 3.5;
    const length = 36 + random() * 28;
    const delay = (random() * -10).toFixed(2);
    return `<span class="gg-cathedral-chain" style="left:${x.toFixed(2)}%;--gg-chain-length:${length.toFixed(2)}%;--gg-chain-delay:${delay}s;"></span>`;
  }).join("");
  const motes = Array.from({ length: 16 }, () => {
    const x = 4 + random() * 92;
    const y = 6 + random() * 88;
    const size = 2 + random() * 5;
    const delay = (random() * -7).toFixed(2);
    const duration = (7 + random() * 8).toFixed(2);
    return `<span class="gg-cathedral-mote" style="left:${x.toFixed(2)}%;top:${y.toFixed(2)}%;--gg-mote-size:${size.toFixed(2)}px;--gg-mote-delay:${delay}s;--gg-mote-duration:${duration}s;"></span>`;
  }).join("");
  return `
    <div class="gg-cover-visual gg-cover-visual--cathedral" aria-hidden="true">
      <div class="gg-cathedral-backdrop">
        <span class="gg-cathedral-window"></span>
        <span class="gg-cathedral-arch arch-left"></span>
        <span class="gg-cathedral-arch arch-mid"></span>
        <span class="gg-cathedral-arch arch-right"></span>
        <span class="gg-cathedral-thorns"></span>
      </div>
      <div class="gg-cathedral-chains">${chains}</div>
      <div class="gg-cathedral-motes">${motes}</div>
    </div>`;
}


function coverOssuaryThemeMarkup(actor) {
  const random = mulberry32(hashString(`${actor?.uuid ?? actor?.id ?? "cover"}:cover-ossuary-v1`));
  const spokes = Array.from({ length: 14 }, (_value, index) => {
    const rotate = (360 / 14) * index + (random() - 0.5) * 4;
    const length = 32 + random() * 13;
    const delay = (random() * -8).toFixed(2);
    return `<span class="gg-ossuary-spoke" style="--gg-bone-angle:${rotate.toFixed(2)}deg;--gg-bone-length:${length.toFixed(2)}%;--gg-bone-delay:${delay}s;"></span>`;
  }).join("");
  const dust = Array.from({ length: 18 }, () => {
    const x = 5 + random() * 90;
    const y = 5 + random() * 90;
    const size = 2 + random() * 5;
    const delay = (random() * -9).toFixed(2);
    const duration = (8 + random() * 10).toFixed(2);
    return `<span class="gg-ossuary-dust" style="left:${x.toFixed(2)}%;top:${y.toFixed(2)}%;--gg-dust-size:${size.toFixed(2)}px;--gg-dust-delay:${delay}s;--gg-dust-duration:${duration}s;"></span>`;
  }).join("");
  return `
    <div class="gg-cover-visual gg-cover-visual--ossuary" aria-hidden="true">
      <div class="gg-ossuary-wheel">
        <span class="gg-ossuary-orbit outer"></span>
        <span class="gg-ossuary-orbit inner"></span>
        <span class="gg-ossuary-hub"></span>
        <div class="gg-ossuary-spokes">${spokes}</div>
      </div>
      <span class="gg-ossuary-jaw jaw-left"></span>
      <span class="gg-ossuary-jaw jaw-right"></span>
      <div class="gg-ossuary-dustfield">${dust}</div>
    </div>`;
}

function coverEyeThemeMarkup(actor) {
  const random = mulberry32(hashString(`${actor?.uuid ?? actor?.id ?? "cover"}:cover-eye-v1`));
  const tendrils = Array.from({ length: 10 }, (_value, index) => {
    const rotate = (360 / 10) * index + (random() - 0.5) * 10;
    const width = 48 + random() * 38;
    const delay = (random() * -7).toFixed(2);
    return `<span class="gg-eye-tendril" style="--gg-tendril-angle:${rotate.toFixed(2)}deg;--gg-tendril-width:${width.toFixed(2)}%;--gg-tendril-delay:${delay}s;"></span>`;
  }).join("");
  return `
    <div class="gg-cover-visual gg-cover-visual--eye" aria-hidden="true">
      <div class="gg-eye-tendrils">${tendrils}</div>
      <div class="gg-abyssal-eye">
        <span class="gg-eye-sclera"></span>
        <span class="gg-eye-iris"></span>
        <span class="gg-eye-pupil"></span>
        <span class="gg-eye-glint"></span>
        <span class="gg-eye-lid lid-top"></span>
        <span class="gg-eye-lid lid-bottom"></span>
      </div>
      <span class="gg-eye-vignette"></span>
    </div>`;
}

function coverWaxThemeMarkup(actor) {
  const random = mulberry32(hashString(`${actor?.uuid ?? actor?.id ?? "cover"}:cover-wax-v1`));
  const candles = Array.from({ length: 12 }, (_value, index) => {
    const x = 4 + index * 8.3 + (random() - 0.5) * 2.4;
    const height = 42 + random() * 48;
    const width = 11 + random() * 7;
    const delay = (random() * -5).toFixed(2);
    return `<span class="gg-wax-candle" style="left:${x.toFixed(2)}%;--gg-candle-height:${height.toFixed(2)}px;--gg-candle-width:${width.toFixed(2)}px;--gg-flame-delay:${delay}s;"><i class="gg-wax-flame"></i><i class="gg-wax-wick"></i></span>`;
  }).join("");
  const drips = Array.from({ length: 16 }, (_value, index) => {
    const x = index * 6.7 + random() * 3;
    const length = 12 + random() * 54;
    const delay = (random() * -9).toFixed(2);
    return `<span class="gg-wax-drip" style="left:${x.toFixed(2)}%;--gg-drip-length:${length.toFixed(2)}px;--gg-drip-delay:${delay}s;"></span>`;
  }).join("");
  return `
    <div class="gg-cover-visual gg-cover-visual--wax" aria-hidden="true">
      <div class="gg-wax-ceiling">${drips}</div>
      <div class="gg-wax-seal">
        <span class="gg-wax-seal-ring outer"></span>
        <span class="gg-wax-seal-ring inner"></span>
        <span class="gg-wax-seal-mark"></span>
      </div>
      <div class="gg-wax-candles">${candles}</div>
      <span class="gg-wax-smoke"></span>
    </div>`;
}

function closedCoverMarkup(actor) {
  const autoDraw = localize("GG.AutoDraw", "Auto-draw sigil");
  const clear = localize("GG.ClearDrawing", "Clear");
  const finish = localize("GG.FinishSigil", "Close the seal");
  const theme = resolveCoverTheme(storedCoverThemeId());
  const switchTooltip = coverThemeSwitchTooltip(theme);
  return `
    <div class="gg-closed" data-gg-actor="${escapeHtml(actor.id)}" data-gg-cover-theme="${theme.id}">
      <div class="gg-cover-vault" aria-hidden="true">
        ${coverThreadsThemeMarkup(actor)}
        ${coverHaloThemeMarkup(actor)}
        ${coverCathedralThemeMarkup(actor)}
        ${coverOssuaryThemeMarkup(actor)}
        ${coverEyeThemeMarkup(actor)}
        ${coverWaxThemeMarkup(actor)}
      </div>
      <div class="gg-cover-theme-ui">
        <span class="gg-cover-theme-name" data-gg-theme-label>${escapeHtml(theme.label)}</span>
        <button type="button" class="gg-cover-theme-cycle gg-icon-button gg-icon-button-small" ${tooltipAttributes(switchTooltip)} aria-label="${escapeHtml(switchTooltip)}">
          <i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i>
        </button>
      </div>
      <div class="gg-cover-lock">
        <canvas class="gg-unlock-canvas" aria-label="${escapeHtml(localize("GG.DrawUnlock", "Draw the personal sigil"))}"></canvas>
      </div>
      <div class="gg-drawing-status gg-cover-status" data-gg-status aria-live="polite"></div>
      <div class="gg-cover-tools" role="toolbar" aria-label="${escapeHtml(localize("GG.DrawUnlock", "Draw the personal sigil"))}">
        <button type="button" class="gg-auto-draw gg-icon-button" ${tooltipAttributes(autoDraw)}><i class="fa-solid fa-pencil" aria-hidden="true"></i></button>
        <button type="button" class="gg-clear-drawing gg-icon-button" ${tooltipAttributes(clear)}><i class="fa-solid fa-eraser" aria-hidden="true"></i></button>
        <button type="button" class="gg-finish-sigil gg-icon-button gg-icon-button-confirm" ${tooltipAttributes(finish)}><i class="fa-solid fa-diamond" aria-hidden="true"></i></button>
      </div>
    </div>`;
}
function getSheetZIndex(root) {
  const parsed = Number.parseInt(getComputedStyle(root).zIndex, 10);
  return Number.isFinite(parsed) ? parsed + 2 : 110;
}

function clampOverlayPosition(left, top, width, height) {
  const margin = 8;
  return {
    left: Math.max(margin, Math.min(left, window.innerWidth - width - margin)),
    top: Math.max(margin, Math.min(top, window.innerHeight - height - margin))
  };
}

function makeRuntime(app, html, actor, section, root) {
  return {
    app,
    html,
    actor,
    section,
    root,
    talentTab: section.closest(".talent-tab, [data-tab='talent'], [data-tab='talents']"),
    sheetNavigation: findSheetNavigation(html),
    overlay: null,
    unlockController: null,
    ritualController: null,
    extraControllers: [],
    observer: null,
    resizeObserver: null,
    tabObserver: null,
    tabVisibilityFrame: 0,
    selectedRank: null,
    activeTab: "spells",
    trainingSelectedPathId: null,
    trainingSelectedRank: 1,
    trainingSelection: null,
    trainingSetupOpen: false,
    trainingNewPathMode: false,
    trainingCatalog: null,
    extraMarks: [],
    lastBoundSigil: [],
    mainSigilAccepted: false,
    perfectPowerBonus: 0,
    contextMenu: null,
    spellTooltip: null,
    spellTooltipTimer: 0,
    spellTooltipFrame: 0,
    linkSparkTimer: 0,
    movingSpellId: null,
    moveCleanup: null,
    contractPagination: null,
    contractCache: null,
    trainingConfirmBackdrop: null,
    trainingConfirmCleanup: null,
    pendingUnlockTimer: 0,
    titleFitFrame: 0,
    overlayPositionFrame: 0,
    overlayGeometry: null,
    renderEpoch: 0,
    currentSpellId: null,
    autoDrawUsed: false,
    options: {
      ingredient: false,
      chance: false,
      psychicPower: hasPsychicPower(actor),
      safeCast: 0
    }
  };
}

function updateOverlayPosition(runtime) {
  if (!runtime.overlay?.isConnected || !runtime.section?.isConnected) return;
  const rect = runtime.section.getBoundingClientRect();
  const availableWidth = Math.max(1, window.innerWidth - 16);
  const availableHeight = Math.max(1, window.innerHeight - 16);
  const width = Math.min(availableWidth, Math.max(MIN_BOOK_WIDTH, rect.width * 2));
  const height = Math.min(availableHeight, Math.max(MIN_BOOK_HEIGHT, rect.height) + BOOKMARK_RISE);
  let left = rect.left;
  if (left + width > window.innerWidth - 8) left = Math.max(8, rect.right - width / 2);
  const position = clampOverlayPosition(left, rect.top - BOOKMARK_RISE, width, height);
  const next = {
    left: Math.round(position.left * 10) / 10,
    top: Math.round(position.top * 10) / 10,
    width: Math.round(width * 10) / 10,
    height: Math.round(height * 10) / 10,
    zIndex: getSheetZIndex(runtime.root)
  };
  const previous = runtime.overlayGeometry;
  const sizeChanged = !previous || previous.width !== next.width || previous.height !== next.height;
  if (!previous || Object.keys(next).some((key) => previous[key] !== next[key])) {
    Object.assign(runtime.overlay.style, {
      left: `${next.left}px`,
      top: `${next.top}px`,
      width: `${next.width}px`,
      height: `${next.height}px`,
      zIndex: String(next.zIndex)
    });
    runtime.overlayGeometry = next;
  }
  if (sizeChanged) scheduleTitleFit(runtime);
}

function scheduleOverlayPosition(runtime) {
  if (runtime.overlayPositionFrame) return;
  runtime.overlayPositionFrame = requestAnimationFrame(() => {
    runtime.overlayPositionFrame = 0;
    updateOverlayPosition(runtime);
  });
}

function getSpells(actor) {
  return actor.items
    .filter((item) => item.type === "spell")
    .sort((first, second) => {
      const rankDiff = Number(first.system.rank) - Number(second.system.rank);
      return rankDiff || first.name.localeCompare(second.name, game.i18n.lang);
    });
}

function getRanks(spells) {
  return [...new Set(spells.map((spell) => Number(spell.system.rank) || 1))].sort((a, b) => a - b);
}

function spellName(spell) {
  return spell.name.replace(/^\s*\d+\s*[-–—:]\s*/, "");
}

function spellSigil(actor, spell) {
  const seed = spellSigilSeed(actor, spell);
  const rank = Number(spell.system.rank) || 1;
  const key = `${seed}:${rank}`;
  const cached = spellSigilCache.get(key);
  if (cached) return cached;
  const generated = createSpellSigil(seed, rank);
  spellSigilCache.set(key, generated);
  if (spellSigilCache.size > MAX_SPELL_SIGIL_CACHE) spellSigilCache.delete(spellSigilCache.keys().next().value);
  return generated;
}

function freshSigilSalt() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  if (foundry.utils?.randomID) return foundry.utils.randomID(24);
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function organicConstellationLayout(spells, seedValue, width = 1000, height = 570, rank = 1, customPositions = {}) {
  const cacheKey = JSON.stringify([
    seedValue,
    width,
    height,
    Number(rank),
    spells.map((spell) => {
      const stored = customPositions?.[spell.id];
      return [
        spell.id,
        stored && Number.isFinite(Number(stored.x)) ? Number(stored.x) : null,
        stored && Number.isFinite(Number(stored.y)) ? Number(stored.y) : null,
        stored && Number.isFinite(Number(stored.rotation)) ? Number(stored.rotation) : null,
        stored && Number.isFinite(Number(stored.labelShift)) ? Number(stored.labelShift) : null,
        stored && Number.isFinite(Number(stored.labelRotation)) ? Number(stored.labelRotation) : null
      ];
    })
  ]);
  const cached = constellationLayoutCache.get(cacheKey);
  if (cached) {
    // Refresh insertion order so frequently used layouts remain in the
    // bounded cache without retaining Actor/Item document references.
    constellationLayoutCache.delete(cacheKey);
    constellationLayoutCache.set(cacheKey, cached);
    return cached.map((geometry, index) => ({ spell: spells[index], ...geometry }));
  }

  const random = mulberry32(hashString(seedValue));
  const nodes = [];
  const dense = spells.length > 8;
  const highRank = Number(rank) >= 4;
  const minimumDistance = highRank ? (dense ? 190 : 220) : (dense ? 120 : 150);
  const pageRanges = highRank
    ? [{ minX: 135, maxX: 400 }, { minX: 600, maxX: 880 }]
    : [{ minX: 130, maxX: 445 }, { minX: 555, maxX: 910 }];

  for (let index = 0; index < spells.length; index += 1) {
    const spell = spells[index];
    const stored = customPositions?.[spell.id];
    if (stored && Number.isFinite(Number(stored.x)) && Number.isFinite(Number(stored.y))) {
      nodes.push({
        spell,
        x: clamp(Number(stored.x), 95, 915),
        y: clamp(Number(stored.y), 72, height - 68),
        size: highRank ? 112 : 88,
        rotation: Number(stored.rotation) || 0,
        labelShift: Number(stored.labelShift) || 0,
        labelRotation: Number(stored.labelRotation) || 0,
        custom: true
      });
      continue;
    }

    const page = (index + Math.floor(random() * 2)) % 2;
    const range = pageRanges[page];
    let candidate = null;
    let best = null;
    let bestDistance = -1;

    for (let attempt = 0; attempt < 180; attempt += 1) {
      const test = {
        x: range.minX + random() * (range.maxX - range.minX),
        y: (highRank ? 100 : 82) + random() * (height - (highRank ? 202 : 158))
      };
      let nearest = Number.POSITIVE_INFINITY;
      for (const node of nodes) {
        nearest = Math.min(nearest, Math.hypot(test.x - node.x, test.y - node.y));
      }
      if (nearest > bestDistance) {
        bestDistance = nearest;
        best = test;
      }
      if (nearest >= minimumDistance) {
        candidate = test;
        break;
      }
    }

    candidate ??= best ?? { x: 200 + index * 60, y: 120 + index * 40 };
    nodes.push({
      spell,
      x: candidate.x,
      y: candidate.y,
      size: Math.round((highRank ? 102 : dense ? 68 : 80) + random() * (highRank ? 25 : dense ? 23 : 35)),
      rotation: (random() - 0.5) * (highRank ? 5 : 9),
      labelShift: Math.round((random() - 0.5) * (highRank ? 18 : 30)),
      labelRotation: (random() - 0.5) * (highRank ? 3 : 5),
      custom: false
    });
  }

  const geometry = nodes.map(({ spell: _spell, ...node }) => node);
  constellationLayoutCache.set(cacheKey, geometry);
  if (constellationLayoutCache.size > MAX_CONSTELLATION_LAYOUT_CACHE) {
    constellationLayoutCache.delete(constellationLayoutCache.keys().next().value);
  }
  return nodes;
}

function rankButtonsMarkup(ranks, selected) {
  return ranks.map((rank) => `
    <button type="button" class="gg-rank-tab ${rank === selected ? "is-active" : ""}" data-rank="${rank}">
      <span>${escapeHtml(localize("GG.Rank", "Rank"))}</span> ${rank}
    </button>`).join("");
}

function constellationLinks(nodes, seedValue, glowId) {
  const random = mulberry32(hashString(`${seedValue}:links-v3`));
  const reduceMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  return nodes.slice(1).map((node, index) => {
    const previousNodes = nodes.slice(0, index + 1);
    let from = previousNodes[0];
    let nearestDistance = Math.hypot(from.x - node.x, from.y - node.y);
    for (let candidateIndex = 1; candidateIndex < previousNodes.length; candidateIndex += 1) {
      const candidate = previousNodes[candidateIndex];
      const candidateDistance = Math.hypot(candidate.x - node.x, candidate.y - node.y);
      if (candidateDistance >= nearestDistance) continue;
      from = candidate;
      nearestDistance = candidateDistance;
    }
    const bend = (random() - 0.5) * 80;
    const controlX = (from.x + node.x) / 2 + bend;
    const controlY = (from.y + node.y) / 2 - bend * 0.35;
    const pathData = `M ${from.x.toFixed(1)} ${from.y.toFixed(1)} Q ${controlX.toFixed(1)} ${controlY.toFixed(1)} ${node.x.toFixed(1)} ${node.y.toFixed(1)}`;
    if (reduceMotion) return `<g class="gg-star-link"><path d="${pathData}"></path></g>`;

    const startDistance = Math.max(38, Number(from.size || 80) * 0.62);
    const endDistance = Math.max(38, Number(node.size || 80) * 0.62);
    const startDx = controlX - from.x;
    const startDy = controlY - from.y;
    const startLength = Math.max(1, Math.hypot(startDx, startDy));
    const endDx = controlX - node.x;
    const endDy = controlY - node.y;
    const endLength = Math.max(1, Math.hypot(endDx, endDy));
    const startX = from.x + (startDx / startLength) * startDistance;
    const startY = from.y + (startDy / startLength) * startDistance;
    const endX = node.x + (endDx / endLength) * endDistance;
    const endY = node.y + (endDy / endLength) * endDistance;
    const trimmedPath = `M ${startX.toFixed(1)} ${startY.toFixed(1)} Q ${controlX.toFixed(1)} ${controlY.toFixed(1)} ${endX.toFixed(1)} ${endY.toFixed(1)}`;
    const travel = (1.9 + random() * 2.2).toFixed(2);
    return `<g class="gg-star-link" data-gg-link="${index}"><path d="${pathData}"></path><ellipse class="gg-link-spark" rx="10" ry="2.2" fill="url(#${glowId})"><animate data-gg-spark-opacity attributeName="opacity" values="0;0.68;0.58;0" keyTimes="0;0.12;0.84;1" dur="${travel}s" begin="indefinite" fill="remove"></animate><animateMotion data-gg-spark-motion path="${trimmedPath}" rotate="auto" dur="${travel}s" begin="indefinite" fill="remove"></animateMotion></ellipse></g>`;
  }).join("");
}

function constellationMarkup(runtime) {
  const spells = getSpells(runtime.actor);
  const ranks = getRanks(spells);
  runtime.selectedRank = ranks.includes(runtime.selectedRank) ? runtime.selectedRank : ranks[0] ?? 1;
  const visible = spells.filter((spell) => (Number(spell.system.rank) || 1) === runtime.selectedRank);
  const layoutSeed = `${runtime.actor.uuid}:rank:${runtime.selectedRank}`;
  const customPositions = runtime.actor.getFlag(MODULE_ID, "spellPositions") ?? {};
  const nodes = organicConstellationLayout(visible, layoutSeed, 1000, 570, runtime.selectedRank, customPositions);
  const glowId = `gg-link-glow-${String(runtime.app.appId).replace(/[^a-zA-Z0-9_-]/g, "")}-${runtime.selectedRank}`;
  const nodeMarkup = nodes.map(({ spell, x, y, size, rotation, labelShift, labelRotation, custom }, index) => {
    const sigil = spellSigil(runtime.actor, spell);
    return `
      <button type="button" class="gg-spell-node gg-node-${index % 5} ${custom ? "is-custom-position" : ""}" data-spell-id="${escapeHtml(spell.id)}"
        style="left:${(x / 10).toFixed(2)}%;top:${(y / 5.7).toFixed(2)}%;--gg-size:${size}px;--gg-rot:${rotation.toFixed(2)}deg;--gg-label-shift:${labelShift}px;--gg-label-rot:${labelRotation.toFixed(2)}deg">
        <span class="gg-node-ring">${sigilToSvgMarkup(sigil, { className: "gg-node-sigil" })}</span>
        <span class="gg-node-label">${escapeHtml(spellName(spell))}</span>
      </button>`;
  }).join("");

  return `
    <div class="gg-constellation">
      <div class="gg-rank-whisper gg-rank-whisper-left">${escapeHtml(localize("GG.Rank", "Rank"))} ${runtime.selectedRank}</div>
      <div class="gg-rank-whisper gg-rank-whisper-right">${escapeHtml(localize("GG.Rank", "Rank"))} ${runtime.selectedRank}</div>
      <div class="gg-rank-tabs">${rankButtonsMarkup(ranks, runtime.selectedRank)}</div>
      <svg class="gg-star-lines" viewBox="0 0 1000 570" preserveAspectRatio="none"><defs><radialGradient id="${glowId}" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="rgb(255,247,228)" stop-opacity="0.78"></stop><stop offset="35%" stop-color="rgb(210,181,154)" stop-opacity="0.38"></stop><stop offset="100%" stop-color="rgb(126,22,32)" stop-opacity="0"></stop></radialGradient></defs>${constellationLinks(nodes, layoutSeed, glowId)}</svg>
      <div class="gg-stars">${nodeMarkup || `<p class="gg-empty">${escapeHtml(localize("GG.NoSpells", "No spells"))}</p>`}</div>
      <div class="gg-move-hint" hidden>${escapeHtml(localize("GG.MoveHint", "Drag the selected seal, then release it."))}</div>
    </div>`;
}

function baseOverlayMarkup(runtime) {
  return `
    <section class="gg-overlay" data-app-id="${escapeHtml(runtime.app.appId)}">
      <div class="gg-book">
        <div class="gg-page gg-page-left"></div>
        <div class="gg-page gg-page-right"></div>
        <div class="gg-spine"></div>
        <nav class="gg-book-tabs" role="tablist" aria-label="${escapeHtml(localize("GG.GrimoireSections", "Grimoire sections"))}">
          <button type="button" role="tab" data-tab="spells" class="is-active" aria-selected="true"><span class="gg-book-tab-label">${escapeHtml(upperLabel(localize("GG.Spells", "Spells")))}</span></button>
          <button type="button" role="tab" data-tab="training" aria-selected="false"><span class="gg-book-tab-label">${escapeHtml(upperLabel(localize("GG.Training", "Training")))}</span></button>
          <button type="button" role="tab" data-tab="contract" aria-selected="false"><span class="gg-book-tab-label">${escapeHtml(upperLabel(localize("GG.Contract", "Contract")))}</span></button>
        </nav>
        <button type="button" class="gg-close-book" title="${escapeHtml(localize("GG.Close", "Close"))}">×</button>
        <div class="gg-book-content"></div>
        <div class="gg-context-layer"></div>
      </div>
    </section>`;
}

function destroyExtraControllers(runtime) {
  for (const controller of runtime.extraControllers ?? []) controller?.destroy?.();
  runtime.extraControllers = [];
}

function cancelSpellMove(runtime) {
  runtime.moveCleanup?.();
  runtime.moveCleanup = null;
  runtime.movingSpellId = null;
}

function removeOverlay(runtime) {
  runtime.renderEpoch += 1;
  if (runtime.overlayPositionFrame) cancelAnimationFrame(runtime.overlayPositionFrame);
  runtime.overlayPositionFrame = 0;
  if (runtime.pendingUnlockTimer) clearTimeout(runtime.pendingUnlockTimer);
  runtime.pendingUnlockTimer = 0;
  destroyContractEditor(runtime);
  destroyContractPagination(runtime);
  runtime.trainingConfirmCleanup?.();
  clearLinkSparkSchedule(runtime);
  closeSpellTooltip(runtime);
  closeContextMenu(runtime);
  cancelSpellMove(runtime);
  runtime.ritualController?.destroy?.();
  runtime.ritualController = null;
  destroyExtraControllers(runtime);
  if (runtime.titleFitFrame) cancelAnimationFrame(runtime.titleFitFrame);
  runtime.titleFitFrame = 0;
  runtime.overlay?.remove();
  runtime.overlay = null;
  runtime.overlayGeometry = null;
  runtime.mainSigilAccepted = false;
  runtime.extraMarks = [];
  runtime.lastBoundSigil = [];
  runtime.currentSpellId = null;
  runtime.autoDrawUsed = false;
  runtime.section?.classList.remove("gg-section-open");
  if (runtime._rootPointerDown) {
    runtime.root?.removeEventListener("pointerdown", runtime._rootPointerDown);
    runtime._rootPointerDown = null;
  }
}

async function renderTab(runtime) {
  const content = runtime.overlay?.querySelector(".gg-book-content");
  if (!content) return;
  const renderEpoch = ++runtime.renderEpoch;
  runtime.trainingConfirmCleanup?.();
  runtime.ritualController?.destroy?.();
  runtime.ritualController = null;
  destroyExtraControllers(runtime);
  destroyContractEditor(runtime);
  destroyContractPagination(runtime);
  clearLinkSparkSchedule(runtime);
  closeSpellTooltip(runtime);
  cancelSpellMove(runtime);
  runtime.mainSigilAccepted = false;
  runtime.extraMarks = [];
  runtime.lastBoundSigil = [];
  runtime.currentSpellId = null;
  runtime.autoDrawUsed = false;

  let markup;
  if (runtime.activeTab === "spells") markup = constellationMarkup(runtime);
  else if (runtime.activeTab === "training") markup = await trainingMarkup(runtime);
  else markup = await contractMarkup(runtime);
  if (renderEpoch !== runtime.renderEpoch || !content.isConnected || !runtime.overlay?.isConnected) return;
  content.innerHTML = markup;
  scheduleTitleFit(runtime);
  runtime.overlay.classList.toggle("is-contract-tab", runtime.activeTab === "contract");
  runtime.overlay.classList.toggle("is-spells-tab", runtime.activeTab === "spells");

  runtime.overlay.querySelectorAll(".gg-book-tabs button").forEach((button) => {
    const active = button.dataset.tab === runtime.activeTab;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });
  bindTabListeners(runtime);
}

function closeContextMenu(runtime) {
  runtime.contextMenu?.remove?.();
  runtime.contextMenu = null;
}

async function postSpellToChat(_runtime, spell) {
  if (typeof spell?.sendToChat !== "function") {
    ui.notifications.error(localize("GG.StandardChatUnavailable", "Forbidden Lands item chat is unavailable."));
    return false;
  }
  try {
    await spell.sendToChat();
    return true;
  } catch (error) {
    console.error("Goetia Grimoire | Failed to send spell to chat.", error);
    ui.notifications.error(localize("GG.ChatSendFailed", "Unable to send the spell to chat."));
    return false;
  }
}

async function openSpellSheet(spell) {
  const sheet = spell?.sheet;
  if (!sheet?.render) return;
  try {
    await Promise.resolve(sheet.render(true));
  } catch (legacyError) {
    try {
      await Promise.resolve(sheet.render({ force: true }));
    } catch (error) {
      console.error("Goetia Grimoire | Failed to open spell sheet.", error, legacyError);
      ui.notifications.error(localize("GG.SpellOpenFailed", "Unable to open the spell sheet."));
    }
  }
}

async function saveSpellPosition(runtime, spellId, x, y) {
  const positions = foundry.utils.deepClone(runtime.actor.getFlag(MODULE_ID, "spellPositions") ?? {});
  positions[spellId] = { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
  await runtime.actor.update({ [`flags.${MODULE_ID}.spellPositions`]: positions }, { render: false });
}

function beginSpellMove(runtime, node) {
  if (!runtime.actor.isOwner) return;
  cancelSpellMove(runtime);
  closeContextMenu(runtime);
  runtime.movingSpellId = node.dataset.spellId;
  node.classList.add("is-move-ready");
  const hint = runtime.overlay.querySelector(".gg-move-hint");
  const stars = node.closest(".gg-stars");
  if (!stars) {
    runtime.movingSpellId = null;
    node.classList.remove("is-move-ready");
    return;
  }
  if (hint) hint.hidden = false;
  let dragging = false;
  let activePointerId = null;
  let starsRect = null;
  let pendingPointer = null;
  let moveFrame = 0;

  const applyMove = (event) => {
    if (!event || !starsRect || starsRect.width < 2 || starsRect.height < 2) return;
    const x = clamp(((event.clientX - starsRect.left) / starsRect.width) * 1000, 90, 920);
    const y = clamp(((event.clientY - starsRect.top) / starsRect.height) * 570, 65, 510);
    node.style.left = `${(x / 10).toFixed(2)}%`;
    node.style.top = `${(y / 5.7).toFixed(2)}%`;
    node.dataset.ggX = String(x);
    node.dataset.ggY = String(y);
  };

  const scheduleMove = (event) => {
    pendingPointer = event;
    if (moveFrame) return;
    moveFrame = requestAnimationFrame(() => {
      moveFrame = 0;
      const next = pendingPointer;
      pendingPointer = null;
      applyMove(next);
    });
  };

  const cleanup = () => {
    node.removeEventListener("pointerdown", down);
    node.removeEventListener("pointermove", move);
    node.removeEventListener("pointerup", finish);
    node.removeEventListener("pointercancel", cancelPointer);
    node.removeEventListener("lostpointercapture", cancelPointer);
    window.removeEventListener("keydown", cancelKey);
    if (moveFrame) cancelAnimationFrame(moveFrame);
    moveFrame = 0;
    pendingPointer = null;
    starsRect = null;
    node.classList.remove("is-moving", "is-move-ready");
    if (hint) hint.hidden = true;
    dragging = false;
    activePointerId = null;
    runtime.movingSpellId = null;
    if (runtime.moveCleanup === cleanup) runtime.moveCleanup = null;
  };

  const down = (event) => {
    if (event.button !== 0 || dragging) return;
    event.preventDefault();
    event.stopPropagation();
    starsRect = stars.getBoundingClientRect();
    if (starsRect.width < 2 || starsRect.height < 2) return;
    dragging = true;
    activePointerId = event.pointerId;
    node.classList.add("is-moving");
    try { node.setPointerCapture?.(event.pointerId); } catch (_error) {}
  };

  const move = (event) => {
    if (!dragging || event.pointerId !== activePointerId) return;
    event.preventDefault();
    scheduleMove(event);
  };

  const finish = async (event) => {
    if (!dragging || event.pointerId !== activePointerId) return;
    event.preventDefault();
    if (moveFrame) {
      cancelAnimationFrame(moveFrame);
      moveFrame = 0;
    }
    applyMove(event);
    const pointerId = event.pointerId;
    const spellId = node.dataset.spellId;
    const x = Number(node.dataset.ggX) || 500;
    const y = Number(node.dataset.ggY) || 285;
    node.dataset.ggMovedAt = String(Date.now());
    cleanup();
    try {
      if (node.hasPointerCapture?.(pointerId)) node.releasePointerCapture?.(pointerId);
    } catch (_error) {}
    try {
      await saveSpellPosition(runtime, spellId, x, y);
    } catch (error) {
      console.error("Goetia Grimoire | Failed to save spell position.", error);
      ui.notifications.error(localize("GG.PositionSaveFailed", "Unable to save the seal position."));
    }
  };

  const cancelPointer = (event) => {
    if (!dragging || event.pointerId !== activePointerId) return;
    cleanup();
    runUiTask("Render", () => renderTab(runtime));
  };

  const cancelKey = (event) => {
    if (event.key !== "Escape") return;
    cleanup();
    runUiTask("Render", () => renderTab(runtime));
  };

  runtime.moveCleanup = cleanup;
  node.addEventListener("pointerdown", down);
  node.addEventListener("pointermove", move);
  node.addEventListener("pointerup", finish);
  node.addEventListener("pointercancel", cancelPointer);
  node.addEventListener("lostpointercapture", cancelPointer);
  window.addEventListener("keydown", cancelKey);
}

function showSpellContextMenu(runtime, node, event) {
  event.preventDefault();
  event.stopPropagation();
  closeSpellTooltip(runtime);
  closeContextMenu(runtime);
  const spell = runtime.actor.items.get(node.dataset.spellId);
  if (!spell) return;
  const menu = document.createElement("div");
  menu.className = "gg-context-menu";
  menu.innerHTML = `
    ${runtime.actor.isOwner ? `<button type="button" data-action="move"><i class="fa-solid fa-arrows-up-down-left-right" aria-hidden="true"></i><span>${escapeHtml(localize("GG.MoveSpell", "Move seal"))}</span></button>` : ""}
    <button type="button" data-action="chat"><i class="fa-solid fa-message" aria-hidden="true"></i><span>${escapeHtml(localize("GG.SendToChat", "Send to chat"))}</span></button>
    ${(runtime.actor.isOwner || game.user.isGM) ? `<button type="button" data-action="edit"><i class="fa-solid fa-pen-to-square" aria-hidden="true"></i><span>${escapeHtml(localize("GG.EditSpell", "Edit spell"))}</span></button>` : ""}
    ${game.user.isGM ? `<button type="button" data-action="regenerate"><i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i><span>${escapeHtml(localize("GG.RegenerateSigil", "Regenerate seal"))}</span></button>` : ""}
    ${runtime.actor.isOwner ? `<button type="button" class="is-danger" data-action="delete"><i class="fa-solid fa-trash" aria-hidden="true"></i><span>${escapeHtml(localize("GG.DeleteSpell", "Delete spell"))}</span></button>` : ""}`;
  const layer = runtime.overlay.querySelector(".gg-context-layer");
  layer.append(menu);
  runtime.contextMenu = menu;
  positionFloatingAtClient(menu, layer, event.clientX, event.clientY);

  menu.querySelector("[data-action='move']")?.addEventListener("click", () => beginSpellMove(runtime, node));
  menu.querySelector("[data-action='edit']")?.addEventListener("click", () => {
    closeContextMenu(runtime);
    void openSpellSheet(spell);
  });
  menu.querySelector("[data-action='chat']")?.addEventListener("click", async () => {
    closeContextMenu(runtime);
    await postSpellToChat(runtime, spell);
  });
  menu.querySelector("[data-action='regenerate']")?.addEventListener("click", async () => {
    closeContextMenu(runtime);
    if (!game.user.isGM) return;
    const salts = foundry.utils.deepClone(runtime.actor.getFlag(MODULE_ID, "spellSigilSalts") ?? {});
    salts[spell.id] = freshSigilSalt();
    try {
      await runtime.actor.update({ [`flags.${MODULE_ID}.spellSigilSalts`]: salts }, { render: false });
      ui.notifications.info(localize("GG.SigilRegenerated", "The spell seal has been regenerated."));
      await renderTab(runtime);
    } catch (error) {
      console.error("Goetia Grimoire | Failed to regenerate spell seal.", error);
      ui.notifications.error(localize("GG.SigilRegenerateFailed", "Unable to regenerate the spell seal."));
    }
  });
  menu.querySelector("[data-action='delete']")?.addEventListener("click", async () => {
    closeContextMenu(runtime);
    const confirmed = await confirmAction({
      title: localize("GG.DeleteSpell", "Delete spell"),
      content: `<p>${escapeHtml(localize("GG.DeleteSpellConfirm", "Delete this spell from the actor?"))}</p><p><b>${escapeHtml(spellName(spell))}</b></p>`
    });
    if (!confirmed) return;
    try {
      await runtime.actor.deleteEmbeddedDocuments("Item", [spell.id], { render: false });
      await renderTab(runtime);
    } catch (error) {
      console.error("Goetia Grimoire | Failed to delete spell.", error);
      ui.notifications.error(localize("GG.DeleteSpellFailed", "Unable to delete the spell."));
    }
  });
}

function bindTabListeners(runtime) {
  runtime.overlay.querySelectorAll(".gg-rank-tab").forEach((button) => {
    button.addEventListener("click", () => {
      const rank = Number(button.dataset.rank);
      if (rank === runtime.selectedRank) return;
      runtime.selectedRank = rank;
      playConfiguredSound("pageTurn");
      runUiTask("Render", () => renderTab(runtime));
    });
  });
  runtime.overlay.querySelectorAll(".gg-spell-node").forEach((button) => {
    const spell = runtime.actor.items.get(button.dataset.spellId);
    if (spell) bindDelayedSpellTooltip(runtime, button, spellTooltipMarkup(spell), { delay: 500 });
    button.addEventListener("click", () => {
      if (runtime.movingSpellId || Date.now() - Number(button.dataset.ggMovedAt || 0) < 450) return;
      playConfiguredSound("pageTurn");
      runUiTask("Open ritual", () => openRitual(runtime, button.dataset.spellId));
    });
    button.addEventListener("contextmenu", (event) => showSpellContextMenu(runtime, button, event));
  });
  if (runtime.activeTab === "spells") scheduleRandomLinkSparks(runtime);
  bindTraining(runtime, { rerender: () => renderTab(runtime) });
  bindContractEditor(runtime, { rerender: () => renderTab(runtime) });
}

async function openBook(runtime, { silent = false, animate = true, restoreState = null } = {}) {
  if (runtime.overlay) return;
  runtime.section.classList.add("gg-section-open");
  document.body.insertAdjacentHTML("beforeend", baseOverlayMarkup(runtime));
  runtime.overlay = document.body.querySelector(`.gg-overlay[data-app-id="${CSS.escape(String(runtime.app.appId))}"]`);
  updateOverlayPosition(runtime);
  if (!silent) playConfiguredSound("bookOpen");
  if (animate) {
    runtime.overlay.animate(
      [
        { opacity: 0, transform: "perspective(900px) rotateY(12deg) scale(.97)" },
        { opacity: 1, transform: "perspective(900px) rotateY(0deg) scale(1)" }
      ],
      { duration: 280, easing: "cubic-bezier(.2,.8,.2,1)" }
    );
  }

  runtime.overlay.querySelector(".gg-close-book").addEventListener("click", () => removeOverlay(runtime));
  runtime.overlay.addEventListener("pointerdown", (event) => {
    if (!event.target.closest(".gg-context-menu")) closeContextMenu(runtime);
  });
  runtime.overlay.querySelectorAll(".gg-book-tabs button").forEach((button) => {
    button.addEventListener("click", () => {
      if (runtime.activeTab === button.dataset.tab) return;
      runtime.activeTab = button.dataset.tab;
      playConfiguredSound("tabSwitch");
      runUiTask("Render", () => renderTab(runtime));
    });
  });
  if (!runtime._rootPointerDown) {
    runtime._rootPointerDown = () => scheduleOverlayPosition(runtime);
    runtime.root.addEventListener("pointerdown", runtime._rootPointerDown, { passive: true });
  }
  if (restoreState?.activeTab) runtime.activeTab = restoreState.activeTab;
  if (Number.isFinite(Number(restoreState?.selectedRank))) runtime.selectedRank = Number(restoreState.selectedRank);
  if (restoreState?.trainingState) {
    runtime.trainingSelectedPathId = restoreState.trainingState.selectedPathId ?? null;
    runtime.trainingSelectedRank = Number(restoreState.trainingState.selectedRank) || 1;
    runtime.trainingSelection = foundry.utils.deepClone(restoreState.trainingState.selection ?? null);
    runtime.trainingSetupOpen = Boolean(restoreState.trainingState.setupOpen);
    runtime.trainingNewPathMode = Boolean(restoreState.trainingState.newPathMode);
  }
  if (restoreState?.currentView === "ritual" && restoreState.currentSpellId) {
    await openRitual(runtime, restoreState.currentSpellId, { restoreState: restoreState.ritualState });
    return;
  }
  await renderTab(runtime);
}

function getExtraSlotCount(runtime) {
  const willpower = Number(runtime.actor.system?.bio?.willpower?.value ?? 0);
  return Number.isFinite(willpower) ? Math.min(MAX_EXTRA_MARKS, Math.max(0, Math.floor(willpower) - 1)) : 0;
}

function radialLayout(count, { radius = 49, startAngle = -90 } = {}) {
  if (count <= 0) return [];
  return Array.from({ length: count }, (_, index) => {
    const angle = startAngle + (360 / count) * index;
    const radians = (angle * Math.PI) / 180;
    return { index, angle, x: 50 + Math.cos(radians) * radius, y: 50 + Math.sin(radians) * radius };
  });
}

function renderExtraMarks(runtime, container) {
  const list = container.querySelector(".gg-extra-list");
  if (!list) return;
  destroyExtraControllers(runtime);
  if (!runtime.mainSigilAccepted) {
    list.innerHTML = "";
    return;
  }

  const slots = radialLayout(getExtraSlotCount(runtime));
  const used = runtime.extraMarks ?? [];
  list.innerHTML = slots.map((slot, index) => {
    const classes = ["gg-extra-slot"];
    if (used[index]?.strokes?.length) classes.push("is-filled");
    const drawLabel = localize("GG.AddMarks", "Draw any shape here to add one Willpower Point.");
    const clearLabel = localize("GG.RemoveMark", "Right-click this drawing area to clear it.");
    return `<div class="${classes.join(" ")}" data-index="${index}" style="left:${slot.x}%;top:${slot.y}%" title="${escapeHtml(`${drawLabel} ${clearLabel}`)}"><canvas class="gg-extra-canvas" aria-label="${escapeHtml(drawLabel)}"></canvas><span>${index + 1}</span></div>`;
  }).join("");

  runtime.extraControllers = slots.map((slot, index) => {
    const area = list.querySelector(`.gg-extra-slot[data-index="${index}"]`);
    const canvas = area?.querySelector(".gg-extra-canvas");
    if (!area || !canvas) return null;
    const controller = attachDrawing(canvas, {
      drawGuide: false,
      maxStrokes: 8,
      maxPointsPerStroke: 64,
      maxTotalPoints: 256,
      onChange: (pixelStrokes) => {
        const strokes = normalizedCanvasStrokes(canvas, pixelStrokes);
        runtime.extraMarks[index] = strokes.length ? { strokes } : null;
        area.classList.toggle("is-filled", Boolean(strokes.length));
        updateRitualNumbers(runtime, container);
      },
      onStrokeComplete: async () => true
    });
    area.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      controller.clear();
    });
    const existing = used[index]?.strokes;
    if (existing?.length) requestAnimationFrame(() => {
      if (canvas.isConnected) controller.setCommitted(denormalizeCanvasStrokes(canvas, existing));
    });
    return controller;
  });
}

function filledExtraMarks(runtime) {
  return (runtime.extraMarks ?? []).filter((mark) => mark?.strokes?.length);
}

async function snapshotExtraMarks(runtime, container) {
  await Promise.all((runtime.extraControllers ?? []).map((controller) => controller?.whenIdle?.() ?? Promise.resolve()));
  runtime.extraMarks = (runtime.extraControllers ?? []).map((controller) => {
    if (!controller?.canvas?.isConnected) return null;
    const strokes = normalizedCanvasStrokes(controller.canvas, controller.getStrokes());
    return strokes.length ? { strokes } : null;
  });
  updateRitualNumbers(runtime, container);
  return filledExtraMarks(runtime);
}

function updateRitualNumbers(runtime, container) {
  const availableWillpower = Math.max(0, Number(runtime.actor.system?.bio?.willpower?.value ?? 0));
  const spent = 1 + filledExtraMarks(runtime).length;
  const psychic = runtime.options.psychicPower ? 1 : 0;
  const safeMax = spent + psychic;
  const bonusPower = runtime.mainSigilAccepted ? Math.max(0, Number(runtime.perfectPowerBonus) || 0) : 0;
  if (runtime.forcedChance) runtime.options.chance = true;
  if (runtime.options.chance) runtime.options.safeCast = 0;
  runtime.options.safeCast = Math.min(runtime.options.safeCast, safeMax);
  const dice = Math.max(0, spent + psychic - runtime.options.safeCast);
  const power = dice + runtime.options.safeCast + (runtime.options.ingredient ? 1 : 0);
  const spentNode = container.querySelector("[data-value='spent']");
  const diceNode = container.querySelector("[data-value='dice']");
  const powerNode = container.querySelector("[data-value='power']");
  const powerBonusNode = container.querySelector("[data-value='power-bonus']");
  if (spentNode) spentNode.textContent = String(spent);
  if (diceNode) diceNode.textContent = String(dice);
  if (powerNode) powerNode.textContent = String(power);
  if (powerBonusNode) {
    powerBonusNode.textContent = `+${bonusPower}`;
    powerBonusNode.classList.toggle("is-visible", bonusPower > 0);
    powerBonusNode.setAttribute("aria-hidden", String(!(bonusPower > 0)));
  }

  const safe = container.querySelector("select[name='safeCast']");
  const selected = runtime.options.safeCast;
  if (safe) {
    safe.innerHTML = Array.from({ length: safeMax + 1 }, (_, value) => `<option value="${value}" ${value === selected ? "selected" : ""}>${value}</option>`).join("");
    safe.disabled = runtime.options.chance;
  }

  const castButton = container.querySelector(".gg-cast-button");
  if (!castButton) return;
  const canAfford = availableWillpower >= spent;
  castButton.disabled = !runtime.mainSigilAccepted || !canAfford;
  castButton.classList.toggle("is-unaffordable", !canAfford);
  castButton.setAttribute("aria-disabled", String(castButton.disabled));
}

function ritualMarkup(runtime, spell, description) {
  const currentWp = Math.max(0, Number(runtime.actor.system?.bio?.willpower?.value ?? 0));
  const canDraw = currentWp > 0;
  const sigil = spellSigil(runtime.actor, spell);
  const undoStroke = localize("GG.UndoStroke", "Undo stroke");
  const clearDrawing = localize("GG.ClearDrawing", "Clear");
  const finishSigil = localize("GG.FinishSigil", "Close the seal");
  const undoMark = localize("GG.UndoMark", "Undo mark");
  const reset = localize("GG.Reset", "Reset");
  return `
    <div class="gg-ritual-layout">
      <section class="gg-page-panel gg-ritual-info">
        <header class="gg-ritual-heading">
          <div class="gg-ritual-title">
            <span>${escapeHtml(upperLabel(spellKindLabel(spell)))}</span>
            <div class="gg-ritual-title-row">
              <h2>${escapeHtml(spellName(spell))}</h2>
              <button type="button" class="gg-title-chat gg-icon-button" ${tooltipAttributes(localize("GG.SendToChat", "Send to chat"), "UP")}><i class="fa-solid fa-message" aria-hidden="true"></i></button>
            </div>
          </div>
        </header>
        <button type="button" class="gg-back gg-icon-button" ${tooltipAttributes(localize("GG.Back", "Back"), "UP")}><i class="fa-solid fa-chevron-left" aria-hidden="true"></i></button>

        <div class="gg-spell-meta">
          <span class="gg-meta-left"><b>${escapeHtml(localize("GG.Rank", "Rank"))}</b><strong>${escapeHtml(spell.system.rank)}</strong></span>
          <span class="gg-meta-left"><b>${escapeHtml(localize("GG.Range", "Range"))}</b><strong>${escapeHtml(spell.system.range)}</strong></span>
          <span class="gg-meta-wide gg-meta-duration gg-meta-left"><b>${escapeHtml(localize("GG.Duration", "Duration"))}</b><strong>${escapeHtml(spell.system.duration)}</strong></span>
          <span class="gg-meta-wide gg-meta-ingredient"><b>${escapeHtml(localize("GG.Ingredient", "Ingredient"))}</b><strong>${escapeHtml(spell.system.ingredient)}</strong></span>
        </div>

        <div class="gg-spell-description">${description}</div>

        <div class="gg-cast-ledger">
          <div class="gg-ritual-values" aria-label="${escapeHtml(localize("GG.Cast", "Complete the spell"))}">
            <span class="gg-ritual-metric gg-ritual-metric-wp"><b>${escapeHtml(localize("GG.Willpower", "WP"))}:</b><span class="gg-ritual-metric-line"><strong data-value="spent">1</strong><small>/ ${currentWp}</small></span></span>
            <span class="gg-ritual-metric gg-ritual-metric-center gg-ritual-metric-dice"><b>D:</b><span class="gg-ritual-metric-line"><strong data-value="dice">${runtime.options.psychicPower ? 2 : 1}</strong></span></span>
            <span class="gg-ritual-metric gg-ritual-metric-center gg-power-total-wrap"><b>PL:</b><span class="gg-ritual-metric-line gg-power-total"><strong data-value="power">${runtime.options.psychicPower ? 2 : 1}</strong><small class="gg-inline-power-bonus" data-value="power-bonus" aria-hidden="true">+0</small></span></span>
          </div>
          <div class="gg-ritual-options">
            <label><input type="checkbox" name="ingredient"><span>${escapeHtml(localize("GG.UseIngredient", "Use ingredient"))}</span></label>
            <label ${runtime.forcedChance ? tooltipAttributes(localize("GG.ChanceCastingForced", "Chance casting is required because the spell rank is higher than the actor's highest magic talent rank."), "UP") : ""}><input type="checkbox" name="chance" ${runtime.options.chance ? "checked" : ""} ${runtime.forcedChance ? "disabled" : ""}><span>${escapeHtml(localize("GG.ChanceCasting", "Chance casting"))}</span></label>
            <label class="${hasPsychicPower(runtime.actor) ? "" : "is-hidden"}"><input type="checkbox" name="psychicPower" ${runtime.options.psychicPower ? "checked" : ""}><span>${escapeHtml(localize("GG.PsychicPower", "Psychic Power"))}</span></label>
            <label class="gg-safe-cast"><span>${escapeHtml(localize("GG.SafeCasting", "Safe casting"))}</span><select name="safeCast"><option value="0">0</option></select></label>
          </div>
        </div>
      </section>

      <section class="gg-page-panel gg-ritual-circle${canDraw ? "" : " is-no-wp"}">
        <div class="gg-seal-field">
          <div class="gg-seal-accuracy" aria-hidden="true"></div>
          <div class="gg-target-sigil">${sigilToSvgMarkup(sigil, { className: "gg-target-sigil-svg", guide: true })}</div>
          <canvas class="gg-ritual-canvas${canDraw ? "" : " is-disabled"}" aria-label="${escapeHtml(localize("GG.TraceSpell", "Trace the spell sigil"))}" aria-disabled="${String(!canDraw)}"></canvas>
          <div class="gg-no-wp-effect" aria-hidden="true"><span>0 WP</span></div>
          <div class="gg-extra-list"></div>
        </div>

        <div class="gg-drawing-status gg-ritual-status is-visual-only" data-gg-status aria-live="polite"></div>

        <div class="gg-ritual-toolbar" role="toolbar">
          <button type="button" class="gg-auto-draw gg-icon-button gg-before-bind" ${canDraw ? "" : "disabled"} ${tooltipAttributes(localize("GG.AutoDraw", "Auto-draw sigil"))}><i class="fa-solid fa-pencil" aria-hidden="true"></i></button>
          <button type="button" class="gg-clear-drawing gg-icon-button gg-before-bind" ${canDraw ? "" : "disabled"} ${tooltipAttributes(clearDrawing)}><i class="fa-solid fa-eraser" aria-hidden="true"></i></button>
          <button type="button" class="gg-undo-stroke gg-icon-button gg-before-bind" ${canDraw ? "" : "disabled"} ${tooltipAttributes(undoStroke)}><i class="fa-solid fa-rotate-left" aria-hidden="true"></i></button>
          <button type="button" class="gg-finish-sigil gg-icon-button gg-icon-button-confirm gg-before-bind" disabled ${tooltipAttributes(finishSigil)}><i class="fa-solid fa-link" aria-hidden="true"></i></button>
          <button type="button" class="gg-undo-mark gg-icon-button gg-after-bind" ${tooltipAttributes(undoMark)}><i class="fa-solid fa-rotate-left" aria-hidden="true"></i></button>
          <button type="button" class="gg-reset-ritual gg-icon-button gg-after-bind" ${tooltipAttributes(reset)}><i class="fa-solid fa-arrows-rotate" aria-hidden="true"></i></button>
        </div>

        <footer class="gg-ritual-footer">
          <button type="button" class="gg-cast-button" disabled>${escapeHtml(localize("GG.Cast", "Complete the spell"))}</button>
        </footer>
      </section>
    </div>`;
}

async function openRitual(runtime, spellId, { restoreState = null } = {}) {
  const spell = runtime.actor.items.get(spellId);
  if (!spell || !runtime.overlay?.isConnected) return;
  const renderEpoch = ++runtime.renderEpoch;
  runtime.ritualController?.destroy?.();
  runtime.ritualController = null;
  destroyExtraControllers(runtime);
  runtime.currentSpellId = spellId;
  runtime.mainSigilAccepted = Boolean(restoreState?.mainSigilAccepted);
  runtime.perfectPowerBonus = Math.max(0, Number(restoreState?.perfectPowerBonus) || 0);
  runtime.autoDrawUsed = Boolean(restoreState?.autoDrawUsed);
  runtime.lastBoundSigil = cloneNormalizedStrokes(restoreState?.lastBoundSigil);
  runtime.extraMarks = Array.from({ length: getExtraSlotCount(runtime) }, (_unused, index) => {
    const mark = restoreState?.extraMarks?.[index];
    return mark?.strokes?.length ? { strokes: cloneNormalizedStrokes(mark.strokes) } : null;
  });
  runtime.forcedChance = requiresChanceCasting(runtime.actor, spell);
  runtime.options = {
    ingredient: Boolean(restoreState?.options?.ingredient),
    chance: runtime.forcedChance || Boolean(restoreState?.options?.chance),
    psychicPower: restoreState?.options?.psychicPower == null ? hasPsychicPower(runtime.actor) : Boolean(restoreState.options.psychicPower),
    safeCast: runtime.forcedChance || restoreState?.options?.chance ? 0 : Math.max(0, Number(restoreState?.options?.safeCast) || 0)
  };

  const content = runtime.overlay.querySelector('.gg-book-content');
  const description = await enrichHtml(spell.system.description ?? "");
  if (renderEpoch !== runtime.renderEpoch || !content?.isConnected || !runtime.overlay?.isConnected) return;
  content.innerHTML = ritualMarkup(runtime, spell, description);
  scheduleTitleFit(runtime);
  const circle = content.querySelector('.gg-ritual-circle');
  const status = content.querySelector('[data-gg-status]');
  const canvas = content.querySelector('.gg-ritual-canvas');
  const sealField = content.querySelector('.gg-seal-field');
  const finishButton = content.querySelector('.gg-finish-sigil');
  const target = normalizeSigilForDisplay(spellSigil(runtime.actor, spell));

  const applySealFeedback = (result, hasInput) => {
    const score = clamp(Number(result?.score ?? 0), 0, 1);
    const complete = Boolean(result?.complete);
    const thresholdReady = Boolean(hasInput) && complete && score >= SPELL_BIND_MIN_SIMILARITY;
    const perfectReady = thresholdReady && Boolean(result?.perfectEligible) && score > PERFECT_SIGIL_SIMILARITY;
    let scale = score;
    if (perfectReady) scale = Math.min(1.16, 1 + ((score - PERFECT_SIGIL_SIMILARITY) / (1 - PERFECT_SIGIL_SIMILARITY + 1e-6)) * 0.16);
    sealField?.style.setProperty('--gg-accuracy-scale', scale.toFixed(4));
    sealField?.style.setProperty('--gg-accuracy-opacity', hasInput ? Math.max(0.08, 0.18 + score * 0.82).toFixed(4) : '0');
    sealField?.classList.toggle('has-accuracy', Boolean(hasInput));
    sealField?.classList.toggle('is-threshold-ready', thresholdReady);
    sealField?.classList.toggle('is-perfect-ready', perfectReady);
    if (finishButton && !runtime.mainSigilAccepted) finishButton.disabled = !thresholdReady || !canDraw;
  };

  const scoreCurrent = (pixelStrokes) => compareDrawingToSigil(normalizedCanvasStrokes(canvas, pixelStrokes), target, { tolerance: 0.06 });
  const updateStatus = (pixelStrokes) => {
    if (runtime.mainSigilAccepted) return;
    const result = scoreCurrent(pixelStrokes);
    applySealFeedback(result, pixelStrokes.length > 0);
    status.textContent = '';
  };

  const canDraw = Math.max(0, Number(runtime.actor.system?.bio?.willpower?.value ?? 0)) > 0;
  const bindMainSigil = async ({ autoDraw = false } = {}) => {
    if (!runtime.ritualController || (!autoDraw && finishButton?.disabled)) return false;
    if (autoDraw) {
      await runtime.ritualController.autoDraw(target.strokes, { duration: 1000, normalized: true, replace: true });
    } else {
      await runtime.ritualController.whenIdle?.();
    }
    const result = scoreCurrent(runtime.ritualController.getStrokes());
    if (result.complete && result.score >= SPELL_BIND_MIN_SIMILARITY) {
      runtime.mainSigilAccepted = true;
      runtime.autoDrawUsed = Boolean(autoDraw);
      runtime.perfectPowerBonus = autoDraw ? 0 : (result.perfectEligible && result.score > PERFECT_SIGIL_SIMILARITY ? 1 : 0);
      runtime.lastBoundSigil = normalizedCanvasStrokes(canvas, runtime.ritualController.getStrokes());
      circle.classList.add('is-bound');
      circle.classList.toggle('is-perfect', Boolean(runtime.perfectPowerBonus));
      applySealFeedback(result, true);
      status.textContent = '';
      runtime.ritualController.setEnabled(false);
      renderExtraMarks(runtime, content);
      updateRitualNumbers(runtime, content);
      return true;
    }
    runtime.perfectPowerBonus = 0;
    runtime.autoDrawUsed = false;
    circle.classList.remove('is-perfect');
    applySealFeedback(result, true);
    status.textContent = '';
    circle.classList.add('is-rejected');
    setTimeout(() => circle.classList.remove('is-rejected'), 360);
    return false;
  };

  if (canDraw) {
    runtime.ritualController = attachDrawing(canvas, {
      drawGuide: false,
      getGuide: () => target.strokes,
      maxStrokes: DEFAULT_DRAWING_LIMITS.maxStrokes,
      maxPointsPerStroke: DEFAULT_DRAWING_LIMITS.maxPointsPerStroke,
      maxTotalPoints: DEFAULT_DRAWING_LIMITS.maxTotalPoints,
      onChange: updateStatus,
      onStrokeComplete: async () => !runtime.mainSigilAccepted
    });
  } else {
    canvas.classList.add("is-disabled");
    canvas.setAttribute("aria-disabled", "true");
  }

  content.querySelector('.gg-back').addEventListener('click', () => { playConfiguredSound("pageTurn"); runUiTask("Render", () => renderTab(runtime)); });
  content.querySelector('.gg-title-chat')?.addEventListener('click', async () => { await postSpellToChat(runtime, spell); });
  content.querySelector('.gg-auto-draw')?.addEventListener('click', async () => { if (canDraw) await bindMainSigil({ autoDraw: true }); });
  content.querySelector('.gg-undo-stroke').addEventListener('click', () => runtime.ritualController?.undo?.());
  content.querySelector('.gg-clear-drawing').addEventListener('click', () => runtime.ritualController?.clear?.());
  content.querySelector('.gg-finish-sigil').addEventListener('click', async () => { await bindMainSigil({ autoDraw: false }); });

  content.querySelector('.gg-undo-mark').addEventListener('click', () => {
    for (let i = runtime.extraMarks.length - 1; i >= 0; i -= 1) {
      if (!runtime.extraMarks[i]) continue;
      runtime.extraControllers[i]?.clear?.();
      runtime.extraMarks[i] = null;
      updateRitualNumbers(runtime, content);
      break;
    }
  });
  content.querySelector('.gg-reset-ritual').addEventListener('click', () => runUiTask("Reset ritual", () => openRitual(runtime, spellId)));

  content.querySelectorAll('.gg-ritual-options input, .gg-ritual-options select').forEach((element) => {
    element.addEventListener('change', () => {
      if (element.name === 'safeCast') runtime.options.safeCast = Number(element.value);
      else runtime.options[element.name] = Boolean(element.checked);
      if (element.name === 'chance' && runtime.options.chance) runtime.options.safeCast = 0;
      updateRitualNumbers(runtime, content);
    });
  });

  content.querySelector('.gg-cast-button').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    if (!runtime.mainSigilAccepted || button.disabled) return;
    button.disabled = true;
    button.classList.add('is-casting');
    try {
      const enhancementMarks = await snapshotExtraMarks(runtime, content);
      const spentWillpower = 1 + enhancementMarks.length;
      const availableWillpower = Math.max(0, Number(runtime.actor.system?.bio?.willpower?.value ?? 0));
      if (availableWillpower < spentWillpower) throw new Error(localize("GG.NotEnoughWillpower", "Not enough Willpower Points."));
      const castSigilStrokes = runtime.lastBoundSigil?.length ? runtime.lastBoundSigil : target.strokes;
      const castEnhancements = enhancementMarks.map((mark) => mark.strokes);
      const result = await requestAuthoritativeCast({
        actor: runtime.actor,
        spell,
        ingredient: runtime.options.ingredient,
        chance: runtime.options.chance,
        psychicPower: runtime.options.psychicPower,
        safeCast: runtime.options.safeCast,
        autoDraw: runtime.autoDrawUsed,
        sigilStrokes: castSigilStrokes,
        enhancements: castEnhancements
      });
      ui.notifications.info(`${spellName(spell)}: PL ${result.powerLevel}`);
      removeOverlay(runtime);
      runtime.app.render(false);
    } catch (error) {
      console.error('Goetia Grimoire | Spell cast failed.', error);
      ui.notifications.error(error.message || localize('GG.CastFailed', 'Spell casting failed.'));
      button.disabled = false;
      button.classList.remove('is-casting');
    }
  });

  applySealFeedback(null, false);
  renderExtraMarks(runtime, content);
  if (restoreState?.mainStrokes?.length && runtime.ritualController?.canvas?.isConnected) {
    runtime.ritualController.setCommitted(denormalizeCanvasStrokes(canvas, restoreState.mainStrokes));
    updateStatus(runtime.ritualController.getStrokes());
  }
  if (runtime.mainSigilAccepted) {
    circle.classList.add('is-bound');
    circle.classList.toggle('is-perfect', Boolean(runtime.perfectPowerBonus));
    runtime.ritualController?.setEnabled(false);
    if (runtime.lastBoundSigil.length && runtime.ritualController?.canvas?.isConnected) {
      runtime.ritualController.setCommitted(denormalizeCanvasStrokes(canvas, runtime.lastBoundSigil));
    }
    renderExtraMarks(runtime, content);
  }
  updateRitualNumbers(runtime, content);
}

function applyCoverTheme(cover, themeId) {
  if (!cover) return resolveCoverTheme(themeId);
  const theme = resolveCoverTheme(themeId);
  cover.dataset.ggCoverTheme = theme.id;
  const label = cover.querySelector("[data-gg-theme-label]");
  if (label) label.textContent = theme.label;
  const button = cover.querySelector(".gg-cover-theme-cycle");
  if (button) {
    const tooltip = coverThemeSwitchTooltip(theme);
    button.setAttribute("data-gg-tooltip", tooltip);
    button.setAttribute("aria-label", tooltip);
    button.setAttribute("title", tooltip);
  }
  return theme;
}
async function setupUnlock(runtime) {
  const storedSigil = await getUnlockSigil(runtime.actor);
  if (runtimeByApp.get(runtime.app.appId) !== runtime || !runtime.section?.isConnected) return;
  const sigil = normalizeSigilForDisplay(storedSigil);
  const cover = runtime.section.querySelector(".gg-closed");
  const canvas = runtime.section.querySelector(".gg-unlock-canvas");
  const status = runtime.section.querySelector("[data-gg-status]");
  if (!canvas || !cover) return;
  const lock = cover.querySelector(".gg-cover-lock");
  applyCoverTheme(cover, storedCoverThemeId());
  lock.querySelector(".gg-unlock-guide")?.remove();
  lock.insertAdjacentHTML("afterbegin", `<div class="gg-unlock-guide">${sigilToSvgMarkup(sigil, { className: "gg-unlock-guide-svg", guide: true })}</div>`);

  const scoreCurrent = (pixelStrokes) => compareDrawingToSigil(normalizedCanvasStrokes(canvas, pixelStrokes), sigil, { tolerance: 0.075 });
  const updateStatus = (pixelStrokes) => {
    const result = scoreCurrent(pixelStrokes);
    status.textContent = pixelStrokes.length ? similarityText(result) : '';
  };

  runtime.unlockController = attachDrawing(canvas, {
    getGuide: () => sigil.strokes,
    drawGuide: false,
    maxStrokes: 20,
    maxPointsPerStroke: 128,
    maxTotalPoints: 1400,
    onChange: updateStatus,
    onStrokeComplete: async () => true
  });

  const completeUnlock = async ({ autoDraw = false } = {}) => {
    if (autoDraw) await runtime.unlockController.autoDraw(sigil.strokes, { duration: 1000, normalized: true, replace: true });
    if (runtimeByApp.get(runtime.app.appId) !== runtime || !runtime.section?.isConnected || !runtime.unlockController) return;
    const result = scoreCurrent(runtime.unlockController.getStrokes());
    if (recognized(result, 0.34)) {
      cover.classList.add("is-unlocked");
      status.textContent = localize("GG.SealAccepted", "The seal recognizes its owner.");
      if (runtime.pendingUnlockTimer) clearTimeout(runtime.pendingUnlockTimer);
      runtime.pendingUnlockTimer = window.setTimeout(() => {
        runtime.pendingUnlockTimer = 0;
        if (runtimeByApp.get(runtime.app.appId) === runtime && runtime.section?.isConnected) runUiTask("Open grimoire", () => openBook(runtime));
      }, 180);
      return;
    }
    status.textContent = `${localize("GG.SealRejected", "The seal does not recognize the hand.")} ${similarityText(result)}`;
    cover.classList.add("is-rejected");
    setTimeout(() => cover.classList.remove("is-rejected"), 360);
  };

  cover.querySelector(".gg-auto-draw")?.addEventListener("click", async () => { await completeUnlock({ autoDraw: true }); });
  cover.querySelector(".gg-clear-drawing").addEventListener("click", () => runtime.unlockController.clear());
  cover.querySelector(".gg-finish-sigil").addEventListener("click", () => { runUiTask("Unlock", () => completeUnlock()); });
  cover.querySelector(".gg-cover-theme-cycle")?.addEventListener("click", async () => {
    const next = nextCoverTheme(cover.dataset.ggCoverTheme || storedCoverThemeId());
    applyCoverTheme(cover, next.id);
    cover.classList.add("is-switching-theme");
    window.setTimeout(() => cover.classList.remove("is-switching-theme"), 220);
    await persistCoverTheme(next.id);
  });
}

function grimoireHostIsVisible(runtime) {
  const host = runtime.talentTab ?? runtime.section;
  if (runtime.app?.minimized || runtime.root?.classList?.contains("minimized")) return false;
  if (!host?.isConnected || host.hidden || host.getAttribute?.("aria-hidden") === "true") return false;
  return typeof host.getClientRects !== "function" || host.getClientRects().length > 0;
}

function scheduleTabVisibilityCheck(runtime) {
  if (runtime.tabVisibilityFrame) return;
  runtime.tabVisibilityFrame = requestAnimationFrame(() => {
    runtime.tabVisibilityFrame = 0;
    if (runtimeByApp.get(runtime.app.appId) !== runtime) return;
    const visible = grimoireHostIsVisible(runtime);
    runtime.section?.classList.toggle("gg-host-inactive", !visible);
    if (visible) return;
    if (runtime.pendingUnlockTimer) clearTimeout(runtime.pendingUnlockTimer);
    runtime.pendingUnlockTimer = 0;
    if (runtime.overlay) removeOverlay(runtime);
  });
}

function setupObservers(runtime) {
  runtime.observer = new MutationObserver(() => {
    if (runtime.overlay) scheduleOverlayPosition(runtime);
    scheduleTabVisibilityCheck(runtime);
  });
  runtime.observer.observe(runtime.root, { attributes: true, attributeFilter: ["style", "class"] });
  runtime.resizeObserver = new ResizeObserver(() => {
    if (runtime.overlay) scheduleOverlayPosition(runtime);
  });
  runtime.resizeObserver.observe(runtime.section);
  window.addEventListener("resize", runtime._windowResize = () => {
    if (runtime.overlay) scheduleOverlayPosition(runtime);
  });

  const nav = runtime.sheetNavigation ?? findSheetNavigation(runtime.html);
  runtime.sheetNavigation = nav;
  if (runtime.talentTab) {
    runtime.tabObserver = new MutationObserver(() => scheduleTabVisibilityCheck(runtime));
    runtime.tabObserver.observe(runtime.talentTab, { attributes: true, attributeFilter: ["class", "style", "hidden", "aria-hidden"] });
  }
  if (nav) {
    runtime._navigationClick = () => scheduleTabVisibilityCheck(runtime);
    nav.addEventListener("click", runtime._navigationClick, { passive: true });
  }
}


export async function enhanceActorSheet(app, html) {
  const actor = app.actor;
  if (game.system.id !== "forbidden-lands" || actor?.type !== "character" || !isMiracleWorker(actor)) {
    destroyActorSheet(app);
    return;
  }

  const preservedState = captureRuntimeState(runtimeByApp.get(app.appId));
  destroyActorSheet(app);
  const targets = resolveActorSheetTargets(app, html);
  const { section, root, talentTab, navigation } = targets;
  if (!section || !root) {
    if (game.user?.isGM) console.warn(`Goetia Grimoire | No compatible spell container found for sheet ${app.constructor?.name ?? app.appId}.`);
    return;
  }

  section.classList.add("gg-spells-host");
  talentTab?.classList.add("gg-has-grimoire");
  section.innerHTML = closedCoverMarkup(actor);
  const runtime = makeRuntime(app, html, actor, section, root);
  runtime.talentTab = talentTab ?? runtime.talentTab;
  runtime.sheetNavigation = navigation;
  runtimeByApp.set(app.appId, runtime);
  setupObservers(runtime);
  scheduleTabVisibilityCheck(runtime);
  await setupUnlock(runtime);
  if (runtimeByApp.get(app.appId) !== runtime || !runtime.section?.isConnected) return;
  if (preservedState?.overlayOpen && grimoireHostIsVisible(runtime)) {
    await openBook(runtime, { silent: true, animate: false, restoreState: preservedState });
  }
}

export function destroyActorSheet(app) {
  const runtime = runtimeByApp.get(app.appId);
  if (!runtime) return;
  removeOverlay(runtime);
  closeContextMenu(runtime);
  runtime.unlockController?.destroy?.();
  if (runtime.pendingUnlockTimer) clearTimeout(runtime.pendingUnlockTimer);
  runtime.pendingUnlockTimer = 0;
  runtime.observer?.disconnect?.();
  runtime.resizeObserver?.disconnect?.();
  runtime.tabObserver?.disconnect?.();
  runtime.talentTab?.classList.remove("gg-has-grimoire");
  if (runtime.overlayPositionFrame) cancelAnimationFrame(runtime.overlayPositionFrame);
  runtime.overlayPositionFrame = 0;
  if (runtime.tabVisibilityFrame) cancelAnimationFrame(runtime.tabVisibilityFrame);
  runtime.tabVisibilityFrame = 0;
  if (runtime._windowResize) window.removeEventListener("resize", runtime._windowResize);
  if (runtime._navigationClick) runtime.sheetNavigation?.removeEventListener("click", runtime._navigationClick);
  if (runtime._rootPointerDown) runtime.root?.removeEventListener("pointerdown", runtime._rootPointerDown);
  runtimeByApp.delete(app.appId);
}
