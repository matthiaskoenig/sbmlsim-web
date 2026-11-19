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

