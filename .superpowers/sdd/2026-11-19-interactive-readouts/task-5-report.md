# Task 5 report

Commit 67f8d6cc on figure-declaration.

- The brief on disk describes a `_check_app` change in serve/runner.py; I followed the task message instead (ruled decision: drop and report, empty group becomes decoration, fail only when nothing is left). `_check_app` and runner.py are untouched.
- `panel_figure.restrict_to_model(panels, figure, has_selection)` (pass `SBMLModel.has_selection`) returns (panels, figure, dropped ids). Missing curves dropped with one warning; a panel with no curve left is removed and leaves its key's selection (key becomes `()`); ContractError naming the ids if something was missing and no panel survives. Nothing is dropped/failed for a complete model or a sidecar with no readouts at all. The caller must build the page panel lists from the returned panels, else `_check_app` refuses the dropped panel ids. Nothing in the repo calls it yet (the model package/factory is the caller).
- archive.py: `.json` admitted. pymetadata 0.8.3 (latest) has no `EntryFormat.JSON`, so the format is the media type URI `https://purl.org/NET/mediatypes/application/json` (via `_EXTRA_URIS`); `entry()` accepts `EntryFormat | str`.
- build.py: one line, `"*.json"` added to `_FACTORY_PATTERNS`.
- Extra files: both are opt-in per caller. `*.json` globbed only at the top of the factory `models/` dir (wasm/ json lives in a subdir and is already copied by copytree), so any other top-level json the factory writes there would now also be copied; I found none in this repo. write_archive extra_files only gets what callers pass.
- Tests: new tests in tests/test_panel_figure.py (4), test_release_archive.py, test_release_build.py. 63 pass in those files; ty and ruff clean. Full tests/release: only test_zensical_strict and test_the_release_of_the_toy fail, both for missing `zensical` executable (environment).

## Fix round 1

- `_check_app` (serve/runner.py) now calls `_check_figure` for an app with a figure: in every served variant it loads the model once (`_load`, only when the figure selects a panel) and for every curve of every panel the figure selects checks `model.has_selection(curve.id)` (the message names model, variant, key path, panel, curve and points to `restrict_to_model`), then `curve_unit(model, curve)`. Note `curve_unit` alone does not raise for an absent id (it defaults the unit), hence the explicit `has_selection`. The unknown-panel case of the brief is already refused by the `App` validator (Task 3).
- Tests in tests/serve/test_app.py: missing curve names id, key path and panel; a figure of existing curves is accepted. The brief's bundle/`render_app` test is not written: AppResponse in the serve payload does not yet carry `figure`/`shown` (see below).
- tests/serve: 16 failed + 14 errors with `uv run`, identical before and after my change (verified with stash): `AppResponse` forbids the new `figure`/`shown` fields of `app_payload` (pages.N.figure extra_forbidden). Pre-existing from Tasks 3/4, not mine; belongs to the payload task.
- zensical: with `uv run pytest -q tests/release` all 269 pass. Added `zensical()` in tests/release/fakes.py (PATH, else next to `sys.executable`), used by both tests; a bare `.venv/bin/python -m pytest` run of test_zensical_strict now passes too.
- `*.json` in `_FACTORY_PATTERNS` vs real packages: `pkdb_models-band` glimepiride, hctz and apixaban `models/output/` hold only ant, html, md, png, svg, txt, xlsx, xml at the top level; no top-level `.json`, so the pattern copies nothing new today (wasm json is in a subdirectory, already copied by copytree). It will match the readouts sidecar once the factory writes it.

## Fix round 2

- serve/payload.py: new `AppFigurePayload` (svg, title, credit, panels), `AppResponse.figure: AppFigurePayload | None = None`, `AppPagePayload.figure: bool = False` and `shown: list[str] = []`. The bundle and the exported page build the app through `AppResponse.of`, so one fix covers service, bundle and page; nothing else mirrors the app payload.
- Tests (tests/serve/test_app.py): the figure survives the service route and `build_bundle` (the bundle content is what `render_app` embeds as JSON; rendering the page itself needs compiled wasm models, so it is not run); an app without a figure answers `figure: null`, pages `figure: false`, `shown: []`.
- Full run: `uv run pytest -q tests/serve tests/test_panel.py tests/test_panel_figure.py tests/release` = 797 passed, 1 skipped, nothing red. ruff and ty clean. I did not run the rest of tests/ or origin/develop.

## Fix round 3

- `restrict_to_model`: the docstring now says the caller rebuilds its pages from the returned panels and registers the returned figure. Panels and figure are re-validated (`Panel.model_validate`, `AppFigure.model_validate`, no `model_copy`), including a key whose selection became `()`. The warning reads "does not have", and names the parts which lost readouts and the ones which select nothing.
- Test `test_a_restricted_figure_registers_with_the_pages_rebuilt`: restrict, rebuild the pages from the surviving panels, `ModelRegistry.of_projects` accepts; the unrestricted declaration is refused naming the curve.
- `_check_app` docstring: no longer says "reads nothing" for every app, names the figure check and its `ValueError` in Raises. The extra model load per served variant is not avoided: a registry has no warm model at registration (it belongs to the runner), stated in the docstring.
- build.py: pattern narrowed to `*.readouts.json`, comment and `_copy_models` docstring updated.
- The brief's `render_app` assertion is covered through `build_bundle` content, not a real render: `render_app` needs wasm-compiled models (sbmlsim-core compile), and the page embeds exactly that bundle content as JSON.
- `uv run pytest -q tests/serve tests/test_panel.py tests/test_panel_figure.py tests/release`: see contract line for counts.

## Follow-up from the client review

The browser client refuses a blank svg, so the server must too. `AppFigure.svg` is now `_Text` (non-blank), the size bound unchanged (existing tests at and above the limit still pass). Test: empty, spaces and whitespace-only svg refused, a normal one passes. `uv run pytest -q tests/serve tests/test_panel.py tests/test_panel_figure.py tests/release`: 801 passed, 1 skipped.

- Follow-up: `panels_from_figure` wraps the `AppFigure` construction, so a blank svg, a blank title or any other refused figure is a `ContractError` naming the drawing and the pydantic reason (docstring Raises corrected; two tests).
