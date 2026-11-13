import { heatmapLayout, type Tile } from './stock-simulation';

type Item = { id: string; amount: number };
export type ReadableHeatmap = { tiles: Tile[]; width: number; height: number; proportional: boolean };

export function readableHeatmap(items: Item[], width: number): ReadableHeatmap {
  const positive = items.filter(i => i.amount > 0).sort((a, b) => b.amount - a.amount);
  if (width >= 560 && positive.length) {
    // Le découpage doit tenir compte du rapport largeur/hauteur réel, pas
    // d'un carré abstrait 100 × 100 qui produit des bandeaux trop plats.
    for (let height = 460; height <= 780; height += 80) {
      const tiles = heatmapLayout(positive, 0, 0, width, height);
      if (tiles.every(t => t.width >= 160 && t.height >= 140)) return { tiles, width, height, proportional: true };
    }
  }
  // Une petite position ne peut pas contenir tout son texte à surface exacte.
  // Privilégier alors une grille lisible, explicitement annoncée dans la légende.
  return { tiles: positive.map(i => ({ ...i, x: 0, y: 0, width: 0, height: 0 })), width, height: 0, proportional: false };
}
