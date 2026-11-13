'use client';
import { useEffect, useState } from 'react';
import { LayoutDashboard, SlidersHorizontal, ArrowUpRight, LogOut, ShieldCheck, Sprout, X, LockKeyhole } from 'lucide-react';
import { emptyPortfolio, loadPortfolio, savePortfolio, supabase } from '@/lib/supabase';
import type { Portfolio } from '@/lib/portfolio';
import { errorMessage } from '@/lib/errors';
import MarketPanel from './MarketPanel';
export default function App() {
  const [data, setData] = useState<Portfolio | null>(null);
  const [sidebar, setSidebar] = useState<HTMLDivElement | null>(null);
  const [tab, setTab] = useState<'dashboard' | 'editor'>('dashboard');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [user, setUser] = useState<string | null>(null);
  const [login, setLogin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    let active = true;
    let request = 0;
    const client = supabase;
    async function refresh() {
      const revision = ++request;
      try {
        const { data: session, error: authError } = await client.auth.getSession();
        if (!active || revision !== request) return;
        if (authError) throw authError;
        if (!session.session) { setUser(null); setData(null); setError(''); return; }
        setUser(session.session.user.email || 'Compte personnel');
        const portfolio = await loadPortfolio();
        if (active && revision === request) { setData(portfolio || structuredClone(emptyPortfolio)); setError(''); }
      }
      catch (e) { if (active && revision === request) setError(errorMessage(e)); }
      finally { if (active && revision === request) setLoading(false); }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 60 * 1000);
    const onFocus = () => { void refresh(); };
    window.addEventListener('focus', onFocus);
    const { data: listener } = client.auth.onAuthStateChange(() => { void refresh(); });
    return () => { active = false; listener.subscription.unsubscribe(); window.clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, []);
  async function signIn(e: React.FormEvent) {
    e.preventDefault(); if (!supabase) return;
    setLoading(true); setError('');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setPassword(''); setLoading(false);
    if (error) setError(errorMessage(error)); else setLogin(false);
  }
  async function save(next: Portfolio) { const updatedAt = await savePortfolio(next); setData({ ...structuredClone(next), updatedAt }); }
  async function signOut() {
    if (supabase && user) { const { error } = await supabase.auth.signOut(); if (error) { setError(errorMessage(error)); return; } }
    setData(null); setUser(null); setTab('dashboard');
  }
  return <div className="app-shell"><aside className="sidebar"><a className="brand" href="#" aria-label="FinancIAl accueil"><div className="brand-icon"><Sprout size={22} /></div>Financ<span>IAl</span><i /></a><div className="workspace-label">ESPACE PERSONNEL</div><nav aria-label="Navigation principale"><button className={tab === 'dashboard' ? 'nav-item active' : 'nav-item'} onClick={() => setTab('dashboard')}><LayoutDashboard size={19} />Vue d’ensemble<span>↗</span></button><button className={tab === 'editor' ? 'nav-item active' : 'nav-item'} onClick={() => setTab('editor')}><SlidersHorizontal size={19} />Saisie des données</button></nav><div className="sidebar-goals-slot" ref={setSidebar} /><div className="sidebar-bottom"><div className="profile"><div className="avatar">F</div><div><strong>{user || 'Mon espace'}</strong><small>Portefeuille personnel</small></div></div></div></aside>
    <div className="main-wrapper"><header className="topbar"><span>Mon espace <b>/</b> <strong>{tab === 'dashboard' ? 'Vue d’ensemble' : 'Saisie des données'}</strong></span><div className="topbar-actions"><span className="private"><LockKeyhole size={12} />Espace privé</span>{user ? <button className="icon-button" onClick={() => void signOut()} aria-label="Quitter la session"><LogOut size={17} /></button> : null}</div></header>
    <main>{error && <div className="alert" role="alert">{error}<button className="icon-button" aria-label="Fermer l’erreur" onClick={() => setError('')}><X size={15} /></button></div>}{loading && !data ? <div className="empty panel">Chargement de ton espace…</div> : data && user ? <MarketPanel key={user} data={data} onSave={save} tab={tab} sidebar={sidebar} /> : <section className="welcome panel"><div className="welcome-icon"><Sprout size={38} /></div><div className="eyebrow">BIENVENUE DANS TON ESPACE</div><h1>Ton patrimoine.<br />Une vision plus claire<span>.</span></h1><p>Rassemble tes placements, suis leur évolution et avance vers tes objectifs. Simplement.</p>{supabase ? <div className="actions"><button className="button" onClick={() => setLogin(true)}>Accéder à mon portefeuille<ArrowUpRight size={17} /></button></div> : <p role="alert">Configuration Supabase manquante. Renseigne les variables d’environnement pour accéder à ton portefeuille.</p>}</section>}<footer><span>FinancIAl <i>·</i> Une vision à long terme.</span><span><ShieldCheck size={12} />Données privées · Supabase</span></footer></main></div>
    {login && <div className="modal-backdrop"><section className="modal panel" role="dialog" aria-modal="true" aria-labelledby="login-title"><button className="modal-close icon-button" onClick={() => { setLogin(false); setPassword(''); }} aria-label="Fermer la connexion"><X size={20} /></button><LockKeyhole className="lime" size={28} /><h2 id="login-title">Ton espace personnel</h2>{supabase ? <form onSubmit={signIn}><p className="muted">Connecte-toi avec le compte créé dans Supabase.</p><label>Adresse e-mail<input type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} /></label><label>Mot de passe<input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></label>{error && <p role="alert" className="negative">{error}</p>}<button className="button" disabled={loading}>{loading ? 'Connexion…' : 'Se connecter'}</button></form> : <p>Supabase n’est pas encore configuré. Renseigne les variables de <code>.env.local</code> puis redémarre l’application. Le README détaille la configuration.</p>}</section></div>}
  </div>;
}
