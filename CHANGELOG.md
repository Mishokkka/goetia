# Changelog

## 0.7.7

- Addressed CodeRabbit review findings without changing intended UX: contract HTML is sanitized before rendering and persistence, spell tooltip text is extracted in an inert template, malformed auto-draw stroke entries are ignored, and moved constellation seals preserve their existing size/rotation/label geometry.
- Replaced deprecated visually-hidden `clip` declarations and normalized stylesheet syntax with behavior-equivalent forms.
- Preserved the documented consecutive-success Training rule; failed attempts intentionally reset accumulated high-rank training successes.
- Added automatic Chance Casting enforcement whenever a spell's rank exceeds the actor's highest rank across all magic talents; spell school does not affect this comparison. Forced Chance Casting disables Safe Casting and counts as one automatic mishap unit.
- Added authoritative mishap counting from active rolled 1s on spell dice, with Chance Casting contributing one additional mishap unit.
- Added a dedicated GM settings palette for Mishap RollTables 0 through 6; casting draws exactly one table matching the total mishap units, with 6 acting as the 6+ ceiling, while level 0 remains available to Training.
- Added a dedicated mishap cast sound source with priority over both normal and PL > 5 cast sounds.
- Added synchronized distorted/twisted mishap sigil presentation to the global cast effect.
- Reduced cast-to-FX latency by embedding audit flags in the initial roll ChatMessage, publishing sound/sigil FX before Mishap RollTable work, and deferring the table draw until after the first FX paint.
- Replaced the animated SVG turbulence/displacement Mishap filter with compositor-friendly transform distortion to avoid the Mishap-specific rendering hitch.
- Cast sounds now play to natural completion; the global sigil duration is configurable from 0.50× to 2.00× the actual selected sound duration, with 1.50× as the default and the existing duration setting used only as a fallback when no duration is available.
- Fixed a one-frame dark flash at cast-FX startup by no longer animating the full-screen fixed overlay; the already-mounted visual stage now fades in as one composited unit on the next animation frame.
- Fixed the sound manager palette so its text and source controls remain readable on the dark module surface under Foundry VTT v13 themes.
- Added an optional Foundry Playlist source to every configurable grimoire sound; each trigger selects a random playable entry and avoids an immediate repeat when the playlist has more than one sound.
- Added an optional dedicated cast sound for spells whose final Power Level is greater than 5, with automatic fallback to the normal cast sound when the special source is disabled or unavailable.
- Added three more switchable horror/goetic entrance styles: Ossuary Mechanism, Abyssal Eye, and Waxen Litany.
- Extended the existing top-right style cycle to six total entrances while preserving per-user selection.
- Kept all new visuals CSS-only and deterministic per actor, avoiding external image dependencies.

## 0.7.6

- Added three switchable entrance-block presentations for the closed grimoire: Threaded Vault, Infernal Halo, and Cathedral of Teeth.
- Added a compact top-right style-cycle button that rotates the entrance presentation in place and stores the selection per user.
- Isolated the new entrance visuals behind dedicated cover-theme markup and styling so the drawing canvas, unlock guide, and tool controls keep the same behavior.

## 0.7.5

- Fixed the Contract ProseMirror editor inheriting the grimoire's dark palette, which made the stock Foundry toolbar text and icons render black-on-black.
- Added a scoped light editor surface, explicit toolbar/icon colours, active and disabled states, readable dropdowns, and a white rich-text canvas without changing other module windows.
- Added a stable class to the mounted native editor element for future theme isolation.

## 0.7.4

