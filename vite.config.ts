/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Base must match the GitHub Pages project-site path (github.io/postcall/);
// otherwise the built asset URLs 404 once deployed.
export default defineConfig({
  base: '/postcall/',
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'node',
  },
})
