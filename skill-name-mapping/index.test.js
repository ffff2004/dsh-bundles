import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { apply, Config, createProvider, parseMappedSkill, resolveConfig, resolveRoots } from './index.js'

const document = (fields = '', body = '# Zotero\n\nUse ./scripts/query.js.', name = 'Zotero') => `---\nname: ${JSON.stringify(name)}\ndescription: Zotero library access\n${fields}---\n${body}\n`
const parse = text => parseMappedSkill(text, '/real/source/SKILL.md')
const configFor = root => ({ includeDefaultRoots: false, customSkillDirs: [root] })

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'skill-name-mapping-test-'))
  const confirmedRoot = resolve(root)
  assert.equal(root, confirmedRoot)
  assert.ok(isAbsolute(root))
  assert.ok(root.startsWith(`${resolve(tmpdir())}${sep}skill-name-mapping-test-`))
  const providers = []
  t.after(async () => {
    for (const provider of providers) provider.dispose()
    // Verify the exact absolute deletion target, never a computed unchecked path.
    assert.equal(resolve(root), confirmedRoot)
    assert.notEqual(root, resolve(tmpdir()))
    assert.ok(root.startsWith(`${resolve(tmpdir())}${sep}skill-name-mapping-test-`))
    await rm(confirmedRoot, { recursive: true, force: true })
  })
  const warnings = []
  const control = { signal: new AbortController().signal, invalidations: 0, invalidate() { control.invalidations++ } }
  const config = configFor(root)
  function makeProvider(raw = config, suppliedControl = control) {
    const provider = createProvider(raw, suppliedControl, message => warnings.push(message))
    providers.push(provider)
    return provider
  }
  async function put(relative, name = 'Zotero', fields = '', body) {
    const path = join(root, relative)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, document(fields, body, name))
    return path
  }
  async function remove(path) {
    const absolute = resolve(path)
    assert.ok(absolute.startsWith(`${root}${sep}`))
    assert.notEqual(absolute, root)
    await rm(absolute, { recursive: true, force: true })
  }
  const path = await put('SKILL.md')
  return { root, path, config, control, warnings, makeProvider, put, remove, provider: makeProvider() }
}

async function first(provider, options) {
  const result = await provider.list(options)
  assert.equal(result.complete, true)
  assert.equal(result.candidates.length, 1)
  return result.candidates[0]
}

function mockWatches(t) {
  const watched = []
  const unwatched = []
  const watch = t.mock.method(fs, 'watchFile', (path, options, callback) => { watched.push({ path, options, callback }) })
  const unwatch = t.mock.method(fs, 'unwatchFile', (path, callback) => { unwatched.push({ path, callback }) })
  syncBuiltinESMExports()
  t.after(() => {
    watch.mock.restore()
    unwatch.mock.restore()
    syncBuiltinESMExports()
  })
  return { watched, unwatched }
}

test('parseMappedSkill: ASCII normalization, provenance and canonical resource base', () => {
  assert.deepEqual(parse(document('whenToUse: Query Zotero\nmetadata:\n  team: research\n  originalName: forged\n  mappedBy: forged\n')), {
    name: 'zotero', description: 'Zotero library access', whenToUse: 'Query Zotero',
    invocation: { modelInvocable: true, userInvocable: true }, source: 'custom',
    provider: 'local-name-mapping', path: '/real/source/SKILL.md',
    resourceBase: { kind: 'directory', path: '/real/source' },
    metadata: { team: 'research', originalName: 'Zotero', mappedBy: 'local-name-mapping' },
    content: '# Zotero\n\nUse ./scripts/query.js.',
  })
  for (const [name, expected] of [['ZOTERO', 'zotero'], ['zOtErO', 'zotero'], ['A-B2-C', 'a-b2-c'], ['a', 'a'], ['1', '1'], ['zotero', 'zotero']]) {
    assert.equal(parse(document('', '', name)).name, expected)
    assert.equal(parse(document('', '', name)).metadata.originalName, name)
  }
})