- Unified spell-sigil seed generation between the grimoire client and the authoritative GM resolver, including `trainingSourceId`, which fixes false “Every element of the sigil must be traced” rejections for trained spells.
- Replaced plain `Nd6` Training checks with Forbidden Lands Year Zero rolls using base (`b`), skill (`s`), and negative (`n`) dice, with the system-native chat card and success count.
- Replaced the external cancellation dialog with a styled modal inside the open grimoire so it always renders above the book.
- Hardened new-path completion so it explicitly creates and tags a Profession Talent Item, verifies creation, preserves relevant source flags, and refreshes the actor sheet.
- Mounted Contract editing through Foundry VTT's standard `HTMLProseMirrorElement` first, retained compatibility fallbacks, and enriched the saved HTML for formatted display and document links.
- Centralized Year Zero roll discovery/evaluation shared by casting and Training, removed the duplicated authoritative sigil-seed implementation, and expanded smoke coverage.

## 0.7.3

- Replaced the contract editor mount with Foundry VTT's standard Journal-style ProseMirror element and stopped restyling its toolbar and editing surface.
- Kept guarded fallbacks for older or failed editor initialization while saving through the standard element value API.
- Removed the outer scrollbar from the Training right page.
- Moved the selected-training and active-project panels to fixed page overlays, reserved their space inside the content area, and hid the spell grid scrollbar so selecting a spell no longer shifts the layout.

## 0.7.2

- Training spell seals now use the same delayed rich tooltip card as the main spell constellation, including rank, range, duration, ingredient, and description.
- Removed browser `title` tooltips from Training and retained hover support for known and locked spells through `aria-disabled`.
- Replaced the contract HTML textarea with Foundry VTT v13 ProseMirror rich-text editing.
- Added clean editor lifecycle handling during save, cancel, page changes, sheet rerenders, and grimoire closure.
- Expanded contract rendering and editor styling for headings, lists, blockquotes, tables, links, emphasis, alignment, and other rich content.
- Added a guarded HTML-source fallback when the Foundry rich-text editor cannot be created.

## 0.7.1

- Fixed the new-path button being neutralized by Training runtime initialization after the selection was intentionally cleared.
- Fixed path spell lists by resolving a selected path record through its catalog entry before matching the spell discipline; matching is now normalized and includes name, label, flag, and description fallbacks.
- Changed all path icons in Training to deterministic, unique procedural sigils, including the General section and new-path picker.
- Made wallet deductions rerender the Forbidden Lands actor sheet immediately so the character wallet and Training display stay synchronized.
- Rebuilt the sound settings window as a compact two-column palette with switches, percentage sliders, file names, file pickers, and local preview buttons.

## 0.7.0

- Rebuilt the Training tab as a two-page interactive workspace with live XP, wallet values, manual CAP/XCAP switches, and manual Druid/Sorcerer classification.
- Added a bundled catalog generated from the supplied spell and talent compendiums: 15 magic paths and 352 rank 1-5 spells, including an independent General Spells section.
- Added new-path acquisition filtered by `(S)`, `(D)`, and `(S/D)` Profession Talent prefixes, while preserving mixed paths for both caster types.
- Added rank tabs and deterministic spell sigils with known, eligible, selected, locked, and active-project states.
- Added one persistent training project per character for new paths, path ranks, and spells.
- Implemented teacher, source, and independent-research methods, quarter-day progress, WITS/LORE rolls, consecutive success requirements, rank 4-5 attempt costs, and configured spell-mishap table draws.
- Implemented the campaign XP formulas, manual cap modifiers, research ingredient payment, wallet conversion, final XP spending, and embedded Item creation or rank updates.
- Added chat records, cancellation safeguards, duplicate-spell disambiguation by discipline, stable preview-to-learned sigils, transaction revalidation, and best-effort rollback if an Item or Actor update fails.
- Raised the module data schema to version 5 and expanded English and Russian localization.

## 0.6.10

