export const MARKET_SCOPE = '@ffff2004-dsh-packages/';
export const CACHE_POLICY = 'ffff2004-package-tags-only-v1';

// SemVer 2.0: no leading zeroes in numeric components or numeric prerelease identifiers.
// Kept dependency-free so CI can validate before installing this repository's dev tools.
const numeric = '(?:0|[1-9][0-9]*)';
const prerelease = `(?:${numeric}|[0-9]*[A-Za-z-][0-9A-Za-z-]*)`;
const exactSemver = new RegExp(`^${numeric}\\.${numeric}\\.${numeric}(?:-${prerelease}(?:\\.${prerelease})*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$`, 'u');
const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
const packageName = '[a-z0-9][a-z0-9._-]*';
const packageNamePattern = new RegExp(`^${packageName}$`, 'u');
const releaseTagPattern = new RegExp(`^(${escapeRegExp(MARKET_SCOPE)}${packageName})@([^@]+)$`, 'u');

/** True only for a package name in the market scope, without tag or subpath. */
export function isMarketPackageName(name) {
  return typeof name === 'string' && name.startsWith(MARKET_SCOPE)
    && packageNamePattern.test(name.slice(MARKET_SCOPE.length));
}

/** Only canonical, fully scoped package release tags; never unified or HEAD refs. */
export function parseReleaseTag(tag) {
  if (typeof tag !== 'string') return undefined;
  const match = releaseTagPattern.exec(tag);
  if (!match) return undefined;
  const [, name, version] = match;
  return exactSemver.test(version) ? { name, version } : undefined;
}
