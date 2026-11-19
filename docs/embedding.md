# Embedding

A panel is one script and one tag, so it goes wherever a page can carry them. The hosts below are the ones the end to end tests of the library drive (`demo/` of the repository): a documentation site, a slide deck and a plain page of a course platform.

## Zensical and MkDocs Material

The script is loaded once for the whole site and the element is a raw HTML block of a markdown page:

```toml
# zensical.toml
[project]
extra_javascript = ["https://cdn.jsdelivr.net/npm/sbmlsim-web@0.4.0/dist/sbmlsim-web.iife.js"]
# optional: the panels take the colours of the palette
extra_css = ["stylesheets/sbmlsim.css"]
```

```markdown
<sbmlsim-panel endpoint="https://models.example.org" model="hctz" panel="renal_plasma" auto></sbmlsim-panel>
```

MkDocs with the Material theme takes the same `extra_javascript` and `extra_css` in its `mkdocs.yml`. The element starts itself (`auto`), also on a page the site swaps in without a reload (`navigation.instant`), where an inline `<script>` which calls `activate()` would run once at most. A page which registers an endpoint inside the page from a script of its own needs a full load of the page, so a site of such pages keeps instant navigation off, as this one does.

The palettes of the theme declare their colour scheme (`slate` is dark) and a panel takes the scheme of the page it is on, so it is light on the light palette and dark on the dark one whatever the system of the reader is. A stylesheet maps the colours of the palette onto the tokens of the elements; this site uses:

```css
/* docs/stylesheets/sbmlsim.css */
sbmlsim-panel,
sbmlsim-app {
  --sbmlsim-bg: var(--md-default-bg-color);
  --sbmlsim-font: var(--md-text-font-family);
}
```

## reveal.js

A deck has every slide in the page, so it starts a panel when its slide is shown and freezes it when the slide is left, which keeps one panel at a time talking to the endpoint; a panel the deck passed over while it loaded finishes when its slide is shown again. `data-prevent-swipe` keeps a drag on a knob from turning the slide, and the element keeps the arrow keys of a knob and of the readout to itself.

```html
<section>
  <sbmlsim-panel
    endpoint="https://models.example.org"
    model="hctz"
    panel="dose_plasma"
    data-prevent-swipe
  ></sbmlsim-panel>
</section>
<script src="https://cdn.jsdelivr.net/npm/sbmlsim-web@0.4.0/dist/sbmlsim-web.iife.js"></script>
<script>
  const deck = new Reveal()
  const start = (slide) => {
    for (const panel of document.querySelectorAll('sbmlsim-panel')) {
      if (slide.contains(panel)) void panel.activate()
      else panel.freeze()
    }
  }
  deck.on('slidechanged', (event) => start(event.currentSlide))
  deck.initialize().then(() => start(deck.getCurrentSlide()))
</script>
```

A dark theme of reveal.js paints dark and declares no scheme, so the deck says it is dark, and a slide is scaled, so the fonts of a panel are set for it:

```css
.reveal {
  color-scheme: dark;
  --sbmlsim-bg: var(--r-background-color);
  --sbmlsim-font-size: 16px; /* every length of a panel follows its two font sizes */
  --sbmlsim-font-size-small: 14px;
}
```

## Moodle and plain pages

A plain page is one script tag and one element tag:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Hydrochlorothiazide in renal impairment</title>
    <script src="https://cdn.jsdelivr.net/npm/sbmlsim-web@0.4.0/dist/sbmlsim-web.iife.js"></script>
  </head>
  <body>
    <sbmlsim-panel
      endpoint="https://models.example.org"
      model="hctz"
      panel="renal_plasma"
      auto
    ></sbmlsim-panel>
  </body>
</html>
```

The editor of Moodle cleans what an author writes (HTMLPurifier): it removes a `<script>` and an element it does not know unless the author may post trusted content, which a site administrator grants (`moodle/site:trustcontent`). With trusted content the two tags go into the HTML source of a block (the `<>` button of the editor). Without it, the plain page is hosted elsewhere - a page the service serves with `--static`, or an HTML file uploaded to the course as a File resource - and the block embeds it:

```html
<iframe
  src="https://models.example.org/renal.html"
  title="Hydrochlorothiazide in renal impairment"
  style="width: 100%; height: 520px; border: 0"
  loading="lazy"
></iframe>
```

The IIFE bundle is a `.js` file, which a naive static server (a course platform, a file share) serves as a script, where it serves the `.cjs` of the UMD bundle as a download a browser refuses to run.

## Theming

The element has a shadow root, so the styles of the page cannot reach into it. The `--sbmlsim-*` tokens are the one hook from outside, and they work on the element and on anything above it: a documentation theme, the dark switch of a deck or a branded container which sets a token on a wrapper is what the panel takes. A rule which matches the element itself wins over everything, `theme="light"` and `theme="dark"` come next, then an ancestor, then the table of the design (`sbmlsim-web/theme.css`).

Every colour of the table is a pair resolved against the colour scheme of the page (`light-dark()`). The panel takes the scheme the page declares, light for a page which declares none, and not the one of the system of the reader; a page which follows the system says so (`color-scheme: light dark`). A panel and an app paint the surface of their scheme (`--sbmlsim-bg`), so their text is never read against a page of the other scheme, and every text colour of the table has 4.5:1 and every line 3:1 against every surface of its scheme.

| token                                                                                   | what it sets                                                                              |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `--sbmlsim-bg`                                                                          | the surface of a panel and an app                                                         |
| `--sbmlsim-bg-card`                                                                     | the surface of the boxes on it: the readout, the shared controls and the cards of an app  |
| `--sbmlsim-bg-soft`                                                                     | the soft surface of the design of the sbmlsim reports, for a page which loads `theme.css` |
| `--sbmlsim-figure-bg`                                                                   | the background of a figure, `transparent` (the surface of its panel)                      |
| `--sbmlsim-fg`, `--sbmlsim-fg-soft`                                                     | the text and the secondary text                                                           |
| `--sbmlsim-line`                                                                        | the separators and boxes                                                                  |
| `--sbmlsim-accent`                                                                      | the controls and the focus                                                                |
| `--sbmlsim-error`                                                                       | the line of a failure                                                                     |
| `--sbmlsim-ramp-1` to `--sbmlsim-ramp-6`                                                | the colour ramp of the curves and the colour bar (viridis)                                |
| `--sbmlsim-training`, `--sbmlsim-validation`, `--sbmlsim-outlier`, `--sbmlsim-excluded` | the kinds of the data                                                                     |
| `--sbmlsim-font`, `--sbmlsim-font-mono`                                                 | the type of the text and of the numbers                                                   |
| `--sbmlsim-font-size`, `--sbmlsim-font-size-small`                                      | the two font sizes, which every length of a panel follows (12 px, 11 px)                  |
| `--sbmlsim-axis-width`, `--sbmlsim-curve-width`, `--sbmlsim-data-width`                 | the strokes of the axes, the curves and the data                                          |
| `--sbmlsim-radius`, `--sbmlsim-shadow`                                                  | the corners and the shadow of the readout and the cards of an app                         |

Every length of the layout of the shell and the panels is in px and none in `rem`, so it does not depend on the root font of the page, which a documentation theme sets to 125 %.