test('parseMappedSkill: BOM, CRLF, YAML multiline and frontmatter-looking body', () => {
  const text = '\uFEFF--- \t\r\nname: Zotero\r\ndescription: >-\r\n  Search a\r\n  Zotero library.\r\nwhenToUse: |\r\n  First line\r\n  Second line\r\n---\t\r\n# Body\r\n---\r\nkeep: body\r\n'
  const skill = parse(text)
  assert.equal(skill.description, 'Search a Zotero library.')
  assert.equal(skill.whenToUse, 'First line\nSecond line\n')
  assert.equal(skill.content, '# Body\r\n---\r\nkeep: body')
  assert.equal(parse('---\nname: Zotero\ndescription: valid\n---').content, '')
})

test('parseMappedSkill: permission boolean grammar, defaults and inversion', () => {
  for (const token of ['true', 'TRUE', 'yes', 'YeS', 'on', '1']) {
    assert.deepEqual(parse(document(`disable-model-invocation: ${JSON.stringify(token)}\nuser-invocable: ${JSON.stringify(token)}\n`)).invocation, { modelInvocable: false, userInvocable: true }, token)
  }
  for (const token of ['false', 'FALSE', 'no', 'No', 'off', '0']) {
    assert.deepEqual(parse(document(`disable-model-invocation: ${JSON.stringify(token)}\nuser-invocable: ${JSON.stringify(token)}\n`)).invocation, { modelInvocable: true, userInvocable: false }, token)
  }
  for (const [model, user] of [['true', 'false'], ['1', '0']]) {
    assert.deepEqual(parse(document(`disable-model-invocation: ${model}\nuser-invocable: ${user}\n`)).invocation, { modelInvocable: false, userInvocable: false })
  }
  assert.deepEqual(parse(document('disable-model-invocation: 0\nuser-invocable: 1\n')).invocation, { modelInvocable: true, userInvocable: true })
  assert.deepEqual(parse(document()).invocation, { modelInvocable: true, userInvocable: true })
})

test('parseMappedSkill: invalid or legacy permission fields never become permissive defaults', () => {
  for (const key of ['disable-model-invocation', 'user-invocable']) {
    for (const value of ['null', '2', '[]', '{}', '""', 'maybe', '"true false"', '" true "', '" false "']) {
      assert.throws(() => parse(document(`${key}: ${value}\n`)), /invalid invocation field/, `${key}: ${value}`)
    }
  }
  for (const key of ['disableModelInvocation', 'modelInvocable', 'userInvocable']) {
    assert.throws(() => parse(document(`${key}: false\n`)), /unsupported invocation field/)
  }
})

test('parseMappedSkill: required fields, YAML shapes and ASCII-only alias safety', () => {
  for (const text of ['', '# no frontmatter', '---\nname: Zotero\ndescription: valid', ' ---\nname: Zotero\n---']) assert.throws(() => parse(text), /missing YAML frontmatter/)
  for (const yaml of ['null', '[]', 'plain scalar']) assert.throws(() => parse(`---\n${yaml}\n---\nbody`), /frontmatter must be an object/)
  for (const field of ['description: valid', 'name: 1\ndescription: valid', 'name: ""\ndescription: valid']) assert.throws(() => parse(`---\n${field}\n---\nbody`), /name must/)
  for (const name of ['-Zotero', 'Zotero-', 'A--B', 'A_B', 'A.B', 'A B', ' Zotero', 'Zotero ', '中文', 'ÄBC', 'İ', 'K', 'ＡＢＣ', 'a/../b']) {
    assert.throws(() => parse(document('', '', name)), /invalid after ASCII lowercasing/, name)
  }
  for (const value of ['null', 'true', '42', '[]', '{}', '""', '"   "']) assert.throws(() => parse(`---\nname: Zotero\ndescription: ${value}\n---`), /description/)
  for (const value of ['null', 'true', '42', '[]', '{}']) assert.throws(() => parse(document(`whenToUse: ${value}\n`)), /whenToUse must be a string/)
  assert.throws(() => parse(document('description: duplicate\n')), /unique|duplicate/i)
})

test('parseMappedSkill: arbitrary YAML tags rejected and aliases bounded', () => {
  assert.throws(() => parse(document('metadata: !untrusted arbitrary\n')), /tag|YAML/i)
  assert.equal(parse(document('whenToUse: &hint Query the library\nmetadata:\n  hint: *hint\n')).metadata.hint, 'Query the library')
  const explosive = 'metadata:\n  a: &a [x, x, x, x, x, x, x, x, x, x]\n  b: &b [*a, *a, *a, *a, *a, *a, *a, *a, *a, *a]\n  c: [*b, *b, *b, *b, *b, *b, *b, *b, *b, *b]\n'
  assert.throws(() => parse(document(explosive)), /alias|resource/i)
})

