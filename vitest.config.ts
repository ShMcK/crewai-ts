import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true, // Allows using Vitest globals (describe, test, expect) without importing
    environment: 'node', // Or 'jsdom' if you're testing browser-like environments
    coverage: {
      provider: 'v8', // or 'istanbul'
      reporter: ['text', 'json', 'html'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: [
        'src/index.ts', // Often the main export file might not have direct testable logic
        'src/**/*.d.ts',
        'src/**/index.ts', // Barrel files might be excluded if they only re-export
      ],
    },
  },
}); 