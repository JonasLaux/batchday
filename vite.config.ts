import { defineConfig } from 'vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  server: { host: '127.0.0.1', strictPort: true },
  preview: { host: '127.0.0.1' },
  plugins: [tanstackStart(), viteReact()],
})

export default config