test('resolveConfig: defaults, home expansion, absolute paths and obsolete mappings rejection', () => {
  const defaults = resolveConfig()
  assert.equal(defaults.includeDefaultRoots, true)
  assert.deepEqual(defaults.customSkillDirs, [])
  assert.ok(isAbsolute(defaults.dshHome))
  assert.ok(isAbsolute(defaults.agentsHome))
  assert.equal(Config({}).includeDefaultRoots, true)
  assert.deepEqual(resolveConfig({ customSkillDirs: ['/tmp/a/../b', '~/skills'] }).customSkillDirs, ['/tmp/b', join(homedir(), 'skills')])
  for (const path of ['relative', '~other/skills', '~', '']) assert.throws(() => resolveConfig({ customSkillDirs: [path] }))
  for (const config of [null, [], { typo: [] }, { mappings: [] }, { customSkillDirs: {} }, { includeDefaultRoots: 'false' }, { dshHome: 'relative' }, { bundledSkillDir: 'relative' }]) assert.throws(() => resolveConfig(config))
})

test('resolveRoots: nearest .git ancestor, cwd isolation, fallback and root source/rank order', async t => {
  const f = await fixture(t)
  await mkdir(join(f.root, '.git'))
  const nested = join(f.root, 'nested')
  await mkdir(join(nested, '.git'), { recursive: true })
  const cwd = join(nested, 'deep')
  await mkdir(cwd)
  const config = resolveConfig({ dshHome: join(f.root, 'user-dsh'), agentsHome: join(f.root, 'user-agents'), customSkillDirs: [join(f.root, 'custom')], bundledSkillDir: join(f.root, 'bundle') })
  assert.deepEqual(await resolveRoots(config, cwd), [
    { path: join(nested, '.dsh/skills'), source: 'project-dsh', rank: 100 },
    { path: join(nested, '.agents/skills'), source: 'project-agents', rank: 200 },
    { path: join(f.root, 'custom'), source: 'custom', rank: 300 },
    { path: join(f.root, 'user-dsh/skills'), source: 'user-dsh', rank: 400 },
    { path: join(f.root, 'user-agents/skills'), source: 'user-agents', rank: 500 },
    { path: join(f.root, 'bundle'), source: 'bundled', rank: 600 },
  ])
  assert.deepEqual((await resolveRoots(config, undefined)).map(r => r.source), ['custom', 'user-dsh', 'user-agents', 'bundled'])
  const noGit = join(f.root, 'outside')
  await mkdir(noGit)
  // Removing only the verified .git path makes this temporary tree a non-project cwd.
  await f.remove(join(f.root, '.git'))
  assert.equal((await resolveRoots(config, noGit))[0].path, join(noGit, '.dsh/skills'))
  assert.deepEqual(await resolveRoots(resolveConfig({ includeDefaultRoots: false }), cwd), [])
  const abort = new AbortController()
  const reason = new Error('root resolution cancelled')
  abort.abort(reason)
  await assert.rejects(resolveRoots(config, cwd, abort.signal), error => error === reason)
})

test('resolveRoots: bundled environment respects defaults toggle and explicit override', async t => {
  const previous = process.env.DSH_BUNDLED_SKILL_DIR
  t.after(() => {
    if (previous === undefined) delete process.env.DSH_BUNDLED_SKILL_DIR
    else process.env.DSH_BUNDLED_SKILL_DIR = previous
  })
  process.env.DSH_BUNDLED_SKILL_DIR = '/tmp/environment-bundled-skills'
  const roots = await resolveRoots(resolveConfig(), undefined)
  assert.deepEqual(roots.at(-1), { path: '/tmp/environment-bundled-skills', source: 'bundled', rank: 600 })
  assert.deepEqual(await resolveRoots(resolveConfig({ includeDefaultRoots: false }), undefined), [])
  const explicit = await resolveRoots(resolveConfig({ includeDefaultRoots: false, bundledSkillDir: '/tmp/explicit-bundled-skills' }), undefined)
  assert.deepEqual(explicit, [{ path: '/tmp/explicit-bundled-skills', source: 'bundled', rank: 600 }])
})

