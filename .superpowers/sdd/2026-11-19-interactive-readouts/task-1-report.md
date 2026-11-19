# Task 1 report: readouts of every key of a figure

Commit on branch `readouts-sidecar` of pkpdsim (see sha in the handback).

## Built
- `src/pkpdsim/pbpk/visual/interactive.py`: frozen dataclasses `Readout(id, label, unit, kind)` and `ReadoutGroup(label, readouts)`, and
  `readouts(content: ModelContent, *, vein: str = "arm vein") -> dict[str, ReadoutGroup]`. Exported in `__all__`.
- Shared key construction in `src/pkpdsim/pbpk/visual/anatomy.py`: `substance_key(sid)` (`sub:<sid>`), `line_key(badge, text)` (`txt:<badge>: <text>`) and `OBSERVER_TEXT`. The SVG writers (anatomy chips and legend, animal legend, badge groups, blood line) now call them, so writer and sidecar share one construction. Keys are the unescaped DOM form of `data-k`.
- Tests `tests/pbpk/test_readouts.py` (10 tests), including one that draws the interactive snippet of `seven_substances()`, walks the nested `data-k` paths and asserts every one has a group.

## Decisions
- Organ compartments: plasma always first; `none` plasma only; `organ` + `Cor_`; `merged` + `Cti_`, `Cu_ti_`; `full` + `Cis_`, `Cic_`, `Cu_is_`, `Cu_ic_` (matches the brief's liver example).
- Organ key `li` = concatenation of the readouts of all its chips; `li/sub:<s>` = that substance. Substances come from `OrganContent.chips`, form from `parts` (default `none`).
- Process lines of an organ: the i-th of `OrganContent.lines` is the i-th process of that organ in chemistry order (`_organ_lines` builds them that way), so a process line gets `flat(organ, process.sid)`, kind `flux`, unit mmole/min, for MET, TRA and CUS. Remaining lines (URI, INH, SLW) get an empty tuple.
- Sample: `sample`, `blood`, `sub:<s>`, `blood/sub:<s>` give the Carm triple; `blood` and `sample` hold all substances; `blood/txt:OBS: arm vein: ...` holds the same as `blood`.
- `lumen` (Alumen, amount), `urine` (Aurine amount + Rurine rate), `feces` (Afeces + Rfeces) with their `/sub:<s>` children; lumen text lines, `iv`, `route:iv`, `route:oral`, `iv/txt:IV: ...`, `bladder`, `gallbladder`, `uterus`: empty tuples. `feces` is not in the glimepiride drawing's key list; included as a harmless superset.
- Units from the model's own `U` definitions via `unit_text`: concentration `mmole/liter`, amount `mmole`, rate and flux `mmole/min`. All derivable; nothing invented.
- Extra keyword `vein`: the animal figures rewrite "arm vein" inside the blood line (and so inside its `data-k`) to the species vein (`VEINS`: tail vein, ear vein). Pass `vein="tail vein"` to get the animal key. Default is the human text.

## Not verified / concerns
1. Existence of ids in a compiled model. I compiled the simple conftest definition with `readouts=("Alumen_drg","Rfeces_drg")` and checked every readout id against the flat SBML: all exist except `LA__Cpl_drg`, `LA__Cpl_drg_m`, `LA__Cti_drg`, `LA__Cu_ti_drg` (the large intestine, which the figure draws as an organ but the flat model has no `LA__` ids for). Task 2/3 must filter or tolerate ids absent from the model.
2. `Alumen_*`, `Rfeces_*` exist only when listed in `PBPKDefinition.readouts`; the sidecar maps them regardless. `Afeces_*` not checked.
3. A zonated liver (`seven_substances`) has zone-suffixed ids (`LI__Cpl_z1_api`), so `LI__Cpl_api`, `LI__Cti_api`, and zoned reaction ids (`LI__API3A4`) are not model ids there; also `Cpl_keto`-type ids of the inhibitor are absent in many organs of that fixture. I did not check the glimepiride model (non-zonated expected; `LI__GLI2M1` verified by you).
4. Not checked against the real committed glimepiride drawing (only the seven-substance figure); the animal figures not drawn in a test.
5. `uv run ty check` zero diagnostics, ruff check and format clean, tests of figure/anatomy/animal still pass (79 passed).

## Fix round 1
- Important 1: `Readout.id` and the `readouts` docstring now say the ids are what the id scheme gives, not checked against a compiled model, and the consumer filters them.
- Important 2: comment/docstring in `_compartments` names the zonated organ as a known limit; test `test_a_zonated_organ_reports_the_ids_without_a_zone` pins the current behaviour (liver variant "zonated", ids without zone).
- Minor: `sample` and `blood` groups asserted in full; new test `test_the_vein_of_the_blood_line_follows_the_figure` covers `vein=`.
- `anatomy.py` untouched. Command `uv run pytest tests/pbpk/test_readouts.py -q -n0`: 12 passed. ty and ruff clean.
