import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepareManifest } from '../extension/shared/manifest.mjs';

const project = { version: 1, supabaseUrl: 'https://unit-test.supabase.co', publishableKey: 'sb_publishable_test' };
const manifest = JSON.parse(readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
test('permissions : un seul projet préautorisé, sans wildcard ni accès permanent à BoursoBank', () => {
  const prepared = prepareManifest({ ...manifest, options_ui: { page: 'options/options.html' }, optional_host_permissions: ['https://*.supabase.co/*'],
    host_permissions: ['<all_urls>'] }, project);
  assert.deepEqual(prepared.host_permissions, ['https://unit-test.supabase.co/*']);
  assert.equal(prepared.optional_host_permissions, undefined);
  assert.equal(prepared.options_ui, undefined);
  assert.equal(manifest.options_ui, undefined);
  assert.ok(prepared.permissions.includes('activeTab'));
  assert.equal(prepared.permissions.includes('<all_urls>'), false);
  assert.equal(manifest.optional_host_permissions, undefined);
  assert.equal(manifest.host_permissions.length, 1);
  assert.match(manifest.host_permissions[0], /^https:\/\/[a-z0-9-]+\.supabase\.co\/\*$/);
});
test('permissions : préparation idempotente et changement de projet sans conserver l’ancien accès', () => {
  const prepared = prepareManifest(manifest, project);
  assert.deepEqual(prepareManifest(prepared, project), prepared);
  assert.deepEqual(prepareManifest(prepared, { ...project, supabaseUrl: 'https://other-test.supabase.co' }).host_permissions,
    ['https://other-test.supabase.co/*']);
  assert.throws(() => prepareManifest(manifest, { ...project, supabaseUrl: 'https://untrusted.example' }));
});
test('icônes : PNG présents aux bonnes dimensions, identiques pour la barre d’outils et la liste des extensions', () => {
  assert.deepEqual(manifest.action.default_icon, manifest.icons);
  assert.deepEqual(prepareManifest(manifest, project).icons, manifest.icons);
  for (const size of [16, 32, 48, 128]) {
    const png = readFileSync(new URL(`../extension/${manifest.icons[size]}`, import.meta.url));
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
  }
});
