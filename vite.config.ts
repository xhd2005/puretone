import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  define: {
    'process.env.platform': JSON.stringify('lite'),
    'process.env.KUGOU_API_DEV': JSON.stringify('EchoMusic'),
  },
  resolve: {
    alias: [
      { find: '@', replacement: resolve(__dirname, 'src') },
      { find: '@kugou', replacement: resolve(__dirname, 'server') },
      { find: 'crypto', replacement: resolve(__dirname, 'src/polyfills/nodeCryptoShim.ts') },
      { find: 'zlib', replacement: resolve(__dirname, 'src/polyfills/nodeZlibShim.ts') },
      { find: 'net', replacement: resolve(__dirname, 'src/polyfills/nodeNetShim.ts') },
      { find: 'url', replacement: resolve(__dirname, 'src/polyfills/nodeUrlShim.ts') },
      { find: 'buffer', replacement: 'buffer' },
    ],
  },
  optimizeDeps: {
    include: ['buffer', 'crypto-js', 'node-forge', 'pako', 'big-integer', 'qrcode', 'axios'],
  },
  build: {
    outDir: 'dist',
    target: 'es2022',
    commonjsOptions: {
      include: [/node_modules/, /server[\\/]/],
      transformMixedEsModules: true,
    },
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['vue', 'vue-router', 'pinia'],
          crypto: ['crypto-js', 'node-forge', 'pako', 'big-integer', 'buffer'],
        },
      },
    },
  },
  server: {
    port: 5173,
    host: true,
  },
});
