import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// Run tests in the clinic's time zone (IST, UTC+5:30), where local and UTC
// dates differ between midnight and 05:30. Workers inherit this.
process.env.TZ = 'Asia/Kolkata'

// Separate from vite.config.ts so tests don't run the PWA plugin. The PWA
// virtual module is replaced with a stub.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      'virtual:pwa-register/react': fileURLToPath(new URL('./src/test/pwaRegisterStub.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // Tests must never depend on a real Google client ID.
    env: { VITE_GOOGLE_CLIENT_ID: '' },
  },
})
