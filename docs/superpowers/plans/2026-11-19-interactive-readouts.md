# Interactive Readouts of a Model App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A reader clicks a place in the figure of a model and the timecourses the model reports there appear beside it, a second click takes them away, and the figure marks what is on screen.

**Architecture:** pkpdsim writes a `figurereadouts/1` JSON sidecar beside the SVG it already draws, keyed by the path of the `data-k` keys from the outside in. sbmlsim reads that sidecar and emits generated panels plus an `AppFigure` which an `App` carries, and the renderer draws the figure, marks the shown paths and reports a click, knowing no naming convention. pkdb_models declares it for glimepiride.

**Tech Stack:** python 3.14 (pkpdsim, sbmlsim, pkdb_models; pytest, ruff, ty), TypeScript and Vue 3 custom elements (sbmlsim-web; vitest, playwright, eslint, prettier, vue-tsc).

**Spec:** `docs/superpowers/specs/2026-11-19-interactive-readouts-design.md` (in sbmlsim-web, branch `interactive-readouts`)

## Global Constraints

Never use the em dash character. Use a plain dash.

No attribution of an agent anywhere: no "Co-Authored-By", no "Generated with" line, badge or link, in a commit message, a pull request, a comment, code, documentation or a release note.

The sidecar names its contract `figurereadouts/1`, as `panel/1`, `app/1` and `panelbundle/1` name theirs.

The inline SVG of a figure is at most 512 KB. The anatomical drawing of glimepiride is 196 KiB.

A panel declares at most 16 curves (`MAX_CURVES`) and 8 knobs (`MAX_KNOBS`). A generated group is at most 5 curves, which is the `full` tissue form.

`SimulateRequest` carries `values`, `grid`, `variant` and `draws` and nothing else. No task adds a field to it.

Every readout id of a sidecar is checked against the compiled model when the bundle is written, and an id the model does not have fails the build with the id named.

Python: every module, class and function of a package carries full annotations and a google style docstring (ruff `D`); `uv run ty check` must stay at zero diagnostics; markdown carries no hard line wraps.

Each repository takes its change through a pull request: `develop` for pkpdsim, sbmlsim and pkdb_models, `main` for sbmlsim-web. Direct pushes are rejected.

Release order when the work lands: pkpdsim, then sbmlsim-web, then sbmlsim which vendors the renderer, then pkdb_models. Task 12 cannot be committed before pkpdsim and sbmlsim are released, because the `ty` hook and the CI of pkdb_models resolve both from `uv.lock`.

## Review Focus

A page whose declaration has no figure, which is every app today: it must render exactly as it does now, and an old payload without the new fields must still parse although `app/1` reads with `extra="forbid"` (Task 3, Task 8).

A click on an element whose longer path is not in the map, and a click on an element with no key at all: the first falls back to the shorter path, the second does nothing (Task 7).

A figure which selects a panel the page does not list: the declaration must be refused where it is built, not drawn as an empty pane (Task 3).

Every key of the figure selected at once, which is about 60 panels for glimepiride: the panes of one state stay one scan of the model and the page does not issue a request per pane (Task 10).

A readout id which the compiled model does not have: the build fails and names the id, instead of a pane with no curve (Task 5).

---

## File Structure

**pkpdsim** (`/home/mkoenig/git/pkpdsim`, branch off `develop`)

- Modify `src/pkpdsim/pbpk/visual/interactive.py`: `readouts(content)` beside `cards(content, volumes)`, the walk which knows the id convention.
- Modify `src/pkpdsim/pbpk/archive.py:269-285`: write the sidecar beside each SVG.
- Create `tests/pbpk/test_readouts.py`.

**sbmlsim** (`/home/mkoenig/git/sbmlsim`, branch off `develop`)

- Modify `src/sbmlsim/panel.py`: `AppFigure`, `App.figure`, `AppPage.figure`, `AppPage.shown`, `app_payload`, `app_from_payload`.
- Create `src/sbmlsim/panel_figure.py`: `panels_from_figure`, the reader of `figurereadouts/1`.
- Modify `src/sbmlsim/serve/runner.py:719` (`_check_app`): the ids a figure selects.
- Create `tests/test_panel_figure.py`, modify `tests/test_panel.py`.

