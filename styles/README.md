# CSS architecture

The manifest loads component styles in this order:

- `grimoire.css`: design tokens, reset, closed cover, shared controls.
- `book.css`: open-book shell, bookmarks, constellation, training pages, context menu.
- `contract.css`: paged contract reader and GM editor.
- `ritual.css`: spell ritual layout and drawing states.
- `effects.css`: full-screen cast presentation.
- `auxiliary.css`: settings, keyframes, reduced-motion and responsive overrides.

Keep selectors scoped to `.gg-spells-host`, `.gg-overlay`, or the owning settings form. Do not add version-specific override blocks. Change the owning component rule instead. Cross-component responsive rules belong in `auxiliary.css`, which must remain last in `module.json`.
