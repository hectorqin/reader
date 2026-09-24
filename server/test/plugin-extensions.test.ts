import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extensionDeclarations, extensionFields, extensionPage, extensionValues } from '../src/sources/extensions.ts';

test('login extensions accept private inputs and HTTP links without echoing secrets or script URLs', () => {
  const form = { id: 'login', title: 'Login', submit: 'Login', fields: [{ key: 'password', label: 'Password', type: 'password' }] };
  assert.doesNotThrow(() => extensionPage({ title: 'Login', forms: [form], links: [{ title: 'Site', url: 'https://example.test/login' }] }));
  for (const url of ['javascript:alert(1)', 'data:text/html,test', 'https://name:secret@example.test']) {
    assert.throws(() => extensionPage({ title: 'Login', forms: [], links: [{ title: 'Site', url }] }));
  }
  assert.throws(() => extensionPage({ title: 'Login', forms: [{ ...form, values: { password: 'secret' } }] }));
  assert.throws(() => extensionFields([{ key: 'password', label: 'Password', type: 'password', value: 'secret' }]));
});

test('extension protocol rejects malformed declarations, unbounded options and structured action values', () => {
  assert.throws(() => extensionDeclarations({ pages: [{ id: '../escape', title: 'x' }] }));
  assert.throws(() => extensionDeclarations({ tasks: [{ id: 'poll', intervalMinutes: 0 }] }));
  assert.throws(() => extensionDeclarations({ tasks: [{ id: 'poll', intervalMinutes: 1 }, { id: 'poll', intervalMinutes: 2 }] }));
  assert.throws(() => extensionFields([{ key: 'region', label: 'Region', type: 'select', options: Array(10002).fill({ value: 'a', label: 'A' }) }]));
  assert.throws(() => extensionFields([{ key: 'x', label: 'X', type: 'html' }]));
  assert.throws(() => extensionValues({ items: ['unvalidated'] }));
  assert.throws(() => extensionValues(JSON.parse('{"__proto__":"injected"}')));
  assert.throws(() => extensionPage({ title: 'x', forms: [], sections: [{ title: 'x', items: Array(201).fill({ title: 'x' }) }] }));
  assert.deepEqual(extensionPage({ title: 'Settings', forms: [{ id: 'save', title: '', submit: 'Save', fields: [{ key: 'enabled', label: 'Enabled', type: 'boolean', value: false }] }] }).forms[0]!.fields[0]!.value, false);
});

test('tabbed extension pages enforce bounded content and declared active tabs', () => {
  const tab = { id: 'sources', title: 'Sources', forms: [], sections: [{ title: 'List', emptyText: 'Empty', items: [{ title: 'A', collapsible: true, forms: [] }] }] };
  assert.equal(extensionPage({ title: 'Library', forms: [], tabs: [tab], activeTab: 'sources', notice: 'Saved' }).tabs?.[0]?.id, 'sources');
  for (const tabs of [[tab, tab], [{ ...tab, id: '../escape' }], [{ ...tab, forms: null }], Array(17).fill(tab)]) {
    assert.throws(() => extensionPage({ title: 'x', forms: [], tabs }));
  }
  assert.throws(() => extensionPage({ title: 'x', forms: [], tabs: [tab], activeTab: 'missing' }));
});

test('extension UX hints are validated without allowing executable or unbounded values', () => {
  assert.doesNotThrow(() => extensionPage({ title: 'x', forms: [{ id: 'save', title: '', submit: 'Save', layout: 'inline', confirm: 'Delete?', fields: [{ key: 'count', label: 'Count', type: 'number', min: 1, max: 100, placeholder: '1' }] }], noticeKind: 'error' }));
  for (const field of [{ min: Infinity }, { min: 2, max: 1 }, { placeholder: {} }]) {
    assert.throws(() => extensionFields([{ key: 'n', label: 'N', type: 'number', ...field }]));
  }
  assert.throws(() => extensionPage({ title: 'x', forms: [], noticeKind: 'html' }));
  assert.throws(() => extensionPage({ title: 'x', forms: [{ id: 'save', title: '', submit: 'Save', fields: [], confirm: {} }] }));
});

test('read-only extension outputs are text-only and bounded', () => {
  const output = { title: 'Log', text: '<script>plain text</script>\n200 OK', format: 'log' };
  assert.equal(extensionPage({ title: 'Debug', forms: [], outputs: [output] }).outputs?.[0]?.text, output.text);
  for (const outputs of [[{ ...output, format: 'html' }], [{ ...output, text: {} }], [{ ...output, text: 'x'.repeat(65537) }], Array(9).fill(output)]) {
    assert.throws(() => extensionPage({ title: 'Debug', forms: [], outputs }));
  }
});
