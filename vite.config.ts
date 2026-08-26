import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'node:path';

export default defineConfig({
  root: path.resolve('web'),
  plugins: [vue()],
  server: {
    host: '127.0.0.1',
    port: 32001,
    proxy: {
      '/api': 'http://127.0.0.1:32000',
    },
  },
});
