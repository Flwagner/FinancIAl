import { supabase } from './supabase';

export async function savePushSubscription(subscription: PushSubscription) {
  if (!supabase) throw new Error('Supabase non configuré.');
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('Connexion requise.');
  const value = subscription.toJSON();
  const { error } = await supabase.from('push_subscriptions').upsert({
    user_id: user.id, endpoint: subscription.endpoint,
    p256dh: value.keys?.p256dh, auth: value.keys?.auth,
  }, { onConflict: 'user_id,endpoint' });
  if (error) throw new Error('Enregistrement impossible. Vérifie la migration notifications dans Supabase.');
}

export async function removePushSubscription(subscription: PushSubscription) {
  if (!supabase) throw new Error('Supabase non configuré.');
  const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', subscription.endpoint);
  if (error) throw new Error('Impossible de désactiver les notifications dans Supabase.');
  await subscription.unsubscribe();
}

export function applicationServerKey(value: string): ArrayBuffer {
  const decoded = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(decoded, char => char.charCodeAt(0)).buffer;
}
