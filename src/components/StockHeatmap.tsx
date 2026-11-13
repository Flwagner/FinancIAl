'use client';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { euro, percent } from '@/lib/portfolio';
import { cgiSimulationLabel, type Period } from '@/lib/stock-simulation';
import { stockLineTickers, type GroupedStockLine } from '@/lib/stock-groups';
import { readableHeatmap } from '@/lib/stock-heatmap';

const signed = (n: number | null) => n === null ? 'Non disponible' : `${n > 0 ? '+' : ''}${percent(n)}`;
export default function StockHeatmap({ lines, total, period, onSelect }: { lines: GroupedStockLine[]; total: number; period: Period; onSelect: (id: string) => void }) {
  const root = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1000);
  const [textOverflow, setTextOverflow] = useState(false);
  const signature = lines.map(l => `${l.position.id}:${l.position.name}:${l.position.amount}:${stockLineTickers(l)}:${l.rate}:${l.simulated}`).join('|');
  const layout = useMemo(() => readableHeatmap(lines.map(l => ({ id: l.position.id, amount: l.position.amount })), width), [lines, width]);
  const proportional = layout.proportional && !textOverflow;
  useLayoutEffect(() => {
    if (!root.current) return;
    const element = root.current;
    const measure = () => setWidth(Math.max(1, Math.floor(element.getBoundingClientRect().width)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => { setTextOverflow(false); }, [width, signature]);
  useLayoutEffect(() => {
    if (!proportional || !root.current) return;
    let active = true;
    const check = () => {
      if (!active || !root.current) return;
      const clipped = Array.from(root.current.querySelectorAll<HTMLButtonElement>('.stock-tile')).some(tile => tile.scrollHeight > tile.clientHeight + 1 || tile.scrollWidth > tile.clientWidth + 1);
      if (clipped) setTextOverflow(true);
    };
    check();
    void document.fonts.ready.then(check);
    return () => { active = false; };
  }, [proportional, layout, signature]);

  return <section className="panel stock-map-panel readable-stock-map"><div className="panel-heading"><div><h2>Carte des placements</h2><p className="muted">{proportional ? 'Surface : montant détenu' : 'Tuiles adaptées à la lisibilité · poids affichés en %'} · couleur : performance sur {period} · touche une ligne pour l’explorer</p></div></div>
    <div ref={root} className={`stock-heatmap${proportional ? '' : ' stock-heatmap--grid'}`} style={proportional ? { height: layout.height } : undefined}>{layout.tiles.map(tile => {
      const line = lines.find(l => l.position.id === tile.id)!;
      const p = line.position;
      const tickers = stockLineTickers(line);
      const color = line.rate === null || line.rate === 0 ? 'neutral' : line.rate < 0 ? 'loss' : 'gain';
      const style = proportional ? { left: `${tile.x / layout.width * 100}%`, top: `${tile.y / layout.height * 100}%`, width: `${tile.width / layout.width * 100}%`, height: `${tile.height / layout.height * 100}%` } : undefined;
      return <button key={p.id} className={`stock-tile ${color}`} style={style} onClick={() => onSelect(p.id)} title={`${p.name} · ${tickers} · ${p.envelope} · ${euro(p.amount)} · ${signed(line.rate)}${line.simulated ? ` · ${cgiSimulationLabel}` : ''}${line.reason ? ` · ${line.reason}` : ''}`} aria-label={`${p.name}, ${tickers}, ${euro(p.amount)}, ${signed(line.rate)}${line.simulated ? ', Simulation à 30 % par an, aucun historique' : ''}. Voir le détail`}><b>{p.name}</b><span className="stock-tile-identifiers">{tickers}{line.simulated ? ' · Simulation · 30 % / an' : ''}</span><strong>{signed(line.rate)}</strong><small>{euro(p.amount)} · {percent(total ? p.amount / total * 100 : 0)}</small></button>;
    })}</div>
  </section>;
}
