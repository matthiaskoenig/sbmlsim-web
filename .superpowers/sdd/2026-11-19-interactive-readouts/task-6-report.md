# Task 6 report
Added AppFigure, AppPage.figure/shown and AppDeclaration.figure to src/contract.ts, all optional in the type (older payloads lack them, null means no figure). asApp in src/client.ts validates the shape when present (isFigure, isFigurePage) and accepts absent or null. AppFigure exported from src/index.ts. Fixture gained figure: null, page figure: false, shown: []. Tests: client.test.ts (absent, null, present, malformed), contract.test.ts (types, key comparison now also for a page). The brief's appOf is the client read (client.app) in this repo.
Evidence: npm test 468 passed; typecheck and eslint clean.
Deviation: brief types the fields as required; made optional per the lead's instruction.

## Fix round 1
- Tests pin figure [] and panels [] refused, missing title/credit, non-string panel id, blank svg; panels {} accepted; unknown ids accepted (documented in the AppFigure doc comment as not cross-validated by the client).
- Client now refuses empty or blank svg.
- Accessors figureOf, showsFigure, shownPanels in src/contract.ts, exported from index.ts, tested; raw payload keeps three states.
- Contract test loops every page and pins AppFigure keys with a typed figure.
- src/fixtures/contract.json is generated (UPDATE_CONTRACT_FIXTURE=1 npm run e2e -- contract) from the hctz example, which has no figure; I edited it by hand earlier and could not regenerate with a real figure, so the figure keys are pinned in contract.test.ts instead.
- Evidence: npm test 468 passed, typecheck and lint clean.

## Fix round 2
- isFigure refuses a blank title (empty and whitespace-only, both tested); the blank-svg refusal is unchanged.
- Correction: both ends refuse a blank drawing and a blank title; sbmlsim was tightened to match the client for svg (it did not refuse a blank svg before), the doc comment of AppFigure says so. The earlier statement of fix round 1 that the server already refused a blank svg was wrong.
- only() in client.test.ts throws a message naming the failure.
- Evidence: npm test 468 passed, typecheck and lint clean.
