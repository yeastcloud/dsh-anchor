import { defineConfig } from 'vitest/config'

/**
 * Local vitest config: without it, `vitest run` inside this package walks up to
 * the deepseek-harness repository config, whose projects only match
 * `packages/<group>/<pkg>/tests`, so this package's own specs are never found.
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    environment: 'node',
  },
})