test('createProvider: discovers new ASCII uppercase skills without configuration; shallow scan only', async t => {
  const f = await fixture(t)
  const before = await readFile(f.path, 'utf8')
  const candidate = await first(f.provider)
  assert.equal(candidate.rank, 301)
  assert.equal(candidate.source, 'custom')
  assert.equal(Object.hasOwn(candidate, 'content'), false)
  assert.ok(Object.isFrozen(candidate.locator))
  assert.equal((await f.provider.get(candidate)).name, 'zotero')
  await f.put('other/SKILL.md', 'HTTP-API2')
  await f.put('native.md', 'native')
  await f.put('ignored/deeper/SKILL.md', 'Deep')
  await f.put('ignored/OTHER.md', 'Other')
  await f.put('UPPER.MD', 'Extension')
  await f.put('bad.md', 'A_B')
  const result = await f.provider.list()
  assert.equal(result.complete, true)
  assert.deepEqual(result.candidates.map(c => c.name).sort(), ['http-api2', 'zotero'])
  assert.equal(await readFile(f.path, 'utf8'), before)
  assert.match(f.warnings[0], /invalid after ASCII lowercasing/)
})

test('createProvider: all default roots publish rank+1; user .system excluded and cwd does not leak', async t => {
  const f = await fixture(t)
  await f.put('project/.dsh/skills/a.md', 'ProjectDsh')
  await f.put('project/.agents/skills/a/SKILL.md', 'ProjectAgents')
  await f.put('custom/a.md', 'Custom')
  await f.put('user-dsh/skills/a.md', 'UserDsh')
  await f.put('user-dsh/skills/.system/SKILL.md', 'HiddenSystem')
  await f.put('user-agents/skills/a.md', 'UserAgents')
  await f.put('bundle/a.md', 'Bundled')
  await mkdir(join(f.root, 'project/.git'))
  await mkdir(join(f.root, 'project/child'))
  await mkdir(join(f.root, 'other'))
  const provider = f.makeProvider({ customSkillDirs: [join(f.root, 'custom')], dshHome: join(f.root, 'user-dsh'), agentsHome: join(f.root, 'user-agents'), bundledSkillDir: join(f.root, 'bundle') })
  const result = await provider.list({ cwd: join(f.root, 'project/child') })
  assert.deepEqual(result.candidates.map(c => [c.name, c.rank]), [['projectdsh', 101], ['projectagents', 201], ['custom', 301], ['userdsh', 401], ['useragents', 501], ['bundled', 601]])
  assert.deepEqual((await provider.list({ cwd: join(f.root, 'other') })).candidates.map(c => c.name), ['custom', 'userdsh', 'useragents', 'bundled'])
  const explicit = f.makeProvider({ includeDefaultRoots: false, bundledSkillDir: join(f.root, 'bundle') })
  assert.equal((await first(explicit)).rank, 601)
})

test('createProvider: uppercase collisions fail closed and recover; native lowercase wins at any rank', async t => {
  const f = await fixture(t)
  const second = await f.put('second.md', 'ZOTERO')
  assert.deepEqual(await f.provider.list(), { candidates: [], complete: true })
  assert.match(f.warnings[0], /collision.*zotero/)
  await f.provider.list()
  assert.equal(f.warnings.length, 1)
  await f.remove(second)
  await first(f.provider)
  const native = await f.put('native.md', 'zotero')
  assert.deepEqual(await f.provider.list(), { candidates: [], complete: true })
  assert.equal(f.warnings.length, 2)
  await f.remove(native)
  await first(f.provider)
  await f.put('lower-rank/native.md', 'zotero')
  const provider = f.makeProvider({ includeDefaultRoots: false, customSkillDirs: [f.root], bundledSkillDir: join(f.root, 'lower-rank') })
  assert.deepEqual(await provider.list(), { candidates: [], complete: true })
})

test('createProvider: symlink directory/file canonical resources and same-file multi-root deduplication', async t => {
  const f = await fixture(t)
  await f.put('real/SKILL.md')
  await f.remove(f.path)
  await symlink(join(f.root, 'real'), join(f.root, 'linked'))
  await symlink(join(f.root, 'real/SKILL.md'), join(f.root, 'linked.md'))
  const provider = f.makeProvider({ includeDefaultRoots: false, customSkillDirs: [f.root, join(f.root, 'real'), f.root] })
  const candidate = await first(provider)
  assert.equal(candidate.path, join(f.root, 'real/SKILL.md'))
  assert.deepEqual(candidate.resourceBase, { kind: 'directory', path: join(f.root, 'real') })
  assert.equal((await provider.get(candidate)).path, candidate.path)
  assert.deepEqual(f.warnings, [])
})