- Unified personal-sigil schema checks around one exported version constant and stopped accepting obsolete version 7 seals at runtime.
- Hardened repeated actor-sheet renders so stale asynchronous setup cannot attach controllers or reopen a detached grimoire.
- Closed the book when the character sheet leaves the Talents tab or is minimized, and cleaned the associated observer and navigation listeners.
- Made auto-draw cancellation resolve safely during rerenders and shutdown, prevented post-destroy canvas frames, and removed unreachable playback calls.
- Added recoverable Application V2 settings submissions with visible errors, reentrancy guards, and duplicate-listener protection instead of one-shot dead forms after a failed save.
- Added error handling for native chat posting, spell-sheet opening, deletion, background UI rendering, startup migrations, and asynchronous document hooks.
- Removed duplicate spell-flag cleanup from the context menu, kept deletion cleanup in the single data-schema hook, and limited it to the initiating client.
- Unified deterministic active-GM selection for casts and world migrations in one authority module; document hooks now run once on the initiating client with an authority fallback.
- Destroyed stale grimoire runtimes when a character loses miracle-worker eligibility or the module is disabled.
- Removed three unused localization entries and aligned the README, manifest, package metadata, tests, and audit document.

## 0.6.9

- Aligned RANGE with its label in spell metadata.
- Replaced the custom spell chat card with Forbidden Lands' native `Item.sendToChat()` flow.
- Corrected context-menu positioning against the book-local context layer.
- Matched enhancement strokes in the global cast effect to the main sigil's white ink and red glow.
- Replaced deterministic link spark cycles with runtime-random link selection and intervals.
- Moved all sound toggles, paths, and volumes into a dedicated settings window.
- Added delayed spell tooltips with rank, range, duration, ingredient, and a concise description.

## 0.6.5

- Replaced 176 continuously running per-path SVG animations on the closed grimoire with one compositor-friendly field drift and pause it while the player draws.
- Rebuilt canvas rendering around a cached static backing layer. Completed strokes and guides are no longer roughened and repainted on every pointer event.
- Added low-cost live stroke rendering, coalesced pointer samples, cached canvas bounds, and a lower high-DPI ceiling for smoother handwriting.
- Removed duplicate sigil recognition after every completed stroke and cached all target-only geometry, samples, bounds, and raster masks used by recognition.
- Coalesced sheet resize and mutation reactions into one animation frame and stopped rerunning title measurement when the book size did not change.
- Throttled spell-seal dragging to one DOM write per animation frame and cached the constellation bounds for the duration of the drag.
- Removed the full-book CSS filter that forced the entire grimoire subtree to be recomposited whenever the canvas changed; the shadow now lives on a static pseudo-element.

## 0.6.4

- Fixed cast-effect shutdown so cancelling an active presentation resolves the queue instead of leaving it permanently blocked.
- Added full cast-effect cleanup to Foundry shutdown alongside module audio cleanup.
- Kept the world data-schema version pending when any actor migration fails, allowing the migration to retry on the next load.
- Cancelled active drawing safely when pointer capture is lost and hardened normalized stroke conversion against malformed points.
- Removed obsolete entrance selectors, unused shadow animations, stale localization strings, unused runtime fields, an unused sigil helper, and dead ritual code.
- Hardened spell-seal dragging against pointer-capture loss, cancelled delayed unlocks when leaving the talent view, and removed prototype wording from the training page.
- Updated smoke tests to guard version parity, shutdown cleanup, migration retry behavior, pointer-capture handling, and removed CSS tails.

## 0.6.3

- Moved rank bookmarks outside the left edge of the grimoire and restored page-turn audio for rank changes.
- Replaced constant point-like constellation sparks with rare, faster gradient light passes that travel only between the visible seal-ring contact points.
- Increased entrance-line density while making the lines thinner and dimmer; the SVG curves now slowly morph and pulse into changing patterns.
- Normalized spell type labels to Spell, Ritual or Power Word so duplicated labels such as `Spell Spell` and `Spell Ritual` no longer appear.
- Restored the normal item-sheet Edit action in the spell context menu for owners and GMs.
- Corrected the ritual PL ledger to display base PL plus the small accuracy bonus instead of adding the bonus twice visually.

## 0.6.2