**sbmlsim-web** (`/home/mkoenig/git/sbmlsim-web`, branch `interactive-readouts`)

- Modify `src/contract.ts`: `AppFigure`, the two new `AppPage` fields.
- Create `src/SbmlsimFigure.ce.vue` and `src/SbmlsimFigure.test.ts`: the figure element.
- Modify `src/SbmlsimApp.ce.vue`: the figure beside the grid, the selection, the shared card, the information tab.
- Modify `src/index.ts`, `src/tags.ts`: the new element.
- Modify `docs/examples/glimepiride/nca.mjs:146` and `docs/examples/glimepiride/app.html`: the `cv` column, the draws control, the citation.
- Create `e2e/readouts.spec.ts`.

**pkdb_models** (`/home/mkoenig/git/pkdb_models-band`, branch off `develop`)

- Modify `pkdb_models/models/glimepiride/panels.py` and `pkdb_models/models/glimepiride/__init__.py`.

---

### Task 1: The readouts of every key of a figure (pkpdsim)

**Files:**

- Modify: `src/pkpdsim/pbpk/visual/interactive.py` (beside `cards`, line 95)
- Test: `tests/pbpk/test_readouts.py`

**Interfaces:**

- Consumes: `ModelContent` (`src/pkpdsim/pbpk/visual/content.py:111`, `ModelContent.of(definition)`), `OrganContent.parts: Mapping[str, str]` with the tissue forms `none`, `organ`, `merged`, `full`; `pkpdsim.pbpk.ids` (`species`, `unbound`, `flat`, `arm`, `arm_free`, `arm_blood`, `urine`, `urine_rate`, `feces`, `feces_rate`, `lumen_amount`); `ModelContent.processes` (`Process(kind, sid, organ, ...)`).
- Produces: `Readout` and `ReadoutGroup` dataclasses and `readouts(content: ModelContent) -> dict[str, ReadoutGroup]`, keyed by the key path of the figure (`li`, `li/sub:gli`, `blood/txt:OBS: ...`).

- [ ] **Step 1: Write the failing test**

```python
# tests/pbpk/test_readouts.py
def test_an_organ_reports_its_substance_in_the_compartments_of_its_form() -> None:
    content = ModelContent.of(seven_substances())
    groups = readouts(content)
    liver = groups["li/sub:api"]
    assert [r.id for r in liver.readouts] == ["LI__Cpl_api", "LI__Cis_api", "LI__Cic_api", "LI__Cu_is_api", "LI__Cu_ic_api"]
    assert [r.kind for r in liver.readouts] == ["concentration"] * 5

def test_a_plasma_only_organ_reports_its_plasma_alone() -> None:
    # an organ whose parts give the tissue form "none"
    ...

def test_the_sample_reports_the_total_the_free_and_the_whole_blood() -> None:
    groups = readouts(ModelContent.of(seven_substances()))
    assert [r.id for r in groups["sample/sub:api"].readouts] == ["Carm_api", "Carm_free_api", "Carm_blood_api"]

def test_the_urine_reports_the_amount_and_the_rate() -> None: ...

def test_a_process_badge_reports_the_flux_of_its_reaction() -> None:
    # the key path of a badge of the liver, the id is flat(organ, process.sid)
    ...

def test_a_decoration_of_the_drawing_has_no_readout() -> None:
    assert readouts(ModelContent.of(seven_substances()))["bladder"].readouts == ()
```

- [ ] **Step 2: Run the test and see it fail**

Run: `cd /home/mkoenig/git/pkpdsim && uv run pytest tests/pbpk/test_readouts.py -q`
Expected: FAIL, `cannot import name 'readouts'`.

- [ ] **Step 3: Implement `readouts(content: ModelContent) -> dict[str, ReadoutGroup]` in `src/pkpdsim/pbpk/visual/interactive.py`**

