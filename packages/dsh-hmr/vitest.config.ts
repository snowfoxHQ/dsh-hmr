import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // The first test spawns Python and loads the embedding model.
    testTimeout: 240_000,
    hookTimeout: 240_000,
    fileParallelism: false,
  },
});
