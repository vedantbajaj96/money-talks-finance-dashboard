// Global window extensions used by the app.
// Keeps TypeScript happy during the Vite migration without touching every component file.

interface Window {
  showToast?: (msg: string) => void;
  MSStream?: unknown; // old iOS detection used in MapPopover
}
