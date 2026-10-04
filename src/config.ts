// Single source of truth for branding. The name is pending a domain/trademark check,
// so nothing else in the codebase should hard-code it.
export const APP_NAME = 'Blitz PDF Editor';

// Undecided copy: kept as visible placeholders until final wording is chosen.
export const COPY = {
  headline: 'Open a PDF to get started',
  valueStatement: '[One-line value statement goes here]',
  privacyNote: '[Privacy note: your files stay on your device and are never uploaded]',
} as const;

export const APP_VERSION = __APP_VERSION__;

/**
 * Undecided: where "Help › Report a problem" should go (a mailto: or a web form URL).
 * The menu item stays disabled while this is empty.
 */
export const REPORT_PROBLEM_URL = '';