`Readout` is a frozen dataclass of `id: str`, `label: str`, `unit: str`, `kind: Literal["concentration", "amount", "rate", "flux"]`; `ReadoutGroup` is a frozen dataclass of `label: str` and `readouts: tuple[Readout, ...]`. The keys are the key paths the figure writes: the organ keys and `sample`, `blood`, `lumen`, `urine`, `feces`, `iv`, the routes, the legend chips `sub:<sid>`, the nested `<organ>/sub:<sid>` and `<organ>/txt:<badge>: <text>`, and the decorations `bladder`, `gallbladder`, `uterus` with an empty tuple. The compartments of an organ follow `OrganContent.parts[sid]`: `none` the plasma, `organ` the one species, `merged` the tissue and its unbound, `full` the interstitium, the cells and both unbound forms. The ids come from `ids`, never from a format string written here.

- [ ] **Step 4: Run the test and see it pass**

Run: `cd /home/mkoenig/git/pkpdsim && uv run pytest tests/pbpk/test_readouts.py -q`
Expected: PASS

- [ ] **Step 5: Check the types and the style**

Run: `cd /home/mkoenig/git/pkpdsim && uv run ty check && uv run ruff check && uv run ruff format --check`
Expected: zero diagnostics, "All checks passed!"

- [ ] **Step 6: Commit**

```bash
git add src/pkpdsim/pbpk/visual/interactive.py tests/pbpk/test_readouts.py
git commit -m "The readouts of every key of a model figure"
```

---

### Task 2: The sidecar beside the SVG (pkpdsim)

**Files:**

- Modify: `src/pkpdsim/pbpk/visual/interactive.py` (the writer), `src/pkpdsim/pbpk/archive.py:269-285`
- Test: `tests/pbpk/test_readouts.py`

**Interfaces:**

- Consumes: `readouts(content)` of Task 1; `model_figure(definition, path, sexes)` (`pbpk/figure.py:1253`) and `anatomy_figure(definition, path, *, sexes=...)` (`pbpk/visual/anatomy.py:899`), both called in `create_archive`.
- Produces: `write_readouts(content: ModelContent, svg: Path) -> Path`, which writes `<svg stem>.readouts.json` beside the SVG, the payload `{"contract": "figurereadouts/1", "model": <sid>, "keys": {<path>: {"label": str, "readouts": [{"id", "label", "unit", "kind"}]}}}`.

- [ ] **Step 1: Write the failing test**

```python
def test_every_key_the_figure_draws_is_a_key_of_the_sidecar(tmp_path: Path) -> None:
    definition = seven_substances()
    svg = anatomy_figure(definition, tmp_path / "m_body.svg")
    sidecar = write_readouts(ModelContent.of(definition), svg)
    payload = json.loads(sidecar.read_text())
    assert payload["contract"] == "figurereadouts/1"
    assert set(_key_paths_of(svg)) <= set(payload["keys"])  # a dead hotspot is a defect

def test_the_sidecar_of_the_schematic_names_the_same_contract(tmp_path: Path) -> None: ...
```

`_key_paths_of(svg)` is a helper of the test file which parses the SVG with `xml.etree.ElementTree` and joins the `data-k` of every ancestor chain, the same rule the renderer follows.

- [ ] **Step 2: Run the test and see it fail**

Run: `uv run pytest tests/pbpk/test_readouts.py -q`
Expected: FAIL, `cannot import name 'write_readouts'`.

- [ ] **Step 3: Implement `write_readouts` and call it from `create_archive`**

In `archive.py`, write the sidecar beside both figures under the same `if figure:` which writes them, and add both sidecars to the `extra_files` of `write_archive` next to the SVGs.

- [ ] **Step 4: Run the whole visual suite**

Run: `uv run pytest tests/pbpk/test_readouts.py tests/pbpk/test_visual_anatomy.py tests/pbpk/test_archive.py -q`
Expected: PASS

- [ ] **Step 5: Check the types and the style**

Run: `uv run ty check && uv run ruff check`

- [ ] **Step 6: Commit**

```bash
git add src/pkpdsim/pbpk/visual/interactive.py src/pkpdsim/pbpk/archive.py tests/pbpk/test_readouts.py
git commit -m "The figure of a model writes the readouts of its keys beside it"
```

---

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

### Task 5: The ids of a figure are checked against the model (sbmlsim)

**Files:**

- Modify: `src/sbmlsim/serve/runner.py:719` (`_check_app`)
- Test: `tests/serve/test_app.py`

**Interfaces:**

