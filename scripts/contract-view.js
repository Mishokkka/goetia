import { MODULE_ID, normalizeName } from "./config.js";
import { playConfiguredSound } from "./audio-service.js";

const CONTRACT_COLUMN_GAP = 42;

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

function tooltipAttributes(label, direction = "UP") {
  const escaped = escapeHtml(label);
  return `aria-label="${escaped}" data-gg-tooltip="${escaped}" data-gg-tooltip-direction="${direction}"`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

async function enrichHtml(content, actor) {
  const editor = foundry.applications?.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
  if (!editor?.enrichHTML) return content;
  return editor.enrichHTML(content ?? "", {
    async: true,
    secrets: Boolean(game.user?.isGM),
    relativeTo: actor
  });
}

function legacyContractSource(actor) {
  const item = actor.items.find((entry) => entry.type === "gear" && ["contract", "контракт"].includes(normalizeName(entry.name)));
  return item?.system?.effect || item?.system?.description || "";
}

function contractSource(actor) {
  const stored = actor.getFlag(MODULE_ID, "contractHtml");
  if (typeof stored === "string") return stored;
  return legacyContractSource(actor);
}

function proseMirrorEditorClass() {
  return foundry.applications?.ux?.ProseMirrorEditor ?? globalThis.ProseMirrorEditor ?? null;
}

function proseMirrorElementClass() {
  return foundry.applications?.elements?.HTMLProseMirrorElement ?? null;
}

function standardEditorMarkup(content) {
  const helper = foundry.applications?.handlebars?.editor;
  if (typeof helper !== "function") return "";
  return String(helper(content ?? "", {
    target: "contractHtml",
    button: false,
    engine: "prosemirror",
    collaborate: false,
    editable: true
  }));
}

export function destroyContractEditor(runtime) {
  if (!runtime) return;
  runtime.contractEditorMountEpoch = (runtime.contractEditorMountEpoch ?? 0) + 1;
  const state = runtime.contractEditor;
  try { state?.instance?.destroy?.(); } catch (error) {
    console.warn("Goetia Grimoire | Failed to destroy contract editor cleanly.", error);
  }
  try { state?.element?.remove?.(); } catch (error) {
    console.warn("Goetia Grimoire | Failed to disconnect the standard contract editor cleanly.", error);
  }
  try { state?.target?.replaceChildren?.(); } catch {}
  runtime.contractEditor = null;
}

async function waitForEditorElement(target) {
  if (globalThis.customElements?.whenDefined) {
    try { await customElements.whenDefined("prose-mirror"); } catch {}
  }
  await new Promise((resolve) => requestAnimationFrame(resolve));
  return target.querySelector("prose-mirror");
}

async function mountContractEditor(runtime, target, fallback, status) {
  destroyContractEditor(runtime);
  const epoch = runtime.contractEditorMountEpoch;
  target.replaceChildren();
  fallback.hidden = true;
  status.hidden = false;
  status.textContent = localize("GG.ContractEditorLoading", "Loading Foundry text editor…");

  try {
    let element = null;
    const ElementClass = proseMirrorElementClass();
    if (ElementClass?.create) {
      try {
        element = await ElementClass.create({
          name: "contractHtml",
          value: runtime.contractRawSource || "",
          editable: true,
          collaborate: false,
          documentUUID: runtime.actor.uuid,
          toggled: false,
          height: Math.max(300, target.clientHeight || 520)
        });
        if (!element || element.nodeType !== Node.ELEMENT_NODE) throw new Error("Foundry did not return a ProseMirror element.");
        target.replaceChildren(element);
        await new Promise((resolve) => requestAnimationFrame(resolve));
      } catch (error) {
        element = null;
        target.replaceChildren();
        console.warn("Goetia Grimoire | Standard ProseMirror element creation failed; trying the Foundry editor helper.", error);
      }
    }

    if (!element) {
      try {
        const markup = standardEditorMarkup(runtime.contractRawSource || "");
        if (markup) target.innerHTML = markup;
        element = await waitForEditorElement(target);
      } catch (error) {
        target.replaceChildren();
        console.warn("Goetia Grimoire | Foundry editor helper mount failed; trying the direct editor API.", error);
      }
    }

    if (element) {
      element.classList?.add("gg-contract-prose-mirror");
      if (epoch !== runtime.contractEditorMountEpoch || !target.isConnected) {
        element.remove?.();
        return;
      }
      runtime.contractEditor = { element, target, fallback, fallbackMode: false };
      status.hidden = true;
      element.focus?.();
      return;
    }

    const EditorClass = proseMirrorEditorClass();
    if (!EditorClass?.create) throw new Error("Foundry ProseMirror is unavailable");
    const host = document.createElement("div");
    host.className = "editor-content";
    target.replaceChildren(host);
    const instance = await EditorClass.create(host, runtime.contractRawSource || "", {
      collaborate: false,
      document: runtime.actor,
      relativeLinks: true,
      uuid: `${runtime.actor.uuid}.goetia-contract.${runtime.app?.appId ?? "editor"}`
    });
    if (epoch !== runtime.contractEditorMountEpoch || !target.isConnected) {
      instance?.destroy?.();
      return;
    }
    runtime.contractEditor = { instance, target, fallback, fallbackMode: false };
    status.hidden = true;
    instance?.view?.focus?.();
  } catch (error) {
    if (epoch !== runtime.contractEditorMountEpoch || !target.isConnected) return;
    console.error("Goetia Grimoire | Failed to create the standard Foundry contract editor.", error);
    target.replaceChildren();
    fallback.value = runtime.contractRawSource || "";
    fallback.hidden = false;
    status.textContent = localize("GG.ContractEditorUnavailable", "The Foundry text editor is unavailable. HTML source mode is active.");
    runtime.contractEditor = { instance: null, element: null, target, fallback, fallbackMode: true };
  }
}

async function contractEditorContent(runtime) {
  const state = runtime.contractEditor;
  if (!state) return runtime.contractRawSource || "";
  if (state.fallbackMode) return state.fallback?.value ?? "";

  if (state.element) {
    try {
      const saved = await state.element.save?.();
      if (typeof saved === "string") return saved;
    } catch (error) {
      console.warn("Goetia Grimoire | The standard editor could not finalize its value before save.", error);
    }
    if (typeof state.element.value === "string") return state.element.value;
  }

  const viewDom = state.instance?.view?.dom;
  if (viewDom instanceof HTMLElement) return viewDom.innerHTML;
  const proseMirror = state.target?.querySelector?.(".ProseMirror");
  if (proseMirror instanceof HTMLElement) return proseMirror.innerHTML;
  return runtime.contractRawSource || "";
}

export async function contractMarkup(runtime) {
  const source = contractSource(runtime.actor);
  runtime.contractRawSource = source;
  const fallback = `<p class="gg-contract-empty">${escapeHtml(localize("GG.NoContract", "No contract has been written."))}</p>`;
  let enriched;
  if (runtime.contractCache?.source === source) enriched = runtime.contractCache.enriched;
  else {
    enriched = await enrichHtml(source || fallback, runtime.actor);
    runtime.contractCache = { source, enriched };
  }
  const gmTools = game.user.isGM ? `
    <button type="button" class="gg-contract-edit gg-icon-button" ${tooltipAttributes(localize("GG.EditContract", "Edit contract"), "LEFT")}>
      <svg class="gg-contract-edit-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M14.7 3.3 20.7 9.3 9.8 20.2 3.8 20.2 3.8 14.2 14.7 3.3ZM6.2 15.2V17.8H8.8L17.3 9.3 14.7 6.7 6.2 15.2ZM15.9 5.5 18.5 8.1 19.4 7.2A1.15 1.15 0 0 0 19.4 5.6L18.4 4.6A1.15 1.15 0 0 0 16.8 4.6L15.9 5.5Z" fill="currentColor"/></svg>
    </button>` : "";
  return `
    <section class="gg-contract-page">
      ${gmTools}
      <div class="gg-contract-reader">
        <div class="gg-contract-viewport">
          <article class="gg-contract-flow">
            ${enriched}
            <span class="gg-contract-end-marker" aria-hidden="true"></span>
          </article>
        </div>
        <span class="gg-contract-page-number gg-contract-page-number-left" aria-hidden="true"></span>
        <span class="gg-contract-page-number gg-contract-page-number-right" aria-hidden="true"></span>
      </div>
      <nav class="gg-contract-nav" aria-label="${escapeHtml(localize("GG.ContractPages", "Contract pages"))}">
        <button type="button" class="gg-contract-prev gg-icon-button" disabled ${tooltipAttributes(localize("GG.PreviousPages", "Previous pages"), "UP")}><i class="fa-solid fa-chevron-left" aria-hidden="true"></i></button>
        <button type="button" class="gg-contract-next gg-icon-button" disabled ${tooltipAttributes(localize("GG.NextPages", "Next pages"), "UP")}><i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button>
      </nav>
      ${game.user.isGM ? `
        <div class="gg-contract-editor-shell" hidden>
          <div class="gg-contract-editor-heading">
            <strong><i class="fa-solid fa-file-signature" aria-hidden="true"></i>${escapeHtml(localize("GG.EditContract", "Edit contract"))}</strong>
            <div class="gg-contract-edit-tools">
              <button type="button" class="gg-contract-save"><i class="fa-solid fa-floppy-disk" aria-hidden="true"></i><span>${escapeHtml(localize("GG.Save", "Save"))}</span></button>
              <button type="button" class="gg-contract-cancel"><i class="fa-solid fa-xmark" aria-hidden="true"></i><span>${escapeHtml(localize("GG.Cancel", "Cancel"))}</span></button>
            </div>
          </div>
          <div class="gg-contract-editor-status" role="status" aria-live="polite" hidden></div>
          <div class="gg-contract-standard-editor" aria-label="${escapeHtml(localize("GG.EditContract", "Edit contract"))}"></div>
          <textarea class="gg-contract-editor-fallback" spellcheck="true" hidden aria-label="${escapeHtml(localize("GG.EditContract", "Edit contract"))}"></textarea>
        </div>` : ""}
    </section>`;
}

export function destroyContractPagination(runtime) {
  const state = runtime.contractPagination;
  if (!state) return;
  state.resizeObserver?.disconnect?.();
  if (state.frame) cancelAnimationFrame(state.frame);
  for (const { node, listener } of state.imageListeners ?? []) node.removeEventListener("load", listener);
  runtime.contractPagination = null;
}

function showContractSpread(runtime, spreadIndex) {
  const state = runtime.contractPagination;
  if (!state) return;
  const spreads = Math.max(1, state.spreadCount || 1);
  state.spreadIndex = clamp(Number(spreadIndex) || 0, 0, spreads - 1);
  state.flow.style.left = `${-(state.spreadIndex * state.spreadStride)}px`;
  state.previous.disabled = state.spreadIndex <= 0;
  state.next.disabled = state.spreadIndex >= spreads - 1;
  const leftPage = state.spreadIndex * 2 + 1;
  const rightPage = leftPage + 1;
  state.leftNumber.textContent = leftPage <= state.pageCount ? String(leftPage) : "";
  state.rightNumber.textContent = rightPage <= state.pageCount ? String(rightPage) : "";
}

function rebuildContractPagination(runtime) {
  const state = runtime.contractPagination;
  if (!state || !state.reader.isConnected) return;
  const readerWidth = Math.round(state.viewport.clientWidth);
  const readerHeight = Math.round(state.viewport.clientHeight);
  if (readerWidth < 180 || readerHeight < 160) return;
  if (state.readerWidth === readerWidth && state.readerHeight === readerHeight && state.pageCount) return;

  state.readerWidth = readerWidth;
  state.readerHeight = readerHeight;
  state.flow.style.width = `${readerWidth}px`;
  state.flow.style.height = `${readerHeight}px`;
  state.flow.style.columnGap = `${CONTRACT_COLUMN_GAP}px`;
  state.flow.style.left = "0px";
  const style = getComputedStyle(state.flow);
  const paddingLeft = Number.parseFloat(style.paddingLeft) || 0;
  const paddingRight = Number.parseFloat(style.paddingRight) || 0;
  const contentWidth = Math.max(1, readerWidth - paddingLeft - paddingRight);
  const columnWidth = Math.max(1, (contentWidth - CONTRACT_COLUMN_GAP) / 2);
  const stride = columnWidth + CONTRACT_COLUMN_GAP;
  state.spreadStride = stride * 2;
  const markerLeft = Math.max(0, Number(state.marker.offsetLeft) - paddingLeft);
  state.pageCount = Math.max(1, Math.floor((markerLeft + columnWidth * 0.25) / stride) + 1);
  state.spreadCount = Math.max(1, Math.ceil(state.pageCount / 2));
  showContractSpread(runtime, Math.min(state.spreadIndex, state.spreadCount - 1));
}

function scheduleContractPagination(runtime) {
  const state = runtime.contractPagination;
  if (!state || state.frame) return;
  state.frame = requestAnimationFrame(() => {
    state.frame = 0;
    rebuildContractPagination(runtime);
  });
}

function setupContractPagination(runtime) {
  destroyContractPagination(runtime);
  const page = runtime.overlay.querySelector(".gg-contract-page");
  const reader = page?.querySelector(".gg-contract-reader");
  const viewport = page?.querySelector(".gg-contract-viewport");
  const flow = page?.querySelector(".gg-contract-flow");
  const marker = page?.querySelector(".gg-contract-end-marker");
  const previous = page?.querySelector(".gg-contract-prev");
  const next = page?.querySelector(".gg-contract-next");
  const leftNumber = page?.querySelector(".gg-contract-page-number-left");
  const rightNumber = page?.querySelector(".gg-contract-page-number-right");
  if (!page || !reader || !viewport || !flow || !marker || !previous || !next || !leftNumber || !rightNumber) return;

  runtime.contractPagination = {
    page, reader, viewport, flow, marker, previous, next, leftNumber, rightNumber,
    pageCount: 0, spreadCount: 1, spreadIndex: 0, spreadStride: 0, frame: 0, resizeObserver: null,
    readerWidth: 0, readerHeight: 0, imageListeners: []
  };
  const state = runtime.contractPagination;
  previous.addEventListener("click", () => {
    playConfiguredSound("pageTurn");
    showContractSpread(runtime, state.spreadIndex - 1);
  });
  next.addEventListener("click", () => {
    playConfiguredSound("pageTurn");
    showContractSpread(runtime, state.spreadIndex + 1);
  });
  state.resizeObserver = globalThis.ResizeObserver
    ? new ResizeObserver(() => {
      state.readerWidth = 0;
      state.readerHeight = 0;
      scheduleContractPagination(runtime);
    })
    : null;
  state.resizeObserver?.observe(viewport);
  for (const image of flow.querySelectorAll("img")) {
    if (image.complete) continue;
    const listener = () => {
      state.pageCount = 0;
      scheduleContractPagination(runtime);
    };
    image.addEventListener("load", listener, { once: true });
    state.imageListeners.push({ node: image, listener });
  }
  scheduleContractPagination(runtime);
}

export function bindContractEditor(runtime, { rerender } = {}) {
  const page = runtime.overlay.querySelector(".gg-contract-page");
  if (!page) return;
  setupContractPagination(runtime);
  if (!game.user.isGM) return;
  const reader = page.querySelector(".gg-contract-reader");
  const nav = page.querySelector(".gg-contract-nav");
  const shell = page.querySelector(".gg-contract-editor-shell");
  const target = page.querySelector(".gg-contract-standard-editor");
  const fallback = page.querySelector(".gg-contract-editor-fallback");
  const status = page.querySelector(".gg-contract-editor-status");
  if (!reader || !nav || !shell || !target || !fallback || !status) return;

  const editButton = page.querySelector(".gg-contract-edit");
  editButton?.addEventListener("click", async () => {
    destroyContractPagination(runtime);
    reader.hidden = true;
    nav.hidden = true;
    editButton.hidden = true;
    shell.hidden = false;
    await mountContractEditor(runtime, target, fallback, status);
  });

  page.querySelector(".gg-contract-cancel")?.addEventListener("click", async () => {
    destroyContractEditor(runtime);
    await rerender?.();
  });

  page.querySelector(".gg-contract-save")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      await Promise.resolve();
      const content = (await contractEditorContent(runtime)).trim();
      await runtime.actor.update({ [`flags.${MODULE_ID}.contractHtml`]: content }, { render: false });
      runtime.contractRawSource = content;
      runtime.contractCache = null;
      destroyContractEditor(runtime);
      ui.notifications.info(localize("GG.ContractSaved", "Contract saved."));
      await rerender?.();
    } catch (error) {
      console.error("Goetia Grimoire | Failed to save contract.", error);
      ui.notifications.error(localize("GG.ContractSaveFailed", "Unable to save the contract."));
      button.disabled = false;
    }
  });
}
