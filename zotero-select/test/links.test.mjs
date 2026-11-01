import assert from 'node:assert/strict';
import test from 'node:test';
import { extractZoteroLinks } from '../src/links.js';

const personal = (key = 'AB12CD34') => `zotero://select/library/items/${key}`;
const group = (id = '123', key = 'AB12CD34') => `zotero://select/groups/${id}/items/${key}`;
const item = (uri, title, itemKey = 'AB12CD34') => ({ uri, title, itemKey });

test('inline links and angle destinations produce plain recursive label text', () => {
  const markdown = `[A *nested **bold** label* and \`code\`](${personal()})\n\n[Angle](<${group()}>)`;
  assert.deepEqual(extractZoteroLinks(markdown), [
    item(personal(), 'A nested bold label and code'),
    item(group(), 'Angle'),
  ]);
});

test('full, collapsed and shortcut references resolve case-insensitively in source order', () => {
  const markdown = `
[Full][Mixed LABEL]
[Collapsed][]
[Shortcut]
[missing][undefined]

[mixed label]: ${personal()}
[collapsed]: <${group()}>
[shortcut]: ${personal('EF56GH78')}
`;
  assert.deepEqual(extractZoteroLinks(markdown), [
    item(personal(), 'Full'),
    item(group(), 'Collapsed'),
    item(personal('EF56GH78'), 'Shortcut', 'EF56GH78'),
  ]);
});

test('duplicate definitions use the first destination and definitions alone emit nothing', () => {
  const markdown = `[x][ref]\n\n[ref]: ${personal()}\n[ref]: ${group()}\n[unused]: ${personal('EF56GH78')}`;
  assert.deepEqual(extractZoteroLinks(markdown), [item(personal(), 'x')]);
});

test('deduplicates normalized destinations with the first title, not the item key', () => {
  const markdown = `
[First](<${personal()}>)
[Second][same]
[Group](${group()})
[Other group](${group('456')})
[Repeated group](<${group()}>)

[same]: ${personal()}
`;
  assert.deepEqual(extractZoteroLinks(markdown), [
    item(personal(), 'First'),
    item(group(), 'Group'),
    item(group('456'), 'Other group'),
  ]);
});

test('empty labels and image-only labels fall back to the key; image alt is never text', () => {
  const markdown = `[](${personal()})\n\n[![misleading alt](picture.png)](${group()})\n\n[Before ![omit me][pic] after](${group('456')})\n\n[pic]: picture.png`;
  assert.deepEqual(extractZoteroLinks(markdown), [
    item(personal(), 'AB12CD34'),
    item(group(), 'AB12CD34'),
    item(group('456'), 'Before after'),
  ]);
});

test('ignores fenced and indented code, inline code, bare URIs, HTML and images', () => {
  const link = `[not a link](${personal()})`;
  const markdown = [
    '```markdown', link, '```', '',
    '~~~', link, '~~~', '',
    `    ${link}`, '',
    `\`${link}\``, '',
    personal(), '',
    `<a href="${personal()}">HTML anchor</a>`, '',
    '<div>', link, '</div>', '',
    `![image](${personal()})`, '',
    '![reference image][picture]', '',
    `[picture]: ${group()}`, '',
    '<!--', link, '-->',
  ].join('\n');
  assert.deepEqual(extractZoteroLinks(markdown), []);
});

test('CommonMark URI autolinks are real links, unlike bare URIs', () => {
  assert.deepEqual(extractZoteroLinks(`${personal()}\n\n<${group()}>`), [
    item(group(), group()),
  ]);
});

test('rejects malicious and noncanonical destinations rather than normalizing them into targets', () => {
  const invalid = [
    'http://select/library/items/AB12CD34',
    'https://example.com/zotero://select/library/items/AB12CD34',
    'ZOTERO://select/library/items/AB12CD34',
    'zotero://SELECT/library/items/AB12CD34',
    'zotero://user@select/library/items/AB12CD34',
    'zotero://user:pass@select/library/items/AB12CD34',
    'zotero://select:80/library/items/AB12CD34',
    `${personal()}?query=1`, `${personal()}?`,
    `${personal()}#fragment`, `${personal()}#`,
    'zotero://select/library/items/%41B12CD34',
    'zotero://select/library%2Fitems/AB12CD34',
    'zotero://%73elect/library/items/AB12CD34',
    'zotero://select/library/items/ab12cd34',
    'zotero://select/library/items/AB12CD3',
    'zotero://select/library/items/AB12CD345',
    'zotero://select/library/items/AB12CD3_',
    `${personal()}/`, `${personal()}/children`,
    'zotero://select/library/../library/items/AB12CD34',
    'zotero://select//library/items/AB12CD34',
    'zotero://select/users/123/items/AB12CD34',
    group('0'), group('01'), group('-1'), group('1.5'),
    'zotero://select/groups/123/collections/AB12CD34',
    'zotero://open-pdf/library/items/AB12CD34',
  ];
  for (const uri of invalid) {
    assert.deepEqual(extractZoteroLinks(`[bad](<${uri}>)`), [], uri);
    assert.deepEqual(extractZoteroLinks(`[bad][ref]\n\n[ref]: <${uri}>`), [], uri);
  }
});

test('escaped link examples remain text while escaped label punctuation is decoded', () => {
  const markdown = String.raw`\[example](${personal()})

\[example\]\(${group()}\)

[Real \[brackets\] and \*stars\*](${personal('EF56GH78')})`;
  assert.deepEqual(extractZoteroLinks(markdown), [
    item(personal('EF56GH78'), 'Real [brackets] and *stars*', 'EF56GH78'),
  ]);
});

test('entities in labels are decoded and whitespace is collapsed', () => {
  assert.deepEqual(extractZoteroLinks(`[A &amp; B\n  next](${personal()})`), [
    item(personal(), 'A & B next'),
  ]);
});

test('ordinary links, unresolved references and empty documents return no results', () => {
  for (const markdown of ['', '[web](https://example.com)', '[missing][ref]', '[unresolved]', 'plain text']) {
    assert.deepEqual(extractZoteroLinks(markdown), []);
  }
});