- Reworked the closed grimoire entrance again: minimal black field with dim animated curved lines and a clearer personal sigil template.
- Added a dedicated tab-switch sound and module setting for a separate grimoire section sound.
- Added a module setting for the global spell-sigil display duration shown to viewers after casting.
- Removed the explicit "No Willpower Points" ritual caption while keeping the visual lockout.
- Replaced the separate bonus block in the ritual ledger with an inline `+PL` indicator beside the Power Level number.
- Added an "Edit spell" entry to the spell context menu, opening the normal item sheet.
- Added dim moving sparks along constellation links between connected spells.
- Tightened the contract page layout so the text reaches lower on the page and the edit / close / navigation buttons sit on the outer edges without affecting layout.
- The ritual header now shows the spell item type label instead of the fixed "Ritual" caption.

## 0.6.1

- Changed ritual seal feedback to visual-only: removed live Similarity / Need to bind text from the spell ritual view.
- Added a threshold ring at 75% radius, a radial accuracy glow under the sigil, shimmer after the cast threshold, and overflow glow for perfect sigils.
- The bind button now stays disabled until the main sigil reaches the 75% casting threshold.
- Simplified the ritual seal area to remove confusing inner guide circles.
- Reworked the closed grimoire entrance to a minimal black horror screen with slow dark-grey shadows and waves.
- Removed decorative entrance framing under the sigil template and made the personal sigil template more visible.
- Corrected icon alignment inside circular buttons.
- Kept the perfect-sigil bonus as bonus Power Level only, without additional Willpower cost or extra spell dice.

## 0.6.0

- Split drawing, audio, cast presentation, sheet adaptation, appearance settings, and data migration out of the main grimoire controller.
- Replaced direct browser audio use with a Foundry-aware audio service, retained a browser fallback, moved enable/volume preferences to client scope, and stopped cutting off rapid page sounds.
- Added a Foundry Application V2 appearance settings implementation with a legacy fallback.
- Added resilient actor-sheet container discovery for standard and alternate Forbidden Lands sheet layouts.
- Added explicit module roles and configurable aliases for localized or renamed magic talents and Psychic Power.
- Added versioned actor/world data migrations, automatic personal-sigil upgrades, and cleanup of stale spell positions and salts after normal item deletion.
- Removed the obsolete entrance design CSS instead of overriding it, centered the entrance sigil exactly, fixed reduced-motion coverage, and repaired Safe Casting on narrow layouts.
- Added Node smoke tests covering 480 generated sigils, element omission rejection, manifest integrity, CSS ownership, and decomposition guards.


## 0.5.1
- Added a dedicated GM-authoritative cast protocol. Player clients now send bounded drawing data and options; the selected active GM independently validates the actor, ownership, spell, sigil completeness, similarity, bonus PL, and casting options.
- Moved all actual WP deduction and roll creation to the authority GM. Requests from different clients are serialized per actor, preventing cross-client WP overwrite races.
- Restricted the low-level cast adapter to GM clients and attached audit metadata to generated chat messages.
- Added request expiry, replay protection, per-user rate limiting, permission checks, bounded packet decoding, malformed-effect rejection, and localized network errors.
- Replaced destructive simultaneous cast effects with a bounded sequential presentation queue.
- Capped visible enhancement slots and kept the full bounded player drawing for authoritative recognition instead of the visual-effect downsample.

## 0.5.0
- Unified the SVG guide and recognition geometry so players are judged against the sigil they actually see.
- Added structural element and stroke coverage checks. Missing elements now cap similarity below the casting threshold.
- Regenerated spell sigils with geometry-distinct elements, added a bounded sigil cache, and migrated personal seals to schema version 7.
- Bounded drawing complexity to prevent oversized strokes from blocking the Foundry UI.
- Preserved all generated sigil strokes in synchronized cast effects while enforcing a total point budget.
- Serialized local casts per actor so simultaneous casts cannot overwrite Willpower deductions on the same client.
- Added rejection-safe queue cleanup and a localized incomplete-sigil message.

