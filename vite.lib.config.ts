import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  publicDir: false,
  build: {
    // Own out dir: the app build (vite.config.ts → dist/) empties its outDir,
    // which used to destroy the library output on every verify/build.
    outDir: 'dist-lib',
    lib: {
      entry: 'src/framewise-lite/index.ts',
      name: 'FramewiseLite',
      fileName: 'framewise-lite',
      formats: ['es'],
    },
    rollupOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime'],
    },
  },
});
