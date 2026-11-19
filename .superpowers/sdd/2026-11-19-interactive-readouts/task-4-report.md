# Task 4 report
DONE. Added src/sbmlsim/panel_figure.py (panels_from_figure, panel_id), tests/test_panel_figure.py (7 tests), fixtures tests/data/figure/{model.svg,model.readouts.json,other.readouts.json}. Ruff and ty clean, 7 passed.
Extras beyond the brief: a ContractError for a missing keys mapping and for two keys giving one panel id; a group above 16 readouts raises ContractError (not pydantic ValidationError). Mixed kinds give empty y_label. Ids not filtered. Did not touch archive.py, release files, or the unrelated uncommitted files.

## Fix round 1
A key with several units now opens one panel per unit (order of first appearance); id suffixed with the kinds (`_amount`), plus an index when the suffixes collide; y_label is the kinds joined by " / ". All malformed-sidecar cases (group not dict, no/blank label, bad readouts, missing id/kind/label, duplicate ids, Panel validation errors) raise ContractError naming key and file. Docstring Raises lists OSError and JSONDecodeError. Fixture other.readouts.json removed, tests write it via tmp_path. 22 tests pass, ruff and ty clean. Rulings recorded: colliding panel ids stay refused; sidecar keys the SVG does not draw are unchecked.
