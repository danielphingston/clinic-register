/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

interface ImportMetaEnv {
  readonly VITE_GOOGLE_CLIENT_ID: string
  // Overrides for the Drive REST bases; only set to point at scripts/mock-drive.mjs.
  readonly VITE_DRIVE_API_BASE?: string
  readonly VITE_DRIVE_UPLOAD_BASE?: string
}