test('createProvider: symlink retarget rereads canonical resources and invalidates old summaries', async t => {
  mockWatches(t)
  const f = await fixture(t)
  await f.remove(f.path)
  await f.put('old/source.txt')
  await f.put('new/source.txt')
  const link = join(f.root, 'current.md')
  await symlink(join(f.root, 'old/source.txt'), link)
  const candidate = await first(f.provider)
  await f.remove(link)
  await symlink(join(f.root, 'new/source.txt'), link)
  const skill = await f.provider.get(candidate)
  assert.equal(skill.path, join(f.root, 'new/source.txt'))
  assert.deepEqual(skill.resourceBase, { kind: 'directory', path: join(f.root, 'new') })
  assert.equal(f.control.invalidations, 1)
})

test('createProvider: every get rereads body; summary metadata edits invalidate positive cache', async t => {
  const f = await fixture(t)
  const candidate = await first(f.provider)
  await writeFile(f.path, document('', 'new body'))
  assert.equal((await f.provider.get(candidate)).content, 'new body')
  assert.equal(f.control.invalidations, 0)
  await writeFile(f.path, document('whenToUse: New trigger\nmetadata:\n  revision: 2\nuser-invocable: false\n').replace('Zotero library access', 'Changed description'))
  const changed = await f.provider.get(candidate)
  assert.equal(changed.description, 'Changed description')
  assert.equal(changed.whenToUse, 'New trigger')
  assert.equal(changed.metadata.revision, 2)
  assert.equal(changed.invocation.userInvocable, false)
  assert.equal(f.control.invalidations, 1)
})

test('createProvider: forged locator rejected, and load-time original-name change rejected even with same alias', async t => {
  const f = await fixture(t)
  const candidate = await first(f.provider)
  assert.equal(await f.provider.get({ ...candidate, locator: { ...candidate.locator } }), undefined)
  assert.equal(await f.provider.get({ ...candidate, name: 'other' }), undefined)
  assert.equal(await f.provider.get({ name: 'zotero', locator: undefined }), undefined)
  await writeFile(f.path, document('', '', 'ZOTERO'))
  assert.equal(await f.provider.get(candidate), undefined)
  assert.equal(f.control.invalidations, 1)
  const fresh = await first(f.provider)
  assert.equal(fresh.metadata.originalName, 'ZOTERO')
  await writeFile(f.path, document('', '', 'Changed'))
  assert.equal(await f.provider.get(fresh), undefined)
  assert.equal((await first(f.provider)).name, 'changed')
})

test('createProvider: missing and invalid entries are authoritative omissions; negative cache recovers', async t => {
  const f = await fixture(t)
  const candidate = await first(f.provider)
  await f.remove(f.path)
  assert.deepEqual(await f.provider.list(), { candidates: [], complete: true })
  assert.equal(await f.provider.get(candidate), undefined)
  assert.equal(f.control.invalidations, 1)
  await writeFile(f.path, document('user-invocable: nope\n'))
  assert.deepEqual(await f.provider.list(), { candidates: [], complete: true })
  await f.provider.list()
  assert.equal(f.warnings.length, 1)
  assert.match(f.warnings[0], /invalid invocation field/)
  await writeFile(f.path, document())
  assert.equal((await f.provider.get(candidate)).name, 'zotero')
  await first(f.provider)
  await writeFile(f.path, document('user-invocable: nope\n'))
  await f.provider.list()
  assert.equal(f.warnings.length, 2)
})

test('createProvider: I/O errors mark incomplete without dropping healthy entries; recovery is uncached', async t => {
  const f = await fixture(t)
  const bad = await f.put('bad/SKILL.md', 'Bad')
  const original = fs.promises.readFile
  const mock = t.mock.method(fs.promises, 'readFile', async (path, options) => {
    if (path === bad) throw Object.assign(new Error('permission denied'), { code: 'EACCES' })
    return original(path, options)
  })
  syncBuiltinESMExports()
  try {
    const result = await f.provider.list()
    assert.equal(result.complete, false)
    assert.deepEqual(result.candidates.map(c => c.name), ['zotero'])
    assert.match(f.warnings[0], /read failed: permission denied/)
  } finally {
    mock.mock.restore()
    syncBuiltinESMExports()
  }
  assert.deepEqual((await f.provider.list()).candidates.map(c => c.name).sort(), ['bad', 'zotero'])
})

