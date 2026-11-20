import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { examplesPlugin } from './build/examples-plugin.ts';

export default defineConfig({
  base: '/idf-viewer/',
  plugins: [react(), examplesPlugin()],
  worker: { format: 'es' },
  build: { target: 'es2022', sourcemap: true },
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    environment: 'node',
  },
});