## 0.4.9
- Reworked entrance screen around a centered ritual chamber with a new black-and-white horror layout.
- Added bundled opening and page-turn sounds, and replaced the cast sound.
- Spell binding now requires 75% similarity. A similarity above 91% grants +1 free Power Level and a dedicated visual glow.
- Contract spread counter removed. Page labels are now centered at the bottom of each page.
- Ritual metadata and casting options layout refined.

## 0.4.8

- Removed the perimeter flame system from the closed cover and replaced it with a monochrome abstract horror texture while preserving the moving shadow layer.
- Rebuilt contract navigation so previous and next controls sit in the lower left and lower right corners, moved the GM-only editor to a pencil icon in the upper right, removed the injected CONTRACT heading, and expanded the usable page area.
- Limited the synchronized cast dimming to a soft radial field around the seal and changed the seal and enhancement lines to a red glow matching the grimoire.
- Rebuilt spell seal grammar around an exact rank progression of two through six visual elements, capped at six, and expanded the frame, crown, base, side, and inner-glyph catalogs.
- Added configurable local sounds for opening the grimoire and turning pages or changing sections.
- Added measured font fitting for ritual titles and spell-node labels.
- Replaced the ritual Back text button with an independent lower-left icon that no longer participates in page layout.

## 0.4.7

- Rebuilt the top bookmarks with fixed physical dimensions and absolute anchoring. They now remain narrow under Foundry button styles, point upward, stay behind the right leaf, and expose the full selected label without stretching.
- Increased the reserved bookmark area so the selected tab is no longer clipped when the grimoire opens near the top edge of the viewport.
- Made the closed-cover horror layer visibly present even before animation begins. The cover now has brighter grayscale flame tongues, a slowly shifting border glow, and higher-contrast amorphous shadows; all motion still respects reduced-motion preferences.
- Increased the contrast of player-drawn unlock ink while keeping the generated trace subdued.
- Added a GM-only context-menu action that regenerates an individual spell seal through a per-spell actor flag without modifying the spell item.
- Removed all circle chrome from enhancement drawings in the global cast presentation.
- Fixed intermittent missing enhancement drawings by snapshotting every canvas before the actor update and by suppressing the casting update's sheet rerender.
- Packed synchronized sigil strokes into bounded integer arrays and reduced the visual-only point budget. Socket messages are now substantially smaller and more reliable without changing casting mechanics.
- Replaced the contract's word-by-word DOM pagination with one browser multicolumn layout and inexpensive spread repositioning. Long contracts no longer trigger repeated cloning, measurement, or forced reflow.
- Centered contract page controls independently from the GM controls, added a font-independent SVG icon to Edit, and made contract saves avoid a full actor-sheet rerender.

## 0.4.6

- Corrected bookmark geometry: the rounded cap now faces upward, the bookmarks remain behind the right leaf, and only the selected label is exposed in full.
- Locked the ritual seal to a stable grid row so it no longer shifts when enhancement circles appear. The accepted player drawing now remains visible after the seal is bound.
- Enforced square spell-node geometry with a fixed 1:1 ring and SVG aspect ratio, preventing oval seal frames in the spell list.
- Removed the ritual tracing instruction line from the second page.
- Replaced the item-backed contract with an actor flag. A GM can author a contract for any miracle worker even when no Contract item exists; legacy item text is read once as a compatibility fallback.
- Added measured page pagination for rich contract HTML. Contract text is split into physical left/right leaves with previous and next spread controls instead of a scrolling text block.
- Added cleanup and resize handling for contract pagination, bounded page generation, oversized-content fallbacks, and save-error handling.
- Reworked the closed-cover entrance with animated amorphous shadows and slow grayscale flame tongues around the contour, including reduced-motion support.
- Split contract styling into its own component stylesheet and updated the CSS ownership documentation.
- Simplified font loading to Foundry-installed or File Picker sources and retained compatibility with worlds that previously stored the old bundled-mode setting.

