import { fromMarkdown } from 'mdast-util-from-markdown';

// Match the whole parsed destination without URL's permissive normalization.
const selectUri = /^zotero:\/\/select\/(?:library\/items\/([A-Z0-9]{8})|groups\/([1-9][0-9]*)\/items\/([A-Z0-9]{8}))$/;
const excluded = new Set(['code', 'inlineCode', 'image', 'imageReference', 'html']);

function referenceId(identifier) {
  return identifier.replace(/\s+/g, ' ').trim().toLowerCase();
}

function plainText(node) {
  // Code in a label is literal title text, never another source of links.
  if (node.type === 'text' || node.type === 'inlineCode') return node.value;
  if (node.type === 'break') return ' ';
  if (excluded.has(node.type)) return '';
  return (node.children ?? []).map(plainText).join('');
}

function walk(node, visit) {
  if (excluded.has(node.type)) return;
  visit(node);
  for (const child of node.children ?? []) walk(child, visit);
}

/** Extract only Markdown links to exact personal/group Zotero select targets. */
export function extractZoteroLinks(markdown) {
  const tree = fromMarkdown(markdown);
  const definitions = new Map();
  walk(tree, (node) => {
    if (node.type !== 'definition') return;
    const id = referenceId(node.identifier);
    // CommonMark resolves duplicate definitions to the first definition.
    if (!definitions.has(id)) definitions.set(id, node.url);
  });

  const result = [];
  const seen = new Set();
  walk(tree, (node) => {
    let destination;
    if (node.type === 'link') destination = node.url;
    else if (node.type === 'linkReference') {
      destination = definitions.get(referenceId(node.identifier));
    } else return;
    if (typeof destination !== 'string') return;

    const match = selectUri.exec(destination);
    // `$` alone also matches before a final newline in JavaScript.
    if (!match || match[0] !== destination) return;
    const itemKey = match[1] ?? match[3];
    const uri = match[2]
      ? `zotero://select/groups/${match[2]}/items/${itemKey}`
      : `zotero://select/library/items/${itemKey}`;
    if (seen.has(uri)) return;
    seen.add(uri);
    const title = plainText(node).replace(/\s+/g, ' ').trim() || itemKey;
    result.push({ uri, title, itemKey });
  });
  return result;
}
