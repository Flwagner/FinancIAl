// Le jeton n'est jamais accessible aux content scripts ni synchronisé avec Chrome.
chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  await chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  chrome.alarms.create('expire-captures', { periodInMinutes: 1 });
});
chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name !== 'expire-captures') return;
  const { captures = [], pending } = await chrome.storage.session.get(['captures', 'pending']);
  const fresh = captures.filter(row => Date.now() - Date.parse(row.capturedAt) <= 30 * 60 * 1000);
  await chrome.storage.session.set({ captures: fresh });
  if (pending && pending.batch.updates.some(row => Date.now() - Date.parse(row.capturedAt) > 30 * 60 * 1000)) {
    await chrome.storage.session.remove('pending');
  }
});
