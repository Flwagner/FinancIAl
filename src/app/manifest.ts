import type { MetadataRoute } from 'next';

export const dynamic = 'force-static';

export default function manifest(): MetadataRoute.Manifest {
  const root = `${process.env.NEXT_PUBLIC_BASE_PATH || ''}/`;
  return {
    id: root, name: 'FinancIAl — Mon patrimoine', short_name: 'FinancIAl',
    description: 'Votre patrimoine, en perspective.', lang: 'fr',
    start_url: root, scope: root, display: 'standalone',
    background_color: '#101411', theme_color: '#101411',
    icons: [
      { src: `${root}icons/icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: `${root}icons/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: `${root}icons/maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