test('createProvider: get I/O errors propagate and later reads recover; non-regular SKILL omitted', async t => {
  const f = await fixture(t)
  const candidate = await first(f.provider)
  await mkdir(join(f.root, 'bad/SKILL.md'), { recursive: true })
  const result = await f.provider.list()
  assert.equal(result.complete, true)
  assert.deepEqual(result.candidates.map(c => c.name), ['zotero'])
  assert.match(f.warnings[0], /not a regular instruction file/)
  const original = fs.promises.readFile
  const denied = Object.assign(new Error('permission denied on get'), { code: 'EACCES' })
  const mock = t.mock.method(fs.promises, 'readFile', async (path, options) => {
    if (path === f.path) throw denied
    return original(path, options)
  })
  syncBuiltinESMExports()
  try {
    await assert.rejects(f.provider.get(candidate), error => error === denied)
  } finally {
    mock.mock.restore()
    syncBuiltinESMExports()
  }
  assert.equal((await f.provider.get(candidate)).name, 'zotero')
})

test('createProvider: root scan I/O errors are incomplete, deduped and recover', async t => {
  const f = await fixture(t)
  const original = fs.promises.readdir
  const mock = t.mock.method(fs.promises, 'readdir', async (path, options) => {
    if (path === f.root) throw Object.assign(new Error('scan denied'), { code: 'EACCES' })
    return original(path, options)
  })
  syncBuiltinESMExports()
  try {
    assert.deepEqual(await f.provider.list(), { candidates: [], complete: false })
    await f.provider.list()
    assert.equal(f.warnings.length, 1)
    assert.match(f.warnings[0], /scan failed: scan denied/)
  } finally {
    mock.mock.restore()
    syncBuiltinESMExports()
  }
  await first(f.provider)
})

test('createProvider: absent/ENOTDIR roots and empty configuration are complete', async t => {
  const f = await fixture(t)
  const provider = f.makeProvider({ includeDefaultRoots: false, customSkillDirs: [join(f.root, 'missing'), join(f.path, 'child')] })
  assert.deepEqual(await provider.list(), { candidates: [], complete: true })
  assert.deepEqual(await f.makeProvider({ includeDefaultRoots: false }).list(), { candidates: [], complete: true })
  assert.deepEqual(f.warnings, [])
})

test('createProvider: caller/control abort propagates before list/get', async t => {
  const f = await fixture(t)
  for (const source of ['caller', 'control']) {
    const abort = new AbortController()
    const reason = new Error(`${source} cancelled`)
    const control = { ...f.control, signal: source === 'control' ? abort.signal : f.control.signal }
    const provider = f.makeProvider(f.config, control)
    const candidate = await first(provider)
    const options = source === 'caller' ? { signal: abort.signal } : {}
    abort.abort(reason)
    await assert.rejects(provider.list(options), error => error === reason)
    await assert.rejects(provider.get(candidate, options), error => error === reason)
  }
  assert.deepEqual(f.warnings, [])
})

test('createProvider: abort during realpath is propagated without diagnostic', async t => {
  const f = await fixture(t)
  const abort = new AbortController()
  const reason = new Error('cancelled during I/O')
  const mock = t.mock.method(fs.promises, 'realpath', async () => { abort.abort(reason); return f.path })
  syncBuiltinESMExports()
  try {
    await assert.rejects(f.provider.list({ signal: abort.signal }), error => error === reason)
    assert.deepEqual(f.warnings, [])
  } finally {
    mock.mock.restore()
    syncBuiltinESMExports()
  }
})

