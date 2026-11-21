import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { checkMarkdownFiles } from './check-markdown-links.mjs'

async function fixture(files) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-markdown-links-'))
  for (const [name, content] of Object.entries(files)) {
    const path = join(root, name)
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, content)
  }
  return root
}

async function check(files) {
  const root = await fixture(files)
  return checkMarkdownFiles(Object.keys(files).map(name => join(root, name)))
}

test('accepts local files, angle destinations, images, and fragments', async () => {
  const errors = await check({
    'README.md': '# Intro\n\n[guide](<docs/guide.md#api-usage>) [encoded](<docs/a%23b.md#encoded>)\n\n![icon](<icon.svg>)',
    'docs/guide.md': '# API usage\n',
    'docs/a#b.md': '# Encoded\n',
    'icon.svg': '<svg />',
  })
  assert.deepEqual(errors, [])
})

test('reports missing files and fragments with source locations', async () => {
  const errors = await check({
    'README.md': '[missing](nope.md)\n\n[bad anchor](docs.md#nope)\n',
    'docs.md': '# Existing\n',
  })
  assert.equal(errors.length, 2)
  assert.match(errors[0], /README\.md:1:1.*nope\.md/)
  assert.match(errors[1], /README\.md:3:1.*#nope/)
})

test('ignores external schemes and code blocks', async () => {
  const errors = await check({
    'README.md': '[web](https://example.com/nope#nope) [custom](zotero://select/nope)\n\n```md\n[ignored](missing.md#missing)\n```\n',
  })
  assert.deepEqual(errors, [])
})

test('supports duplicate headings and explicit HTML ids', async () => {
  const errors = await check({
    'README.md': '[one](#same-1) [two](#custom)\n\n# Same\n\n# Same\n\n<div id="custom"></div>\n',
  })
  assert.deepEqual(errors, [])
})
