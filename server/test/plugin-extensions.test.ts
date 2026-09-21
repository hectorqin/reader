import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extensionDeclarations, extensionFields, extensionPage, extensionValues } from '../src/sources/extensions.ts';

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
