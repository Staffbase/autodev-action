import {createViteLicensePlugin} from 'rollup-license-plugin'
import {externalizeDeps} from 'vite-plugin-externalize-deps'
import {defineConfig} from 'vitest/config'

export default defineConfig({
  plugins: [
    createViteLicensePlugin({
      replenishDefaultLicenseTexts: true,
      outputFilename: 'LICENSES.json'
    }),
    externalizeDeps()
  ],
  build: {
    target: 'esnext',
    minify: true,
    sourcemap: true,
    lib: {
      entry: 'src/index.ts',
      name: 'AutoDev',
      fileName: 'autodev-action',
      formats: ['es']
    }
  }
})
