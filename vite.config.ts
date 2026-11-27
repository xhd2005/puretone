import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';
import { legacyWebViewCssPlugin } from './scripts/legacyWebViewCssPlugin';

export default defineConfig({
  plugins: [vue(), tailwindcss(), legacyWebViewCssPlugin()],
  define: {
    'process.env.platform': JSON.stringify('lite'),
    'process.env.KUGOU_API_DEV': JSON.stringify('EchoMusic'),
  },
  resolve: {
    alias: [
      { find: '@', replacement: resolve(__dirname, 'src') },
      { find: '@kugou', replacement: resolve(__dirname, 'server') },
      { find: /^axios$/, replacement: resolve(__dirname, 'src/services/kugou/axiosShim.ts') },
      { find: 'crypto', replacement: resolve(__dirname, 'src/polyfills/nodeCryptoShim.ts') },
      { find: 'zlib', replacement: resolve(__dirname, 'src/polyfills/nodeZlibShim.ts') },
      { find: 'net', replacement: resolve(__dirname, 'src/polyfills/nodeNetShim.ts') },
      { find: 'url', replacement: resolve(__dirname, 'src/polyfills/nodeUrlShim.ts') },
      { find: 'buffer', replacement: 'buffer' },
    ],
  },
  optimizeDeps: {
    include: ['buffer', 'crypto-js', 'node-forge', 'pako', 'big-integer', 'qrcode'],
  },
  build: {
    outDir: 'dist',
    target: ['es2020', 'chrome80'],
    cssTarget: 'chrome80',
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
