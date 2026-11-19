---
title: Glimepiride
description: The whole-body PBPK model of glimepiride as an app of interactive panels, simulated in the browser of the reader on sbmlsim-core.
hide:
  - navigation
  - toc
---

# Glimepiride: a model app without a server

The whole-body PBPK model of glimepiride and its metabolites M1 and M2 as an app of interactive panels. Move a knob or load an example patient and the four curves follow, each with the band of the uncertainty of the fit of the model, and the table under them states the pharmacokinetic parameters of those very curves with the spread of the same draws. Every simulation runs in your browser, on [sbmlsim-core](https://matthiaskoenig.github.io/sbmlsim-core/) in a pool of Web Workers over the cores of your machine: this page is static files and talks to no simulation server.

<sbmlsim-app endpoint="local:glimepiride" model="glimepiride" heading-level="2"></sbmlsim-app>

<script type="module" src="glimepiride/register.mjs"></script>

<link rel="stylesheet" href="glimepiride/nca.css" />

<section id="pk-parameters" aria-labelledby="pk-head">
  <div class="pk-top">
    <div class="pk-titles">
      <h2 class="pk-head" id="pk-head">Pharmacokinetic parameters</h2>
      <p class="pk-lead">Of the simulated plasma curves above, computed in this page by the kernel of <a href="https://matthiaskoenig.github.io/pkpdutils/">pkpdutils</a>.</p>
    </div>
  </div>
  <table></table>
  <p class="pk-note"></p>
</section>

<script type="module" src="glimepiride/nca.mjs"></script>

[Open the app on a page of its own](glimepiride/app.html){ .md-button }

## The model

![The whole-body PBPK model of glimepiride](glimepiride/glimepiride_model.png){ align=right width=300 }

**A)** Whole-body PBPK model illustrating glimepiride (GLI) administration, its systemic circulation via venous and arterial blood, and the key organs (liver, kidney, GI tract) involved in GLI metabolism, distribution, and excretion.

**B)** Intestinal model showing dissolution and absorption of GLI by enterocytes. No enterohepatic circulation of M1 and M2 is assumed, but reverse transport via enterocytes is included.

**C)** Hepatic model depicting CYP2C9-mediated metabolism of GLI to M1 and M2.

**D)** Renal model highlighting the elimination of M1 and M2 via urine; unchanged GLI is not excreted renally.

**E)** Key factors influencing glimepiride disposition accounted for by the model: administered dose, bodyweight, renal impairment, liver function (cirrhosis), and CYP2C9 genotypes.

