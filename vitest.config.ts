import {defineConfig} from 'vitest/config'

export default defineConfig({
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
