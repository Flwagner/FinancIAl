'use client';

import { useEffect, useState } from 'react';
import { Bell, BellOff } from 'lucide-react';
import { applicationServerKey, removePushSubscription, savePushSubscription } from '@/lib/push';

const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

export default function PushNotifications() {
  const [supported, setSupported] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!publicKey || !window.isSecureContext || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return;
    let active = true;
    setSupported(true);
    // Do not prompt or subscribe automatically. Reconcile existing browser/DB state on login.
    void navigator.serviceWorker.ready.then(async registration => {
      const subscription = await registration.pushManager.getSubscription();
      if (subscription && active && Notification.permission === 'granted') {
        await savePushSubscription(subscription);
        if (active) setEnabled(true);
      }
    }).catch(() => { if (active) setError('Abonnement à vérifier : réactive les notifications.'); });
    return () => { active = false; };
  }, []);

  async function toggle() {
    setBusy(true); setError('');
    try {
      // iOS requires requestPermission directly inside the user gesture.
      if (!enabled && await Notification.requestPermission() !== 'granted') throw new Error('Notifications refusées. Autorise-les dans les réglages du navigateur ou de l’appareil.');
      const root = `${process.env.NEXT_PUBLIC_BASE_PATH || ''}/`;
      const registration = await navigator.serviceWorker.register(`${root}sw.js`, { scope: root, updateViaCache: 'none' });
      await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      if (enabled) {
        if (existing) await removePushSubscription(existing);
        setEnabled(false);
      } else {
        const subscription = existing || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationServerKey(publicKey!) });
        await savePushSubscription(subscription);
        setEnabled(true);
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Notifications indisponibles.'); }
    finally { setBusy(false); }
  }

  if (!publicKey) return null;
  if (!supported) return <span className="muted">Notifications : navigateur compatible requis ; sur iPhone, installe la PWA.</span>;
  return <div className="push-settings"><button className="button secondary" disabled={busy} onClick={() => void toggle()}>{enabled ? <BellOff size={15} /> : <Bell size={15} />}{busy ? 'En cours…' : enabled ? 'Désactiver sur cet appareil' : 'Activer les notifications'}</button>{error && <p className="negative" role="alert">{error}</p>}</div>;
}
