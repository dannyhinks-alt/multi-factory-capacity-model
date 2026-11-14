/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build:offline` (mode=offline) inlines every JS/CSS asset into a single
// self-contained dist-offline/index.html with zero external CDNs.
export default defineConfig(({ mode }) => {
  const offline = mode === 'offline';
  return {
    base: './',
    plugins: offline ? [react(), viteSingleFile()] : [react()],
    build: {
      outDir: offline ? 'dist-offline' : 'dist',
      emptyOutDir: true,
      chunkSizeWarningLimit: 4000,
      // Single-file build has no preload links; drop the polyfill so the bundle makes zero network calls.
      modulePreload: offline ? { polyfill: false } : undefined,
    },
    test: {
      globals: true,
      environment: 'node',
      include: ['tests/**/*.test.ts'],
    },
  };
});
