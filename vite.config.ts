/// <reference types="vitest" />
import path from 'path'
import license from 'rollup-plugin-license'
import {defineConfig} from 'vitest/config'

export default defineConfig({
  plugins: [],
  build: {
    target: 'esnext',
    minify: true,
    sourcemap: true,
    lib: {
      entry: 'src/index.ts',
      name: '@Staffbase/AutoDev',
      fileName: 'staffbase-autodev',
      formats: ['es']
    },
    rollupOptions: {
      plugins: [
        license({
          sourcemap: true,
          cwd: process.cwd(), // The default

          banner: {
            commentStyle: 'regular', // The default

            content: {
              file: path.join(__dirname, 'LICENSE'),
              encoding: 'utf-8' // Default is utf-8
            }
          },

          thirdParty: {
            multipleVersions: true,
            output: {
              file: path.join(__dirname, 'dist', 'license.txt'),
              encoding: 'utf-8' // Default is utf-8.
            }
          }
        })
      ]
    }
  },
  test: {
    globals: false,
    setupFiles: ['./test/setup.ts'],
    restoreMocks: true,
    coverage: {
      reporter: ['lcov']
    },
    includeSource: ['./src/**/*.ts']
  }
})