- Consumes: `_check_app(entry)`, which already checks that the panels of the pages exist, and `curve_unit(model, curve)` (`runner.py:2252`), which resolves a curve id against the model and raises naming the curve.
- Produces: nothing new; a registration which fails when a figure names a panel the app does not have, and a build which fails when a generated curve id is not a selection of the model.

- [ ] **Step 1: Write the failing test**

```python
def test_a_figure_which_names_an_unknown_panel_is_refused() -> None:
    # register an app whose figure selects "ghost"; the error names the panel and the key path
    with pytest.raises(ValueError, match="li/sub:gli"):
        ...

def test_a_curve_the_model_does_not_have_names_the_id() -> None:
    # a generated panel whose curve id is absent from the model
    with pytest.raises(ValueError, match="LI__Cpl_nope"):
        ...

def test_the_bundle_and_the_page_carry_the_figure(tmp_path: Path) -> None:
    # `build_bundle` (serve/export.py:258) and `render_app` (webapp/page.py:138)
    bundle = build_bundle(registry, "model")
    assert bundle.answers["app"]["figure"]["panels"]["li/sub:gli"] == ["li_gli"]
    assert "li/sub:gli" in render_app(bundle, compiled, title="T")
```

- [ ] **Step 2: Run the test and see it fail**

Run: `uv run pytest tests/serve/test_app.py -k figure -q`

- [ ] **Step 3: Extend `_check_app` in `src/sbmlsim/serve/runner.py`**

Add the figure check next to the page check which is there already, and name the key path and the panel id in the message.

- [ ] **Step 4: Run the serve suite**

Run: `uv run pytest tests/serve -q`

- [ ] **Step 5: Commit**

```bash
git add src/sbmlsim/serve/runner.py tests/serve/test_app.py
git commit -m "A figure which selects a panel the app has not is refused"
```

---

### Task 6: The contract of the figure in the renderer (sbmlsim-web)

**Files:**

- Modify: `src/contract.ts` (`AppPage` l.546, `AppDeclaration` l.590)
- Test: `src/contract.test.ts`, fixture `src/fixtures/contract.json`

**Interfaces:**

- Consumes: the payload of Task 3.
- Produces: `AppFigure { svg: string; title: string; credit: string; panels: Record<string, string[]> }`, `AppPage.figure: boolean`, `AppPage.shown: string[]`, `AppDeclaration.figure: AppFigure | null`.

- [ ] **Step 1: Write the failing test**

```ts
it('reads an app whose declaration carries a figure', () => {
  const declaration = {
    ...sample,
    figure: { svg: '<svg/>', title: 'The model', credit: '', panels: { 'li/sub:gli': ['li_gli'] } },
  }
  expect(appOf(declaration).figure?.panels['li/sub:gli']).toEqual(['li_gli'])
})

it('reads an app which spells its figure `null`, as a service does', () => {
  expect(appOf({ ...sample, figure: null }).figure).toBeNull()
})
```

- [ ] **Step 2: Run the test and see it fail**

Run: `cd /home/mkoenig/git/sbmlsim-web && npx vitest run src/contract.test.ts`

- [ ] **Step 3: Add the types to `src/contract.ts` and regenerate the fixture**

A field the service may spell `null` is `T | null` in the mirror, as `uncertainty` is, and the sample in `src/fixtures/contract.json` gains `figure`, `figure: false` and `shown: []` on its pages.

- [ ] **Step 4: Run the test and the type check**

Run: `npx vitest run src/contract.test.ts && npm run typecheck`

- [ ] **Step 5: Commit**

```bash
git add src/contract.ts src/contract.test.ts src/fixtures/contract.json
git commit -m "The contract of the figure of an app"
```

---

### Task 7: The figure element (sbmlsim-web)

**Files:**

- Create: `src/SbmlsimFigure.ce.vue`, `src/SbmlsimFigure.test.ts`
- Modify: `src/tags.ts`, `src/index.ts`

**Interfaces:**

