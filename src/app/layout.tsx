import type { Metadata, Viewport } from 'next';
import Pwa from '@/components/Pwa';
import './globals.css';
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';
export const metadata: Metadata = {
  title: 'FinancIAl — Mon patrimoine', description: 'Votre patrimoine, en perspective.', robots: { index: false, follow: false },
  applicationName: 'FinancIAl', manifest: `${basePath}/manifest.webmanifest`,
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'FinancIAl' },
  icons: { icon: `${basePath}/icons/icon-192.png`, apple: `${basePath}/icons/apple-touch-icon.png` },
};
export const viewport: Viewport = { themeColor: '#101411', width: 'device-width', initialScale: 1, viewportFit: 'cover' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="fr"><body>{children}<Pwa /></body></html>;
}
