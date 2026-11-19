### Task 3: The figure of an app (sbmlsim)

**Files:**
- Modify: `src/sbmlsim/panel.py` (`AppPage` l.1081, `App` l.1186, `app_payload` l.1242, `app_from_payload` l.1266, `__all__`)
- Test: `tests/test_panel.py`

**Interfaces:**
- Consumes: the pydantic style of the module, `_CONFIG = ConfigDict(extra="forbid", frozen=True)`, `_Text`, `APP_CONTRACT = "app/1"`, `ContractError`.
- Produces: `AppFigure(svg: str, title: str, credit: str = "", panels: Mapping[str, tuple[str, ...]])`; `App.figure: AppFigure | None = None`; `AppPage.figure: bool = False`; `AppPage.shown: tuple[str, ...] = ()`.

- [ ] **Step 1: Write the failing test**

```python
def test_an_app_carries_a_figure_through_its_payload(app: App) -> None:
    figure = AppFigure(svg="<svg/>", title="The model", panels={"li/sub:gli": ("liver_gli",)})
    carried = app.model_copy(update={"figure": figure})
    assert app_from_payload(app_payload(carried)) == carried

def test_an_app_without_a_figure_reads_as_it_did(app: App) -> None:
    payload = app_payload(app)
    assert "figure" in payload  # null, as `uncertainty` is
    assert app_from_payload(payload) == app

def test_a_page_shows_the_panels_it_lists(app: App) -> None:
    with pytest.raises(ValidationError, match="shown"):
        AppPage(id="p", title="P", panels=("a",), shown=("b",))

def test_a_figure_selects_panels_the_app_has(app: App) -> None:
    with pytest.raises(ValidationError, match="unknown panel"):
        app.model_copy(update={"figure": AppFigure(svg="<svg/>", title="T", panels={"li": ("nope",)})}).model_validate(...)

def test_an_inline_figure_is_bounded(app: App) -> None:
    with pytest.raises(ValidationError, match="512"):
        AppFigure(svg="<svg>" + "x" * (512 * 1024), title="T", panels={})
```

- [ ] **Step 2: Run the test and see it fail**

Run: `cd /home/mkoenig/git/sbmlsim && uv run pytest tests/test_panel.py -k figure -q`
Expected: FAIL, `cannot import name 'AppFigure'`.

- [ ] **Step 3: Implement `AppFigure` and the two `AppPage` fields in `src/sbmlsim/panel.py`**

`app_payload` builds its dict explicitly, so the figure goes in by hand as `figure.model_dump(mode="json")` or `None`, and `app_from_payload` reads it back. The app validator (`_check_app`) refuses a figure which selects a panel no page lists; the page validator refuses a `shown` entry which is not in its own `panels`.

- [ ] **Step 4: Run the tests and see them pass**

Run: `uv run pytest tests/test_panel.py -q`
Expected: PASS

- [ ] **Step 5: Check the types and the style**

Run: `uv run ruff check && uv run ty check`

- [ ] **Step 6: Commit**

```bash
git add src/sbmlsim/panel.py tests/test_panel.py
git commit -m "An app carries the figure of its model"
```

---

