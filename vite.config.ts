import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const starOfficeTarget = (env.STAR_OFFICE_API_BASE || 'http://127.0.0.1:19000').replace(/\/$/, '');

  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api/star-office': {
          target: starOfficeTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/star-office/, ''),
        },
      },
    },
  }
})
