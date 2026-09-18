// One build serves both deployments; only the private host exposes GPU speech.
export const WORKSTATION = location.hostname === 'pop-os.tailbd091c.ts.net';
export const API_ORIGIN = WORKSTATION ? 'https://speak.rogerpbrown.com' : '';
export const RELEASE = 'development';
export const KOKORO_ENABLED = true;
