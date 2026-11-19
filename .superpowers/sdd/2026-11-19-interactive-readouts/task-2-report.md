# Task 2 report

Built `write_readouts(content, svg, *, vein="arm vein") -> Path` in `visual/interactive.py` (exported, `CONTRACT = "figurereadouts/1"`). Writes `<svg stem>.readouts.json`: `{"contract", "model": content.sid, "keys": {path: {"label", "readouts": [{"id","label","unit","kind"}]}}}`, the groups of `readouts(content, vein=vein)`, indent 1. Docstring says ids are not checked against a compiled model.

`create_archive` writes it beside the anatomy figure with the vein of the species (`arm vein` for human, `VEINS` otherwise).

Deviations from the brief:
1. Not in `extra_files`: `write_archive` (sbmlsim) rejects `.json` (allowed: .ant .csv .md .pdf .png .svg .tsv .txt). Fixing needs a change in another repository, out of scope. The sidecar lies on disk beside the figure, like the snippets.
2. No sidecar for the schematic `<sid>.svg`: the schematic draws 20 key paths `readouts` does not return (seven_substances: `gu`, `gu/sub:*`, `gu/txt:TRA...`, `ki/urine`, `ki/urine/sub:*`, `lumen/feces`, `lumen/feces/sub:*`). A sidecar would have dead hotspots. `write_readouts` itself works on any SVG, but its output for the schematic is incomplete. Needs a decision: extend `readouts` for the schematic keys, or leave the schematic non-interactive-readout.

Tests (`tests/pbpk/test_readouts.py`): completeness of the anatomy figure (145-path-style parse with ancestor-joined `data-k`, nested paths required), vein follows the animal, archive writes the sidecar beside the anatomy figure only. Suite: readouts + archive + visual_anatomy 59 passed; ruff and ty clean. Unverified: an animal figure end to end (only the vein key tested on content, not an animal SVG parse). The tree's docs/pbpk/examples/cardiovascular*.mjs spill was left unstaged.

## Fix round 1
- Docstring of `write_readouts` narrowed: the guarantee holds for the anatomical drawing; the schematic draws `gu`, `gu/sub:*`, `ki/urine/*`, `lumen/feces/*` which `readouts` does not return.
- Comments in `create_archive` now state: sbmlsim `EXTRA_FORMATS` (`archive.py:31-40`) has no `.json`, `write_archive` raises for it, so the sidecar is not an archive entry until sbmlsim admits it (Task 5); then adding it to `figures` is a one-line change. The schematic gap is recorded with the same reason.
- New test `test_the_schematic_draws_keys_the_readouts_do_not_return`: asserts `gu`, `ki/urine`, `lumen/feces` are drawn and missing; fails when `readouts` covers them, its docstring says to write the schematic sidecar then.
- New test `test_the_sidecar_covers_the_figure_of_an_animal` (rat, parses the animal SVG, requires a `tail vein` key, completeness).
- Helper `vein_of(species)` in `visual/animal.py` (exported), used by `AnimalFigure` and `create_archive`; one source for the `tail vein` fallback.
- Tests: readouts + archive + anatomy + animal, 70 passed; ruff and ty clean.
