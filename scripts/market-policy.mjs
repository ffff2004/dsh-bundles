export const MARKET_SCOPE = '@ffff2004-dsh-packages/';
export const CACHE_POLICY = 'ffff2004-package-tags-only-v1';

// SemVer 2.0: no leading zeroes in numeric components or numeric prerelease identifiers.
// Kept dependency-free so CI can validate before installing this repository's dev tools.
const numeric = '(?:0|[1-9][0-9]*)';
const prerelease = `(?:${numeric}|[0-9]*[A-Za-z-][0-9A-Za-z-]*)`;
const exactSemver = new RegExp(`^${numeric}\\.${numeric}\\.${numeric}(?:-${prerelease}(?:\\.${prerelease})*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$`, 'u');

/** Only canonical, fully scoped package release tags; never unified or HEAD refs. */
export function parseReleaseTag(tag) {
  if (typeof tag !== 'string') return undefined;
  const match = /^(@ffff2004-dsh-packages\/[a-z0-9][a-z0-9._-]*)@([^@]+)$/u.exec(tag);
  if (!match) return undefined;
  const [, name, version] = match;
  return exactSemver.test(version) ? { name, version } : undefined;
}
