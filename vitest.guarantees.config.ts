import { defineConfig } from 'vitest/config';

const criticalGuaranteeFiles = [
  'src/guarantees/index.ts',
  'src/scenes/runner.ts',
  'src/scenes/schema.ts',
  'src/scenes/planner.ts',
  'src/scenes/device-matrix.ts',
  'src/scenes/evidence.ts',
  'src/scenes/artifacts.ts',
  'src/scenes/base-url.ts',
  'src/scenes/builtin-plugins.ts',
  'src/scenes/visual-audit-fixtures.ts',
];

export default defineConfig({
  test: {
    include: [
      'tests/unit/guarantees/guarantee-journey-inventory.test.ts',
      'tests/unit/guarantees/guarantees-*.test.ts',
      'tests/unit/scenes/scenes-*.test.ts',
    ],
    testTimeout: 60_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: 'coverage-guarantees',
      include: criticalGuaranteeFiles,
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 90,
        statements: 90,
      },
    },
  },
});