The model is the male build of the glimepiride model of [pkdb_models](https://github.com/matthiaskoenig/pkdb_models), and the app is its declaration: the four panels and their six knobs are an annotation of its SBML, the page and its twelve example patients the `App` of its project. The knobs without a target of their own (the creatinine clearance and the activities of the two CYP2C9 alleles) set the renal function and the hepatic CYP2C9 activity of the model through formulas the panels declare.

## How it is built

The app is the same app the sbmlsim service serves (`python -m sbmlsim.serve --model glimepiride=pkdb_models.models.glimepiride:MODEL`), with the service replaced by files and a function of the page:

1. **The bundle.** `python -m sbmlsim.serve --model glimepiride=... --export DIR` writes everything the service answers without simulating into `bundle/bundle.json` (the contract `panelbundle/1`): the app, the declarations of the panels and their study data, exactly as the routes answer them, and per panel the recipe of a run (the targets and unit factors of the knobs, the factors of the curves, the output times in the unit of the axis, the tolerances of the project). The formulas of the derived targets are compiled into the SBML as initial assignments over a parameter per knob, so nothing of the model is evaluated in JavaScript.
2. **The compiled model.** [sbmlsim-core](https://matthiaskoenig.github.io/sbmlsim-core/) compiles that SBML into `model.wasm` (92 kB) with its description `model.json`; its engine `engine.wasm` (CVODE with the sparse solver KLU, 660 kB) runs it.
3. **The endpoint inside the page.** `register.mjs` registers a function of the page as the endpoint `local:glimepiride` ([an endpoint inside the page](../endpoints.md#an-endpoint-inside-the-page)), and the app is one element, `<sbmlsim-app endpoint="local:glimepiride" model="glimepiride">`.

The module which registers it is all the code the app needs:

```js
import { createPanelEndpoint } from './sbmlsim-core/panels.mjs'

sbmlsimWeb.registerEndpoint(
  'local:glimepiride',
  createPanelEndpoint({ bundle: new URL('./bundle/bundle.json', import.meta.url) }),
)
```

The elements send their requests to the function instead of the network; it answers them from the bundle and runs every point of a grid as a simulation on the pool of workers. The four panels of the page share one simulation, so a state of the knobs costs one scan, a few milliseconds per point.

The curves agree with the answers of the sbmlsim service, which simulates the same panels with roadrunner, to 1e-11 of their peak. The assets are written by `scripts/glimepiride.sh` of this repository from checkouts of sbmlsim, sbmlsim-core and pkdb_models (`SOURCES.json` names their commits).

## The parameters

The table under the app is a second reader of the same curves. A panel says with `sbmlsim-shown` whenever what it draws changed - the answer of a run, and a movement of the dose, which the grid of the run already covers and which simulates nothing - and hands the figure out with `drawn()`, one curve per id at the position of the knobs. The module `nca.mjs` of the example sends it to the kernel of [pkpdutils](https://matthiaskoenig.github.io/pkpdutils/), [`pkpdutils-core`](https://www.npmjs.com/package/pkpdutils-core) on npm, which is the non-compartmental analysis of that library as a WebAssembly module of 900 kB: a request of the times, the values, the dose and the units in, the columns of the result out. It runs next to the simulation which produced the curve, in the same page and without a server, and a curve of 501 points costs well under a millisecond.

The dose of the knob is in mg and the curves carry a molar concentration, so the dose travels into the analysis as an amount of substance over the molar mass of the model (`Mr_gli`, 490.616 g/mol) and the clearance comes back in l/h; the concentration is sent as `µmol/l`, which is what `µM` of the model is. CL/F and V~z~/F are of glimepiride alone, since a metabolite carries no dose of its own.

The three rows under the rule are what the analysis stood on. A whole-body model keeps a slowly decaying terminal phase at the end of the simulated window, so the regression of the terminal slope sits on that tail: it covers about one half-life rather than the two a study would ask for, and a fifth to two fifths of the area to infinity is extrapolated. The half-life of such a window is the apparent one of the simulation and not the 5 to 8 h of the literature, which a window of 24 h of measurements gives; the table says which window it used, so both numbers can be read for what they are.

## The uncertainty of the fit

The ten parameters of the model which were fitted are known to a distribution and not to a number, and the SBML of the model carries those distributions (the `distrib` package, written from the records of the adopted fit). The panels declare a sample of them, so every curve of this page is drawn with the band of its draws - the 5th to the 95th percentile of the draws at every output time - and the draws field of the settings above the panels says how many draws a reader wants: the sample holds 64, a request runs the first 16 of them. That field is the one control of the number: the table analyses the very draws the figures shade, so it follows the number the panels ran with and has no field of its own. Every cell carries the standard deviation of its draws and their coefficient of variation, the standard deviation over their mean.

The draws are the uncertainty of the fit and no variability of a population: every draw is the patient of the knobs, with the parameters of one draw of that fit, so a band is what the data the model was fitted to leaves open about this patient and not what two patients would differ by.

The parameters of a shaded curve are a distribution of their own, which no band of a figure states: the 95th percentile of a concentration at every time is the curve of no draw, so its area is the area of no draw either. The page therefore asks the endpoint for the curves of the draws themselves - which travel for a request of one point, where their size is bounded - analyses all of them in one batch of the kernel and reduces that table to the statistics of every parameter with `summarize` of the same kernel, so no statistic is computed in this page. The cell then carries the value of the model, the standard deviation of the draws and the box of their spread against their own median, one axis for the whole table.

The two phases are what a reader sees: the curve the panel just drew is analysed at once, and the draws of that position follow a moment later. A movement of the dose costs no simulation of the panels, since the grid of their run covers it, but it does cost the runs of the draws, which are of the position itself; the page asks for them once the knobs come to rest.

## Reference

**A Digital Twin of Glimepiride for Personalized and Stratified Diabetes Treatment.** Michelle Elias, Matthias König (2025). Preprints 2025, 2025061264 (preprint). [doi:10.20944/preprints202506.1264.v1](https://doi.org/10.20944/preprints202506.1264.v1)

## Disclaimer

The software is provided **AS IS**, without warranty of any kind, express or implied, including but not limited to the warranties of merchantability, fitness for a particular purpose and noninfringement. In no event shall the authors or copyright holders be liable for any claim, damages or other liability, whether in an action of contract, tort or otherwise, arising from, out of or in connection with the software or the use or other dealings in the software.

This software is a **research proof-of-principle** and not fit for any clinical application. It is not intended to diagnose, treat, or inform medication dosing decisions. Always consult with qualified healthcare professionals for medical advice and treatment planning.

The model is licensed under CC BY-SA 4.0 and the source code under MIT; `engine.wasm` contains SUNDIALS (BSD-3-Clause) and KLU (LGPL-2.1-or-later), whose [notices](glimepiride/sbmlsim-core/THIRD_PARTY.md) ship with it.
