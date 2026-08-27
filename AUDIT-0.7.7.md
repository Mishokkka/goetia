# Goetia Grimoire 0.7.7 Audit

This package includes the current audit marker required by the smoke suite.

Relevant audit and fix notes for this build:
- Performance audit: see `PERF_REPORT.md` in the project workspace.
- Applied fixes: see `goetia-perf-fixes.md` in the working materials.
- UI follow-up fixes retained in this package:
  - PL bonus indicator is positioned to the right of the current PL without shifting the main PL value.
  - The Talents-tab entrance block uses the standard rectangular presentation.
- Audio follow-up fixes in this package:
  - The sound manager uses explicit dark surfaces and readable controls.
  - Every sound slot can use a Foundry Playlist and chooses a random playable sound per trigger.
  - Casts with final PL above 5 can use a dedicated sound source, with fallback to the normal cast source.
- Mishap follow-up fixes in this package:
  - Chance Casting is enforced authoritatively when spell rank exceeds the highest rank across all magic talents and contributes one mishap unit.
  - Active 1s on spell dice are counted as mishap units; one configured severity RollTable is drawn per mishap, capped at table 6 for 6+.
  - Table 0 is reserved for the Training mishap path.
  - Mishap casts use a dedicated sound source and synchronized distorted/twisted sigil presentation.


## 2026-08-27 follow-up

- Chance Casting now compares spell rank only against the maximum rank across all magic talents; discipline/school is intentionally ignored.
- Mishap RollTable drawing no longer blocks cast FX publication.
- Cast audit metadata is included in the initial roll ChatMessage, removing the extra message update from the cast critical path.
- Mishap distortion no longer uses animated SVG turbulence/displacement.
- One-shot cast audio is not stopped when the visual overlay expires. The overlay uses a configurable 0.50×–2.00× multiplier of the actual played sound duration, defaulting to 1.50×.

- The cast FX no longer animates the full-screen fixed overlay on insertion; the stage is revealed on the next animation frame to avoid the Chromium one-frame dark backing flash.

## 2026-08-27 CodeRabbit review follow-up

- Contract HTML is sanitized through an inert-template allowlist before enrichment/rendering and before persistence; executable event attributes, `srcdoc`, unsafe URL schemes, unsafe tags, and non-whitelisted inline CSS are removed.
- Spell tooltip plain-text extraction now uses inert template content instead of a live detached element.
- Auto-draw skips malformed non-array stroke entries rather than throwing.
- Dragged constellation seals preserve their displayed size, rotation, and label offsets on later renders.
- Deprecated CSS `clip` declarations and Stylelint-only syntax findings were corrected without changing presentation.
- The missing-audit finding does not apply to this packaged build because `AUDIT-0.7.7.md` is present and required by the smoke suite.
- The Training success-reset finding was intentionally not changed: README/changelog explicitly define rank 4-5 requirements as consecutive successes.

