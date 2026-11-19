# Task 7 report

Status: DONE. Commit 0924d12.

Added `<sbmlsim-figure>` (`src/SbmlsimFigure.ce.vue`), `FIGURE_TAG` (`src/tags.ts`), registration, `SbmlsimFigureElement` and `SbmlsimFigureHTMLElement` (`src/index.ts`; `register` takes a third argument `figureTagName`).

Behaviour: svg inserted with v-html (trusted, documented). One delegated click listener builds the data-k chain outside in; the longest path that is a key of `panels` with a non-empty list wins, so an empty-list key (decoration) falls back to a shorter live ancestor or reports nothing. Live elements get class `k-live`, role=button, tabindex=0, aria-pressed and Enter/Space support; decorations get none and no pointer. Marked paths get `k-marked` (accent drop-shadow, theme tokens, both schemes). Click on a marked path is reported like any other (app decides removal). Event `sbmlsim-figure-select`, detail `{key}`, bubbles and composed. Title is the group aria-label and a figcaption with the credit.

Evidence: npm test 15 files / 477 tests passed (9 new); typecheck clean; lint (eslint + prettier) clean.

## Fix round 1

Marked is now a crisp accent stroke (3px, non-scaling) on the shapes of the marked element, leaving unmarked nested controls alone; hover is a soft neutral glow (filter), so they differ in kind. forced-colors: marked gets Highlight stroke and outline, hover a dashed CanvasText outline. New `labels` prop feeds `aria-label` (key path fallback); nesting documented as deliberate, at most two deep. Shallow watch on figure, marked, labels plus onMounted decorate (a figure set before connect now draws marked; it did not before). FIGURE_TAG moved beside the tags, header comment wrapped, `part` figure and drawing added. Eight new tests (nested several-panel group, nested decoration, three levels, same child under two groups, marked non-live, labels, svg swap and null round trip, pre-connect props). Docs: components.md section, exports table and intro, README register and element. Evidence: npm test 485 pass, typecheck and lint clean. Not verified visually in a browser.
