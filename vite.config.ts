import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

// The library is built twice: an ES module for a bundler and an IIFE for a
// plain `<script>` of a page. Vue is bundled into both, so a host page (the
// documentation, a slide deck, a course) needs nothing but the one file.
export default defineConfig({
  plugins: [vue()],
  build: {
    target: 'es2022',
    sourcemap: true,
    lib: {
      entry: 'src/index.ts',
      name: 'sbmlsimWeb',
      formats: ['es', 'iife'],
      fileName: (format) => (format === 'es' ? 'sbmlsim-web.js' : `sbmlsim-web.${format}.js`),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
