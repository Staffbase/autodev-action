import {createViteLicensePlugin} from 'rollup-license-plugin'
import {defineConfig} from 'vitest/config'

export default defineConfig({
  plugins: [
    createViteLicensePlugin({
      replenishDefaultLicenseTexts: true,
      outputFilename: 'LICENSES.json'
    })
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