- Consumes: `AppFigure` of Task 6.
- Produces: the element `<sbmlsim-figure>` with the properties `figure: AppFigure | null` and `marked: string[]`, which emits `sbmlsim-figure-select` with `detail: { key: string }`; `FIGURE_TAG` in `src/tags.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment happy-dom
it('reports the path of the keys of what was clicked', async () => {
  const element = await figureElement({ 'li/sub:gli': ['li_gli'] })
  click(element, '[data-k="sub:gli"]')          // the chip inside the group of the liver
  expect(selected()).toEqual(['li/sub:gli'])
})

it('falls back to the shorter path when the longer one is not in the map', async () => {
  const element = await figureElement({ li: ['li_all'] })
  click(element, '[data-k="sub:gli"]')
  expect(selected()).toEqual(['li'])
})

it('reports nothing for an element which carries no key', async () => { ... })

it('marks every path it is told is on screen', async () => {
  const element = await figureElement({ 'li/sub:gli': ['li_gli'] }, ['li/sub:gli'])
  expect(marked(element)).toEqual(['li/sub:gli'])
})
```

- [ ] **Step 2: Run the test and see it fail**

Run: `npx vitest run src/SbmlsimFigure.test.ts`

- [ ] **Step 3: Implement `src/SbmlsimFigure.ce.vue`**

The element renders the SVG of the declaration with `v-html` into a wrapper, and one delegated `click` listener walks from `event.target` up to the wrapper, collecting `data-k` values into the path from the outside in; the longest path which is a key of `figure.panels` wins, and a path which is in no key reports nothing. A marked path gets a class on its outermost element, which a theme aware CSS rule draws in both themes. The element is registered next to the panel and the app in `src/index.ts`.

- [ ] **Step 4: Run the test and see it pass**

Run: `npx vitest run src/SbmlsimFigure.test.ts && npm run lint && npm run typecheck`

- [ ] **Step 5: Commit**

```bash
git add src/SbmlsimFigure.ce.vue src/SbmlsimFigure.test.ts src/tags.ts src/index.ts
git commit -m "The figure of a model is an element which reports what was clicked"
```

---

### Task 8: The app selects its panes from the figure (sbmlsim-web)

**Files:**

- Modify: `src/SbmlsimApp.ce.vue` (props l.207, `show(id)` l.795, the grid)
- Test: `src/SbmlsimApp.test.ts`

**Interfaces:**

- Consumes: `<sbmlsim-figure>` of Task 7, `AppPage.shown` and `AppDeclaration.figure` of Task 6.
- Produces: the attribute `selection` (a comma separated list of panel ids) and the event `sbmlsim-selection` with `detail: { panels: string[] }` on `<sbmlsim-app>`.

- [ ] **Step 1: Write the failing test**

```ts
it('places the panels the page shows before anything is clicked', async () => {
  const element = await shell({}, appWithFigure())
  expect(placedPanels(element)).toEqual(['glimepiride', 'm1'])
})

it('adds the panels of a clicked key and removes them when it is clicked again', async () => {
  const element = await shell({}, appWithFigure())
  clickKey(element, 'li/sub:gli')
  expect(placedPanels(element)).toEqual(['glimepiride', 'm1', 'li_gli'])
  clickKey(element, 'li/sub:gli')
  expect(placedPanels(element)).toEqual(['glimepiride', 'm1'])
})

it('places the panels in the order the page declares them, whatever order they were clicked in', async () => { ... })

it('renders a page without a figure as it did', async () => {
  const element = await shell({}, app())      // the app of the suite today, no figure
  expect(placedPanels(element)).toEqual(['panelA', 'panelB'])
  expect(element.shadowRoot!.querySelector(FIGURE_TAG)).toBeNull()
})
```

- [ ] **Step 2: Run the test and see it fail**

Run: `npx vitest run src/SbmlsimApp.test.ts`

- [ ] **Step 3: Implement the selection in `src/SbmlsimApp.ce.vue`**

A page with `figure: true` places `<sbmlsim-figure>` beside its grid and passes it the app's figure and the key paths every panel of which is in the selection. The selection starts as the page's `shown`, a click toggles the panel ids of the clicked path, and the grid places the panels of the selection in the order the page lists them. The attribute and the event mirror the selection, as `page` and `sbmlsim-page` do.

- [ ] **Step 4: Run the tests and see them pass**

Run: `npx vitest run src/SbmlsimApp.test.ts && npm run lint && npm run typecheck`

