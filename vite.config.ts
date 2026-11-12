import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

// The library is built twice: an ES module, which a bundler and a
// `<script type="module">` of a page read, and a UMD bundle for a `require` and
// for a page which wants the global. The package is `"type": "module"`, so the
// UMD bundle is a `.cjs` file, which is what makes `require` of it work. Vue is
// bundled into both, so a host page (the documentation, a slide deck, a course)
// needs nothing else.
export default defineConfig({
  plugins: [vue()],
  build: {
    target: 'es2022',
    sourcemap: true,
    lib: {
      entry: 'src/index.ts',
      name: 'sbmlsimWeb',
      formats: ['es', 'umd'],
      fileName: (format) => (format === 'es' ? 'sbmlsim-web.js' : 'sbmlsim-web.umd.cjs'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
