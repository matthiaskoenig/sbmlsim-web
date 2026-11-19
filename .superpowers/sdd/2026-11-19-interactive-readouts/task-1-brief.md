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

