import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

// The library is built three times: an ES module, which a bundler and a
// `<script type="module">` of a page read, a UMD bundle for a `require`, and an
// IIFE bundle for a page which wants the global `sbmlsimWeb` from one plain
// `<script src>`. The package is `"type": "module"`, so the UMD bundle is a
// `.cjs` file, which is what makes `require` of it work, and which a naive
// static server (a course platform, a file share) serves as
// `application/octet-stream`, which a browser refuses to run as a script; the
// IIFE bundle is a `.js` file for exactly that page. Vue is bundled into all of
// them, so a host page (the documentation, a slide deck, a course) needs
// nothing else.
//
// The build replaces what the esm-bundler build of vue leaves to its bundler:
// `process.env.NODE_ENV`, which no page defines and which a bundle that reads
// it throws a `ReferenceError` over, and the three feature flags of vue, which
// it warns about when they are not defined. They are replaced in the build
// alone, so the tests keep the development build of vue with its warnings.
//
// `test.css` is on because the styles of the element are part of what it is:
// `*.ce.vue` puts them in the shadow root, and a test which reads them out of
// it has to find them there.
export default defineConfig(({ command }) => ({
  plugins: [vue()],
  define:
    command === 'build'
      ? {
          'process.env.NODE_ENV': '"production"',
          __VUE_OPTIONS_API__: 'false',
          __VUE_PROD_DEVTOOLS__: 'false',
          __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
        }
      : {},
  build: {
    target: 'es2022',
    sourcemap: true,
    lib: {
      entry: 'src/index.ts',
      name: 'sbmlsimWeb',
      formats: ['es', 'umd', 'iife'],
      fileName: (format) => {
        switch (format) {
          case 'es':
            return 'sbmlsim-web.js'
          case 'iife':
            return 'sbmlsim-web.iife.js'
          default:
            return 'sbmlsim-web.umd.cjs'
        }
      },
    },
  },
  test: {
    environment: 'node',
    css: true,
    include: ['src/**/*.test.ts'],
  },
}))