## 0.4.5

- Replaced the accumulated patch-style stylesheet with five ordered component stylesheets. Shared tokens and controls now have one definition, and responsive overrides load last.
- Rebuilt the bookmarks as upward-rounded physical tabs behind the right page. Inactive labels remain concealed; the selected bookmark rises fully above the page.
- Blocked ritual drawing at zero Willpower and added a visible inert-seal state with disabled controls.
- Darkened the synchronized player cast presentation and included the actual enhancement drawings around the main sigil.
- Reduced spell sigils by one internal drawing element at every rank while preserving their rank-dependent frames and ornaments.
- Removed the bound-seal instruction area from the top of the second spell page.
- Batched canvas redraws with `requestAnimationFrame`, capped high-DPI canvas allocation, and prevented concurrent asynchronous stroke commits.
- Sanitized and compacted socket drawing payloads, cleaned up replaced cast effects and sounds, and made drag cancellation release all listeners.
- Removed the private Roll `_evaluated` mutation, hardened roll-class discovery, validated numeric casting input, and made Willpower rollback avoid overwriting concurrent actor changes.

## 0.4.4

- Corrected the overlay geometry so left and right page panels use the full physical page widths instead of narrow inset strips.
- Moved Spells, Training, and Contract to narrow vertical-text bookmarks protruding above the right page.
- Re-centered the cover title and fixed a CSS cascade bug that kept the personal unlock sigil at the generic 78 px sigil size.
- Removed the redundant SEAL heading from the spell page and made player-drawn ritual ink substantially brighter than the guide.
- Replaced bonus ring scratches with independent drawable circles tangent to the seal perimeter. Any drawing in a circle adds one Willpower Point; right-click clears that circle.
- Added explicit cleanup for all auxiliary canvas controllers when changing pages, resetting a ritual, or closing the grimoire.

## 0.4.3

- Fixed spell-sigil drawing by removing the invisible bonus-mark layer that intercepted pointer input.
- Hardened canvas drawing against zero-sized renders, pointer-capture loss, cancellation, resizing, and high-DPI displays.
- Rebuilt the ritual casting screen into a stable two-page layout with one toolbar, aligned metadata, readable spell text, and a clear casting ledger.
- Made all enriched spell and chat text readable on the dark grimoire theme, including content with inline dark colors.
- Made unlock controls brighter and added immediate custom hover tooltips.
- Added exactly one additional ornament to personal unlock sigils while preserving their previous base shape.
- Corrected bonus Willpower slot placement and allowed drawing through empty slots.
- Added safer HTML handling for GM-only secret content and support for both jQuery and HTMLElement render-hook payloads.

## 0.4.2

- Enlarged and re-centered the personal unlock sigil and its drawing field.
- Re-centered ritual sigils on the right page and widened the left page content so spell descriptions use the page more naturally.
- Suppressed horizontal scrolling in spell descriptions.
- Moved the extra Willpower circles outward around the main seal and aligned stroke detection to those circles.
- Increased the strength, opacity, and size of the broadcast cast sigil effect, and now uses the player-drawn sigil shape when available.

## 0.4.1

- Enlarged and simplified personal sigils again and made recognition more forgiving.
- Removed the descriptive copy from the unlock and ritual drawing areas and restyled action buttons as diegetic icons.
- Reworked spell casting layout so spell information fills the whole left page, the seal field stays centered on the right page, and the cast button stays pinned at the bottom.
- Replaced bonus WP ring-scratches with dedicated small circular drawing slots around the completed main sigil.
- Added a world-facing font appearance menu with File Picker support and Foundry font selection.
- Rotated the main grimoire tabs into vertical bookmark-style side labels.
- Replaced Font Awesome dependence in the custom context menu to avoid missing-icon squares under custom fonts.
- Smoothed the stop of the local drawing sound and added a global semi-transparent cast sigil flash with configurable sound.
- Bundled the `Christmas On Crack` font inside the module package.
