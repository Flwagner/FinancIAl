import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'FinancIAl — Mon patrimoine', description: 'Votre patrimoine, en perspective.', robots: { index: false, follow: false } };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="fr"><body>{children}</body></html>;
}
