import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  build: {
    // Three.js accounts for most of the bundle (~155 kB gzipped).
    chunkSizeWarningLimit: 800,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
