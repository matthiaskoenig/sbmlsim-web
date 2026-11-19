# The uncertainty of a panel, and the glimepiride dashboard

**Status.** Design, for approval. The work spans four repositories and is cut into five pull requests, each of which stands alone.

## Why

The glimepiride example draws four curves of one patient and, since [sbmlsim-web#5](https://github.com/matthiaskoenig/sbmlsim-web/pull/5), the pharmacokinetic parameters of those curves, computed in the page by the kernel of pkpdutils. Every number of it is a point estimate, which is the one thing a model of a fit is not: the ten parameters the fit estimated are known to a profile likelihood, and a reader who sees `Cmax 0.551 µmol/l` cannot tell whether the model says 0.55 or "somewhere between 0.45 and 0.68". The dashboard should show what is known and how well.

The material is in the model and needs no invention. Every fitted parameter of `glimepiride_body_flat.xml` carries a `distrib:uncertainty` of the fit `PK_20261031_024416__3c43d`: the 95 % confidence interval of the profile likelihood, the standard error of the Fisher information, and the log-normal of the draws (`lognormal(mu, sigma, lower, upper)`), which is what a Monte Carlo samples. sbmlsim reads those formulas already (`sbmlsim.simulation.sampling.model_distributions.parameter_distributions`) and draws a Latin hypercube from them (`uncertainty_dimension`), and its own figures reduce a dimension of draws to a band (`sbmlsim.plot.points`). Nothing of that reaches the panels.

## Goals

- A band around every curve of a panel: the 5th to 95th percentile over the draws of the fit's parameter uncertainty, at the position the knobs stand at, and it moves with the knobs as the line does.
- The parameter table carries the spread: per parameter the mean, the SD and the number of draws, next to the value of the nominal parameters.
- The distribution of every parameter is drawn, one small box per analyte and parameter (median, quartiles, the 5-95 % whiskers, the nominal value marked), so a reader sees a skew the SD hides.
- **The reader sets the number of draws** on the page, and the figures, the table and the boxes follow it together: the cost of the uncertainty and the smoothness of the band are the reader's to trade.
- One page which holds all of it without scrolling on a desktop screen: the knobs once, four compact panels, the table and the boxes.
- The uncertainty is a feature of a panel, declared by the model and computed by whichever engine answers the panel, so the deployed app (the python service) and the example (sbmlsim-core in the browser) show the same band.

## Non-goals

- **Population variability.** The band is the uncertainty of the fit's parameters, not the spread of a population of patients: body weight, renal function and CYP2C9 activity stay where the reader puts them. Drawing patients would need distributions nobody has pinned, and mixing the two in one band would make both unreadable. The page says in one line what the band is.
- **Correlations of the fit.** The SBML carries the marginal of every parameter and no covariance, so the draws are independent. That is stated on the page; a correlated draw is a later change of the model's uncertainty record, not of this contract (`sbmlsim.simulation.sampling.uncertainty_dimension` already takes a correlation).
- The pharmacodynamics, the other pages of the app, and any uncertainty of the model structure.

## Anti-goals

- A band whose numbers and the table's numbers come from different samples. One sample of parameter vectors feeds the figure, the table and the boxes; a reader must be able to point at the band and find that draw in the box.
- A band which lags the line. If the line moves with a knob and the band follows a moment later, the figure is wrong in between, which is worse than no band.
- A page-only trick. The uncertainty belongs to the model and to the panel contract; an example which computes it beside the components would teach the wrong thing and leave the deployed app without it.

## Constraints

- `pkdb_models` declares the panels as data (`models/glimepiride/panels.py`, `sbmlsim.panel`), the factory writes them into the SBML of the male build, and `sbmlsim --export` writes the bundle the example carries. The bundle is the only source of a declaration: `panels.mjs` has no option to pass one.
- `scripts/prepare_model.py` of sbmlsim-core strips `distrib` before it compiles, so the compiled model carries no uncertainty. Whatever the engines draw has to travel in the declaration.
- The ten parameters are all present in the compiled model and are settable through `preinit`, which is how a knob with a `parameter` entry already works.
- Measured on this machine, one run of the model (501 points, 50 h) costs **3.8 ms** in node on one instance. 32 draws over the nine dose points of the grid are 288 runs, about 1.1 s serial and under 0.2 s on a pool of eight workers. The cost of the feature is the answer, not the arithmetic.
- `AppPage.size` is already `regular | small` in sbmlsim and sbmlsim-web renders a page of small panels in columns of 280 px. The compaction is a declaration, not a layout feature.
- Every answer of a panel is JSON. 32 draws of four curves of 501 points at one position are about 1 MB; the same over nine grid points would be 15 MB, which decides the shape below.

## Approaches

**(1) The engines answer the draws, the client reduces them.** The request may ask for the uncertainty; the answer carries, per curve and per grid point, the band, and - for a request without a grid, where the cost is bounded - the curve of every draw. The statistics live where the figure and the table are, so one quantile rule is implemented once, in sbmlsim-web, and the engines only run simulations. **Chosen.**

**(2) The engines answer the statistics only.** Smaller answers, but the per-draw parameters of the table are then unreachable, or the panel contract grows a parameter table of its own and the kernel of pkpdutils moves into the service. Rejected: it makes the contract carry an analysis.

**(3) The page computes everything beside the components.** What the example could do today in thirty lines, and what the question of this design asked about: rejected as the end state, because the deployed app gains nothing and the band stays a trick of one page. It survives as a step: the example may run the draws in its own endpoint wrapper until the engines implement the contract (see the order below), which de-risks the contract before two engines carry it.

## The contract

A declaration says that a panel has an uncertainty and how much of it to draw; the recipe of the bundle carries the sample; a request asks for it; an answer carries it.

```
# sbmlsim.panel, the declaration of a panel
PanelSimulation.uncertainty: PanelUncertainty | None = None
PanelUncertainty = {draws: int = 32, max_draws: int = 64, level: float = 0.9, seed: int = 0}

# the run recipe of the bundle (sbmlsim.serve.export), written at export time
run.uncertainty = {
  "fit": "PK_20261031_024416__3c43d",     # the uncertainty record the draws come from
  "level": 0.9,                            # the band the client draws
  "parameters": ["Kp_gli", "ftissue_gli", ...],   # the ids, in order
  "draws": [[0.61, 5.9, ...], ...],        # max_draws vectors, a Latin hypercube, seeded
  "default_draws": 32,                     # what a request without a number asks for
}

# the request of a simulation (POST .../simulate)
{"values": {...}, "grid": {...}, "variant": null, "uncertainty": {"draws": 16}}

# the answer (panel/1), next to x, curves, units, provenance, status
"uncertainty": {
  "draws": 32, "fit": "...", "level": 0.9,
  "band": {"Carm_gli": [[[low...], [high...]], ...]},   # per grid point, in the order of the grid
  "curves": {"Carm_gli": [[values...], ...]}            # per draw, only for a request without a grid
}
```

The sample travels as numbers and is drawn once, at export, by the half of sbmlsim which already knows how (`parameter_distributions` and `uncertainty_dimension`). No engine draws anything, no random number generator has to agree across two languages, and the band of a release is reproducible: the draws are part of the asset.

**A number of draws is a prefix of that sample.** The recipe carries `max_draws` vectors and a request for `n` of them means the first `n`, which is what lets a reader turn the number up and down: a column of a Latin hypercube is a random permutation of its strata, so the first `n` rows are `n` of the `max_draws` strata drawn without replacement, a sample whose marginals are spread as evenly as a sample of that size can be. The band therefore settles as the number grows instead of jumping to another sample at every step, every run of a draw is the same run whatever `n` is, so a cache keyed by the draw serves 16 and 32 alike, and 32 draws cost sixteen new runs after 16. A request above `max_draws`, like an unknown knob, is a 422.

The band is the 5th and the 95th percentile over the draws, by the linear interpolation of the order statistics, computed by the client. A draw which fails is dropped from the percentiles of its grid point and counted in `status`.

## What the dashboard is

The page of the app becomes `size="small"`: the four panels side by side in one row on a desktop screen, each with its band, the six knobs once above them, and the scenarios where they are. The number of draws is one control of the card below, and the elements take it as the attribute `draws`, which the app passes to its panels: one control governs the whole page, the library gains no user interface of its own, and a later app puts its control wherever it wants it. The subtitles lose the sentence they all repeat. Below them, in the card the parameter table lives in today, two columns: the table on the left, one row per parameter with the nominal value, the mean, the SD and `n`; the boxes on the right, one small panel per parameter with one box per analyte. The quality rows of the terminal phase stay under their rule.

The table and the boxes come from the per-draw curves of a request without a grid, analysed by `pkpdutils-core` as one batch of 32 samples (one call of the kernel, the sample dimension `draw`), and `summarize` gives the statistics. The nominal row stays what it is today, the analysis of the drawn curve.

## The order of the work

1. **sbmlsim-web**: `Series.band` in the plot layer, the panel asks for the uncertainty when its declaration has one and draws the band, `drawn()` carries it, the contract types. Nothing changes until an endpoint answers a band.
2. **sbmlsim-web, the example**: the dashboard - the compact layout, the table with the SD, the boxes - against the draws, which the endpoint of the example computes in its wrapper for as long as the engines do not. The product is visible here, and the contract is exercised by a real page before two engines implement it.
3. **sbmlsim**: the declaration, the sample at export, the band in the service, the tests and `docs/serve.md`.
4. **sbmlsim-core**: `panels.mjs` answers the uncertainty from the recipe, its fixture grows the field, the inline build is rebuilt.
5. **pkdb_models**: the panels declare the uncertainty, the page declares `size="small"`, the subtitles are shortened, the SBML of the male build is written again. Then the bundle of the example is regenerated from the three checkouts, the wrapper of step 2 is deleted, and `SOURCES.json` names the new commits.

Steps 3 and 4 reach the deployed app only through a release of sbmlsim and of sbmlsim-core, which is the maintainer's step and not part of this work.

The regeneration of the bundle in step 5 moves the example onto the current sbmlsim, which is what the two failing end to end tests of `main` are about (`e2e/contract.spec.ts`, `e2e/hosts.spec.ts`, pinned to sbmlsim 0.25.0 while the checkout is 0.29.0). Those two are fixed in step 5 with the regeneration, not before.

## What is left to the builder

- The sizes the control of the page offers: 8, 16, 32 and 64 is the design target, where 64 is `max_draws` of the sample and 32 the default of the declaration.
- Whether the boxes are drawn as SVG in the example's module or in a small module of their own next to it. They are the example's figures either way, not components of the library, until a second app wants them.
- The colour of a band: `style.ts` of sbmlsim-web owns it, and the obvious reading is the colour of its curve at a low opacity.
