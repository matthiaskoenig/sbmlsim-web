# Task 3 report
Status: DONE. Branch figure-declaration, one commit "An app carries the figure of its model".
Changed: src/sbmlsim/panel.py, tests/test_panel.py only.
- Added AppFigure (svg, title, credit, panels), MAX_FIGURE_BYTES (512 KiB, measured in UTF-8 bytes, limit is exclusive), App.figure, AppPage.figure/shown, exported in __all__.
- app_payload writes "figure" (null without); app_from_payload reads it through model validation.
- _check_app refuses a figure panel no page lists; _check_page refuses shown not in panels.
- Not added: a check that a page with figure=True needs App.figure; no sidecar-id filtering; archive.py and PR #575 files untouched.
- Brief's 4th test used a broken `.model_validate(...)` chain; rewritten as App.model_validate on a dumped dict.
Evidence: pytest tests/test_panel.py 171 passed; ruff check and ty check clean.

## Fix round 1
- _check_app refuses a page with figure=True when App.figure is None (names the pages); _check_page refuses shown without figure and duplicate shown; AppFigure refuses a repeated panel id per key.
- Size limit now inclusive (`>`): limit passes, limit+1 fails; boundary test added.
- Plural, plain-id error message; app_payload docstring rewrapped; svg docstring says it is trusted markup, not sanitized.
- Unused App.figure still allowed. Tests pass, ruff and ty clean.