test('apply: factory registration, dynamic predicted watches, deletion pruning and exact unload cleanup', async t => {
  const f = await fixture(t)
  const { watched, unwatched } = mockWatches(t)
  let cleanup
  let registered
  const ctx = {
    skills: { registerProvider(factory) { registered = factory(f.control) } },
    logger: { warn(message) { f.warnings.push(message) } },
    effect(effect) { cleanup = effect() },
  }
  try {
    apply(ctx, f.config)
    assert.equal(registered.name, 'local-name-mapping')
    assert.equal(typeof cleanup, 'function')
    await first(registered)
    assert.deepEqual(watched.map(w => w.path), [f.root, f.path])
    await mkdir(join(f.root, 'new-dir'))
    const added = await f.put('added.md', 'Added')
    watched[0].callback()
    assert.equal(f.control.invalidations, 1)
    await registered.list()
    assert.deepEqual(new Set(watched.map(w => w.path)), new Set([f.root, f.path, added, join(f.root, 'new-dir/SKILL.md')]))
    for (const item of watched) assert.deepEqual(item.options, { interval: 1000, persistent: false })
    await f.put('new-dir/SKILL.md', 'New')
    watched.find(w => w.path.endsWith('new-dir/SKILL.md')).callback()
    assert.equal((await registered.list()).candidates.length, 3)
    await f.remove(added)
    await f.remove(join(f.root, 'new-dir'))
    await first(registered)
    assert.deepEqual(new Set(unwatched.map(w => w.path)), new Set([added, join(f.root, 'new-dir/SKILL.md')]))
    cleanup()
    cleanup = undefined
    assert.deepEqual(new Set(unwatched.map(w => w.path)), new Set(watched.map(w => w.path)))
    for (const item of unwatched) assert.equal(item.callback, watched.find(w => w.path === item.path).callback)
    const count = f.control.invalidations
    watched[0].callback()
    assert.equal(f.control.invalidations, count)
    assert.deepEqual(await registered.list(), { candidates: [], complete: false })
    registered.dispose()
    assert.equal(unwatched.length, watched.length)
  } finally {
    cleanup?.()
  }
})

test('createProvider: retained root watches capped at 32 and eviction invalidates; dispose clears all', async t => {
  const f = await fixture(t)
  const { watched, unwatched } = mockWatches(t)
  const provider = f.makeProvider({ dshHome: join(f.root, 'user-dsh'), agentsHome: join(f.root, 'user-agents'), bundledSkillDir: join(f.root, 'bundle') })
  for (let i = 0; i < 17; i++) {
    const cwd = join(f.root, `project-${i}`)
    await mkdir(join(cwd, '.git'), { recursive: true })
    await provider.list({ cwd })
  }
  // 34 distinct project roots plus three shared user/bundled roots.
  assert.equal(watched.length, 37)
  assert.equal(unwatched.length, 5)
  assert.equal(unwatched[0].path, join(f.root, 'project-0/.dsh/skills'))
  assert.equal(f.control.invalidations, 5)
  provider.dispose()
  assert.equal(unwatched.length, watched.length)
  assert.deepEqual(new Set(unwatched.map(w => w.path)), new Set(watched.map(w => w.path)))
})

test('createProvider: disposal during in-flight list/get suppresses stale results and removes watches', async t => {
  const { watched, unwatched } = mockWatches(t)
  for (const operation of ['list', 'get']) {
    const f = await fixture(t)
    const candidate = await first(f.provider)
    const original = fs.promises.readFile
    let entered
    let release
    const started = new Promise(resolve => { entered = resolve })
    const gate = new Promise(resolve => { release = resolve })
    const mock = t.mock.method(fs.promises, 'readFile', async (path, options) => {
      if (path === f.path) { entered(); await gate }
      return original(path, options)
    })
    syncBuiltinESMExports()
    try {
      const pending = operation === 'list' ? f.provider.list() : f.provider.get(candidate)
      await started
      f.provider.dispose()
      release()
      const result = await pending
      if (operation === 'list') assert.deepEqual(result, { candidates: [], complete: false })
      else assert.equal(result, undefined)
      assert.equal(f.control.invalidations, 0)
    } finally {
      release()
      mock.mock.restore()
      syncBuiltinESMExports()
    }
  }
  assert.equal(unwatched.length, watched.length)
})

test('apply: obsolete/invalid configuration fails before registration or effects', () => {
  let calls = 0
  const ctx = { skills: { registerProvider() { calls++ } }, effect() { calls++ } }
  assert.throws(() => apply(ctx, { mappings: [] }), /explicit mappings are no longer supported/)
  assert.throws(() => apply(ctx, { customSkillDirs: ['relative'] }), /absolute path/)
  assert.equal(calls, 0)
})
