// One build serves both deployments; only the private host exposes GPU speech.
export const WORKSTATION = location.hostname === 'pop-os.tailbd091c.ts.net';
export const API_ORIGIN = WORKSTATION ? 'https://pastetospeech.com' : '';
export const RELEASE = 'development';
export const BUILD_COMMIT = 'development';
export const KOKORO_ENABLED = true;

export const CLOUD_READER = false;

export const UNIFIED_CREDITS = false;

export const MSE_STAGING = false;

export const MSE_FIXTURE_VERSION = '';

export const MSE_ENABLED = false;

export const VIDEO_DOWNLOAD = false;

export const LONG_READINGS = false;

export const DOCUMENT_IMPORT = false;

export const SUMMARY_ENABLED = false;

export const FULL_AUDIO_PREFETCH = false;

export const SECTION_PROGRESS = false;

export const OCR_DURABLE_JOBS = false;

export const STAGING_READER_LAYOUT = false;

export const OCR_PICKER_AUTOSCAN = false;

export const INPUT_QUEUE_UI = false;

// Staging-only wording and queue placement trial.
export const INPUT_QUEUE_REFINEMENTS = false;

export const SPEECH_SECTION_RECOVERY = false;

// Staging-only local plain-text import trial.
export const LOCAL_TEXT_IMPORT = false;

// Device audio persistence is an explicit staging trial.
export const PERSISTENT_AUDIO = false;

export const MATH_SPEECH_PREVIEW=false;
export const TRANSLATION_UI = false;
