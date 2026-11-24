'use client';
import './portfolio-status.css';

export default function PortfolioStatus({ updatedAt, syncing, onSync, hideSync = false }: { updatedAt?: string; syncing: boolean; onSync: () => void; hideSync?: boolean }) {
  const validDate = updatedAt && Number.isFinite(Date.parse(updatedAt));
  return <div className="portfolio-status">
    {!hideSync && <button className="sync-market-button" disabled={syncing} aria-busy={syncing} onClick={onSync}><span className="lime sync-market-icon" aria-hidden="true">↻</span>{' '}{syncing ? 'Synchronisation…' : <><span className="sync-market-label-full">Synchroniser les rendements</span><span className="sync-market-label-short">Synchroniser</span></>}</button>}
    <div className="date-chip" title="Dernière mise à jour des montants du portefeuille, indépendante des rendements">
      <span className="status-dot" />
      {validDate ? <span><span className="date-chip-label">Montants au </span><span className="date-chip-short" aria-hidden="true">au </span><time dateTime={updatedAt}>{new Date(updatedAt).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric' })}</time></span> : <span>Montants : aucune mise à jour</span>}
    </div>
  </div>;
}
