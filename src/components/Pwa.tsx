'use client';

import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export default function Pwa() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [ios, setIos] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [help, setHelp] = useState(false);

  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)');
    const isStandalone = () => standalone.matches || (navigator as Navigator & { standalone?: boolean }).standalone;
    const onPrompt = (event: Event) => {
      event.preventDefault();
      if (!isStandalone()) setPrompt(event as InstallPrompt);
    };
    const onInstalled = () => { setPrompt(null); setIos(false); };
    setIos(!isStandalone() && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)));
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    if ('serviceWorker' in navigator && window.isSecureContext) {
      const root = `${process.env.NEXT_PUBLIC_BASE_PATH || ''}/`;
      void navigator.serviceWorker.register(`${root}sw.js`, { scope: root, updateViaCache: 'none' }).catch(error => {
        console.warn('Mode PWA indisponible :', error);
      });
    }
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  async function install() {
    if (!prompt) { setHelp(value => !value); return; }
    try {
      await prompt.prompt();
      await prompt.userChoice;
    } catch (error) {
      console.warn('Installation annulée ou indisponible :', error);
    } finally { setPrompt(null); }
  }

  if (dismissed || (!prompt && !ios)) return null;
  return <aside className="pwa-install" aria-label="Installer l’application">
    <button className="button" onClick={() => void install()} aria-expanded={ios ? help : undefined}><Download size={17} />Installer FinancIAl</button>
    <button className="icon-button" onClick={() => setDismissed(true)} aria-label="Masquer l’installation"><X size={18} /></button>
    {ios && help && <p>Dans Safari, ouvre le menu <strong>Partager</strong>, puis <strong>Sur l’écran d’accueil</strong> et confirme avec <strong>Ajouter</strong>.</p>}
  </aside>;
}
