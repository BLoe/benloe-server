import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The lineup optimizers run real Monte Carlo simulations, so a handful of
    // tests are genuinely slow by design.
    testTimeout: 60000,
    include: ['src/**/*.test.ts'],
  },
});
