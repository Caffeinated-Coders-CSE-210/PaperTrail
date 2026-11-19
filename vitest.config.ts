import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    environmentOptions: { jsdom: { url: 'https://papertrail.test' } },
    include: ['src/features/reader/**/*.test.tsx'],
    restoreMocks: true,
  },
})