- [ ] **Step 5: Commit**

```bash
git add src/SbmlsimApp.ce.vue src/SbmlsimApp.test.ts
git commit -m "The panes of an app are the selection of its figure"
```

---

### Task 9: The settings and information card (sbmlsim-web)

**Files:**

- Modify: `src/SbmlsimApp.ce.vue` (the shell, the footer ~l.134, `collect(event)` l.741), `src/SbmlsimPanel.ce.vue` (the `log` property beside `initialLog(declared)` l.1946)
- Test: `src/SbmlsimApp.test.ts`

**Interfaces:**

- Consumes: the panel methods `reset` and `activate` (`SbmlsimPanel.ce.vue:3029`), the panel event `sbmlsim-result` (`detail: {provenance, spec_hash}`), `Provenance` (`contract.ts:401`: `engine`, `sbmlsim`, `seconds`, `created`, `model_sha256`).
- Produces: a card above the grid with the logarithmic switch of every plot, the reset of the page, the draws control and the line of the last run; the information tab built from `title`, `subtitle`, `citation`, `doi`, `licenses` and `variants`.

- [ ] **Step 1: Write the failing test**

```ts
it('sets the logarithmic axis of every placed panel', async () => {
  const element = await shell({}, appWithFigure())
  toggle(element, '.settings input[type=checkbox]')
  expect(placed(element).every((p) => p.getAttribute('log') === 'true')).toBe(true)
})

it('reports the seconds and the engine of the last run', async () => {
  const element = await shell({}, appWithFigure())
  await resultOf(element, { seconds: 0.042, engine: 'sbmlsim-core 0.12.0' })
  expect(textOf(element, '.settings .run')).toContain('0.042 s')
  expect(textOf(element, '.settings .run')).toContain('sbmlsim-core 0.12.0')
})

it('keeps the selection when the page is reset', async () => { ... })

it('builds an information tab from the declaration', async () => {
  const element = await shell({}, appWithFigure())
  show(element, 'information')
  expect(textOf(element, '.information')).toContain('CC BY-SA 4.0')
})
```

- [ ] **Step 2: Run the test and see it fail**

Run: `npx vitest run src/SbmlsimApp.test.ts -t settings`

- [ ] **Step 3: Implement the card and the tab in `src/SbmlsimApp.ce.vue`**

The logarithmic switch writes a `log` attribute onto every placed panel, which the panel reads as its initial axis in place of `initialLog(declared)`; this needs the matching property on the panel, so the panel keeps its own switch and its own reset. The draws control moves next to it and keeps writing the `draws` attribute the app already passes on. The run line reads the provenance the app already collects in `collect(event)`. The information tab is one more entry in the tab row the app renders today.

- [ ] **Step 4: Run the suite**

Run: `npx vitest run && npm run lint && npm run typecheck`

- [ ] **Step 5: Commit**

```bash
git add src/SbmlsimApp.ce.vue src/SbmlsimPanel.ce.vue src/SbmlsimApp.test.ts
git commit -m "One card for what every plot of a page shares"
```

---

### Task 10: The selection stays one scan (sbmlsim-web)

**Files:**

- Create: `e2e/readouts.spec.ts`
- Test: the same file

**Interfaces:**

- Consumes: the inline endpoint of `sbmlsim-core` (`js/panels.mjs:370,555,708`), whose `Runs` cache is keyed by `[model, start, end, points, point list]` and joins a run in flight; the staged demo of `playwright.config.ts`.

- [ ] **Step 1: Write the failing test**

```ts
test('a selection of every key of the figure runs the model once', async ({ page }) => {
  await page.goto(EXAMPLE)
  const runs = await countRuns(page, async () => { await selectEveryKey(page) })
  expect(runs).toBe(1)
})

test('a click on a place adds its panes and a second click removes them', async ({ page }) => { ... })
```

`countRuns` counts the calls of the pool of the inline endpoint, which the page exposes on `window` in the test build, not the HTTP requests.

- [ ] **Step 2: Run it and see it fail**

Run: `SBMLSIM_REPO=/home/mkoenig/git/sbmlsim npm run e2e -- readouts`

- [ ] **Step 3: Make it pass**

