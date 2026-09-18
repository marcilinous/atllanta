// Reads the deployed version from /version.json (a static file served with
// no-store) so anyone can see which release they are running. Any problem
// yields an empty label rather than an error.
const SEMVER = /^\d+\.\d+\.\d+$/;

export async function loadVersionLabel(fetchImpl = fetch) {
  try {
    const resp = await fetchImpl('/version.json', { cache: 'no-store' });
    if (!resp.ok) return '';
    const { version } = await resp.json();
    return SEMVER.test(version || '') ? `Atllanta v${version}` : '';
  } catch {
    return '';
  }
}
