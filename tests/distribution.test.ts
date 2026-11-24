import test from 'node:test';
import assert from 'node:assert/strict';
import { groupSmallSlices } from '../src/lib/distribution';

test('regroupe les parts strictement inférieures à 1 % sans modifier le total', () => {
  const data = [{ name: 'A', value: 980 }, { name: 'B', value: 10 }, { name: 'C', value: 6 }, { name: 'D', value: 4 }];
  const result = groupSmallSlices(data);
  assert.deepEqual(result, [{ name: 'A', value: 980 }, { name: 'B', value: 10 }, { name: 'Autres', value: 10 }]);
  assert.equal(result.reduce((s, d) => s + d.value, 0), 1000);
});
test('fusionne les petites parts avec la catégorie Autres déjà présente', () => {
  assert.deepEqual(groupSmallSlices([{ name: 'Bureaux', value: 946 }, { name: 'Autres', value: 50 }, { name: 'Résidentiel', value: 4 }]),
    [{ name: 'Bureaux', value: 946 }, { name: 'Autres', value: 54 }]);
});
test('le regroupement géographique utilise un libellé propre sans doublon', () => {
  const result = groupSmallSlices([{ name: 'France', value: 990 }, { name: 'Autres pays', value: 2 }, { name: 'Estonie', value: 8 }], 'Autres pays');
  assert.deepEqual(result, [{ name: 'France', value: 990 }, { name: 'Autres pays', value: 10 }]);
});
test('le seuil ne dépend pas de l’arrondi affiché', () => {
  const result = groupSmallSlices([{ name: 'A', value: 990.01 }, { name: 'B', value: 9.99 }]);
  assert.deepEqual(result, [{ name: 'A', value: 990.01 }, { name: 'Autres', value: 9.99 }]);
});
test('aucune mutation ni catégorie vide, même sans données', () => {
  const data = [{ name: 'A', value: 100 }, { name: 'Zéro', value: 0 }];
  const before = structuredClone(data);
  assert.deepEqual(groupSmallSlices(data), [{ name: 'A', value: 100 }]);
  assert.deepEqual(data, before);
  assert.deepEqual(groupSmallSlices([]), []);
});
