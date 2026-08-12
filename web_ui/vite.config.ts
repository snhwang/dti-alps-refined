import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5174,
    proxy: {
      '/sessions': 'http://localhost:8001',
      '/status': 'http://localhost:8001',
      '/process_dti': 'http://localhost:8001',
      '/process_dti_local': 'http://localhost:8001',
      '/files': 'http://localhost:8001',
      '/get_anatomic_image': 'http://localhost:8001',
      '/browse_files': 'http://localhost:8001',
      '/batch': 'http://localhost:8001',
    }
  }
})
