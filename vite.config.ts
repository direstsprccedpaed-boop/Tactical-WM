import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  assetsInclude: [
    '**/*.pbf',
    '**/*.pmtiles',
    '**/*.woff2',
    '**/*.png',
    '**/*.svg',
    '**/*.webp',
  ],
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    cssCodeSplit: true,
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          maplibre: ['maplibre-gl'],
          parsing: ['fast-xml-parser'],
          storage: ['dexie', 'zustand'],
        },
      },
    },
  },
  worker: {
    format: 'es',
  },
});
