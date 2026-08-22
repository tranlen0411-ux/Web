import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 4174,
    strictPort: true,
    cors: true,
    headers: {
      'X-Content-Type-Options': 'nosniff',
    },
  },
  preview: {
    port: 4174,
    strictPort: true,
    cors: true,
  },
});
