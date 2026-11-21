import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, extname, resolve, relative } from 'node:path'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import GithubSlugger from 'github-slugger'

const parser = unified().use(remarkParse)
function textOf(node) {
  if (typeof node.value === 'string') return node.value
  return (node.children ?? []).map(textOf).join('')
}

function sourceLocation(node, file) {
  const start = node.position?.start
  return `${relative(process.cwd(), file)}:${start?.line ?? 1}:${start?.column ?? 1}`
}

function splitDestination(destination) {
  const hash = destination.indexOf('#')
  const beforeFragment = hash < 0 ? destination : destination.slice(0, hash)
  const fragment = hash < 0 ? '' : destination.slice(hash + 1)
  const query = beforeFragment.indexOf('?')
  return {
    path: query < 0 ? beforeFragment : beforeFragment.slice(0, query),
    fragment,
  }
}

function isExternal(destination) {
  return destination.startsWith('//') || /^[A-Za-z][A-Za-z\d+.-]*:/.test(destination)
}

function anchorsIn(tree) {
  const anchors = new Set()
  const slugger = new GithubSlugger()
  function visit(node) {
    if (node.type === 'heading') anchors.add(slugger.slug(textOf(node)))
    if (node.type === 'html') {
      for (const match of node.value.matchAll(/\b(?:id|name)\s*=\s*["']([^"']+)["']/gi)) anchors.add(match[1])
    }
    for (const child of node.children ?? []) visit(child)
  }
  visit(tree)
  return anchors
}

function decode(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

function parseFile(file) {
  const tree = parser.parse(readFileSync(file, 'utf8'))
  return { tree, anchors: anchorsIn(tree) }
}

export function checkMarkdownFiles(files) {
  const parsed = new Map()
  const errors = []
  for (const file of files) parsed.set(file, parseFile(file))
  for (const file of files) {
    const entry = parsed.get(file)
    function visit(node) {
      if (node.type === 'link' || node.type === 'image') checkLink(node)
      for (const child of node.children ?? []) visit(child)
    }
    function checkLink(node) {
      const destination = node.url
      if (!destination || isExternal(destination)) return
      const parts = splitDestination(destination)
      const path = decode(parts.path)
      const fragment = decode(parts.fragment)
      if (path === null || fragment === null) {
        errors.push(`${sourceLocation(node, file)}: invalid URL encoding in ${destination}`)
        return
      }
      const target = path ? resolve(dirname(file), path) : file
      if (!existsSync(target)) {
        errors.push(`${sourceLocation(node, file)}: local target does not exist: ${destination}`)
        return
      }
      if (!fragment) return
      if (path && extname(target).toLowerCase() !== '.md') return
      const targetEntry = parsed.get(target)
      if (!targetEntry) parsed.set(target, parseFile(target))
      if (!parsed.get(target).anchors.has(fragment)) {
        errors.push(`${sourceLocation(node, file)}: local anchor does not exist: ${destination}`)
      }
    }
    visit(entry.tree)
  }
  return errors
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = process.cwd()
  const files = execFileSync('git', ['ls-files', '-z', '--', '*.md'], { encoding: 'utf8' })
    .split('\0').filter(Boolean).map(file => resolve(root, file))
  const errors = checkMarkdownFiles(files)
  if (errors.length) {
    console.error(errors.join('\n'))
    process.exitCode = 1
  }
}
