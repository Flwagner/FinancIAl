import assert from 'node:assert/strict';
import test from 'node:test';
import { errorMessage } from '../src/lib/errors';

test('affiche les messages des erreurs natives, des objets API et des chaînes', () => {
  assert.equal(errorMessage(new Error('Connexion interrompue')), 'Connexion interrompue');
  assert.equal(errorMessage({ message: 'Accès refusé', code: '42501' }), 'Accès refusé');
  assert.equal(errorMessage('Service indisponible'), 'Service indisponible');
});

test('utilise un message lisible pour les erreurs sans message exploitable', () => {
  for (const error of [{}, null, undefined, 42, { message: {} }, { message: '' }, '   ', '[object Object]', new Error('[object Object]')]) {
    assert.equal(errorMessage(error), 'Une erreur est survenue. Réessaie dans quelques instants.');
  }
});
