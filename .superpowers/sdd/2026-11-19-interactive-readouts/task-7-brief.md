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

