### Task 4: The panels of a sidecar (sbmlsim)

**Files:**
- Create: `src/sbmlsim/panel_figure.py`
- Test: `tests/test_panel_figure.py`, fixture `tests/data/figure/`

**Interfaces:**
- Consumes: `AppFigure` of Task 3, `Panel`, `PanelCurve`, `PanelSimulation` (`panel.py:617, 306, 537`), `ContractError`.
- Produces: `panels_from_figure(svg: Path, readouts: Path, *, simulation: PanelSimulation, title: str, credit: str = "", prefix: str = "") -> tuple[dict[str, Panel], AppFigure]`.

- [ ] **Step 1: Write the failing test**

A fixture sidecar `tests/data/figure/model.readouts.json` with three keys (an organ with two substances, the urine, a decoration) and `tests/data/figure/model.svg` with the matching `data-k` groups. Then:

```python
def test_a_group_of_the_sidecar_becomes_a_panel_of_its_readouts() -> None:
    panels, figure = panels_from_figure(SVG, READOUTS, simulation=SIMULATION, title="The model")
    panel = panels["li_gli"]
    assert [c.id for c in panel.curves] == ["LI__Cpl_gli", "LI__Cis_gli", "LI__Cic_gli"]
    assert panel.y_label == "concentration"
    assert figure.panels["li/sub:gli"] == ("li_gli",)

def test_a_decoration_selects_nothing() -> None:
    _, figure = panels_from_figure(...)
    assert figure.panels["bladder"] == ()

def test_the_figure_carries_the_svg_inline() -> None: ...

def test_a_sidecar_of_another_contract_is_refused() -> None:
    with pytest.raises(ContractError, match="figurereadouts/1"):
        panels_from_figure(SVG, OTHER, simulation=SIMULATION, title="T")

def test_a_group_of_more_than_sixteen_curves_is_refused() -> None: ...
```

- [ ] **Step 2: Run the test and see it fail**

Run: `uv run pytest tests/test_panel_figure.py -q`
Expected: FAIL, no module `sbmlsim.panel_figure`.

- [ ] **Step 3: Implement `panels_from_figure` in `src/sbmlsim/panel_figure.py`**

The panel id of a group is the key path with the non-word characters replaced by `_` and the `sub:` dropped, prefixed by `prefix`; its title is the group label; its curves are the readouts in order, each a `PanelCurve(id=..., label=..., unit=...)`; its `y_label` is the kind of its readouts when they share one, and its simulation is the one passed in. The function reads the SVG as text for the inline figure and refuses a payload whose `contract` is not `figurereadouts/1`.

- [ ] **Step 4: Run the tests and see them pass**

Run: `uv run pytest tests/test_panel_figure.py -q`

- [ ] **Step 5: Check the types and the style**

Run: `uv run ruff check && uv run ty check`

- [ ] **Step 6: Commit**

```bash
git add src/sbmlsim/panel_figure.py tests/test_panel_figure.py tests/data/figure
git commit -m "The panels of the readouts of a figure"
```

---

