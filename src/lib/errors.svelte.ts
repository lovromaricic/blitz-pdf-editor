// Last-resort error reporting: anything not handled elsewhere is shown to the
// person instead of failing silently. Nothing is sent anywhere.
import { friendlyError } from './friendly-error';

export const appError = $state({ message: null as string | null });

export function installGlobalErrorHandlers() {
  const show = (e: unknown) => {
    // Cancelled PDF.js renders are routine, not errors.
    if (e && typeof e === 'object' && 'name' in e && (e as Error).name === 'RenderingCancelledException') return;
    appError.message = friendlyError(e);
    console.error(e);
  };
  window.addEventListener('error', (e) => show(e.error ?? e.message));
  window.addEventListener('unhandledrejection', (e) => show(e.reason));
}
