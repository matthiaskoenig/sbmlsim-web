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
  const declaration = { ...sample, figure: { svg: '<svg/>', title: 'The model', credit: '', panels: { 'li/sub:gli': ['li_gli'] } } }
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

