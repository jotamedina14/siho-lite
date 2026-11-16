import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// En desarrollo: /api y /health van a la API local; /siho-docs-local va a RustFS (S3 local).
// changeOrigin=false conserva el Host para que la firma de la URL prefirmada siga siendo válida.
const proxy = {
  '/api': { target: 'http://localhost:3000' },
  '/health': { target: 'http://localhost:3000' },
  '/dev': { target: 'http://localhost:3000' },
  '/siho-docs-local': { target: 'http://localhost:9000', changeOrigin: false },
};

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy },
  preview: { port: 5173, proxy },
});