The panes of one state must reach the endpoint with the same run key. If a generated panel sets a different `end` or `points` than the panels of the page, it breaks the key, so the generated panels take the simulation of the page.

- [ ] **Step 4: Run the whole browser suite**

Run: `SBMLSIM_REPO=/home/mkoenig/git/sbmlsim npm run e2e`
Expected: every spec passes.

- [ ] **Step 5: Commit**

```bash
git add e2e/readouts.spec.ts
git commit -m "A selection of twenty readouts is one scan of the model"
```

---

### Task 11: The documentation dashboard (sbmlsim-web)

**Files:**

- Modify: `docs/examples/glimepiride/nca.mjs:146`, `docs/examples/glimepiride/app.html:79-105`
- Test: `docs/examples/glimepiride/nca.test.mjs`

**Interfaces:**

- Consumes: the kernel's `summarize`, which answers `cv` among its statistics.

- [ ] **Step 1: Write the failing test**

```js
it('reports the coefficient of variation of every parameter', () => {
  const table = parameterTable(sampleCurves())
  expect(table.columns).toContain('cv')
  expect(table.rows[0].cv).toBeCloseTo(0.23, 2)
})
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run docs/examples/glimepiride/nca.test.mjs`

- [ ] **Step 3: Add `cv` to `STATISTICS` and the column to the table, move the draws control into the settings card and put the citation last in `app.html`**

The citation is the one the declaration carries, which the app already renders in its footer; the page shows it as the last section.

- [ ] **Step 4: Run it and see it pass**

Run: `npx vitest run docs/examples/glimepiride/nca.test.mjs && npm run lint`

- [ ] **Step 5: Commit**

```bash
git add docs/examples/glimepiride/nca.mjs docs/examples/glimepiride/app.html docs/examples/glimepiride/nca.test.mjs
git commit -m "The parameter table shows the coefficient of variation"
```

---

### Task 12: Glimepiride declares its figure (pkdb_models)

**Blocked:** needs a released pkpdsim with Task 2 and a released sbmlsim with Tasks 3 to 5 which also vendors the sbmlsim-web release of Tasks 6 to 11 (`scripts/web_assets.py`, `VERSION`), because the `ty` hook and the CI of pkdb_models resolve both from `uv.lock` and the page it writes embeds the renderer. Do not start it before both releases are published and the floors are bumped.

**Files:**

- Modify: `pkdb_models/models/glimepiride/panels.py:380-498`, `pkdb_models/models/glimepiride/__init__.py:94-102`
- Test: `tests/models/test_panels.py`

**Interfaces:**

- Consumes: `panels_from_figure` of Task 4, `AppFigure`, `AppPage.figure`, `AppPage.shown` of Task 3; the committed `models/output/models/glimepiride_body_body.svg` and the sidecar beside it.
- Produces: `PANELS` with the generated groups beside the four declared panels, and `APP` with the figure.

- [ ] **Step 1: Write the failing test**

```python
def test_the_glimepiride_app_declares_its_figure() -> None:
    app = get_model("glimepiride").app
    assert app.figure is not None
    assert app.figure.panels["li/sub:gli"]
    page = app.pages[0]
    assert page.figure is True
    assert page.shown == ("glimepiride", "m1", "m2", "urine")
```

- [ ] **Step 2: Run it and see it fail**

Run: `uv run pytest tests/models/test_panels.py -k figure --models glimepiride`

- [ ] **Step 3: Declare it in `panels.py` and `__init__.py`**

`panels.py` reads the sidecar beside the committed anatomical SVG at import, calls `panels_from_figure` with `SIMULATION` and merges the generated panels into `PANELS`; the page lists them and keeps the four of today as `shown`; `__init__.py` passes the figure to `App`.

- [ ] **Step 4: Run the model suite and rebuild the outputs**

Run: `uv run pytest tests/models/test_panels.py tests/models/test_web_app.py --models glimepiride`
Then rebuild the app page and the compiled models with the factory, and run the suite again, which compares the rebuild with the package.

- [ ] **Step 5: Commit**

```bash
git add pkdb_models/models/glimepiride tests/models/test_panels.py
git commit -m "The glimepiride app is its figure"
```
