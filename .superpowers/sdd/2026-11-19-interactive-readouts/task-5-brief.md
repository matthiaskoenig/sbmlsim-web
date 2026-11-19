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

