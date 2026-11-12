'use client';
import { useEffect, useState } from 'react';
import { LayoutDashboard, SlidersHorizontal, ArrowUpRight, LogOut, ShieldCheck, Sprout, X, LockKeyhole } from 'lucide-react';
import { demo } from '@/lib/demo';
import { emptyPortfolio, loadPortfolio, savePortfolio, supabase } from '@/lib/supabase';
import type { Portfolio } from '@/lib/portfolio';
import MarketPanel from './MarketPanel';
export default function App() {
  const [data, setData] = useState<Portfolio | null>(null);
  const [isDemo, setIsDemo] = useState(false);
  const [tab, setTab] = useState<'dashboard' | 'editor'>('dashboard');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [user, setUser] = useState<string | null>(null);
  const [login, setLogin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!supabase) { setData(structuredClone(demo)); setIsDemo(true); setLoading(false); return; }
    let active = true;
    let request = 0;
    const client = supabase;
    async function refresh() {
      const revision = ++request;
      const { data: session, error: authError } = await client.auth.getSession();
      if (!active || revision !== request) return;
      if (authError) { setError(authError.message); setLoading(false); return; }
      if (!session.session) { setUser(null); setData(null); setIsDemo(false); setLoading(false); return; }
      setUser(session.session.user.email || 'Compte personnel');
      try { const portfolio = await loadPortfolio(); if (active && revision === request) { setData(portfolio || structuredClone(emptyPortfolio)); setIsDemo(false); } }
      catch (e) { if (active && revision === request) setError(e instanceof Error ? e.message : String(e)); }
      finally { if (active && revision === request) setLoading(false); }
    }
    void refresh();
    const { data: listener } = client.auth.onAuthStateChange(() => { void refresh(); });
    return () => { active = false; listener.subscription.unsubscribe(); };
  }, []);
  async function signIn(e: React.FormEvent) {
    e.preventDefault(); if (!supabase) return;
    setLoading(true); setError('');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setPassword(''); setLoading(false);
    if (error) setError(error.message); else setLogin(false);
  }
  async function save(next: Portfolio) { if (!isDemo) await savePortfolio(next); setData(structuredClone(next)); }
  async function signOut() {
    if (supabase && user) { const { error } = await supabase.auth.signOut(); if (error) { setError(error.message); return; } }
    setData(null); setUser(null); setIsDemo(false); setTab('dashboard');
  }
  return <div className="app-shell"><aside className="sidebar"><a className="brand" href="#" aria-label="FinancIAl accueil"><div className="brand-icon"><Sprout size={22} /></div>Financ<span>IAl</span><i /></a><div className="workspace-label">ESPACE PERSONNEL</div><nav aria-label="Navigation principale"><button className={tab === 'dashboard' ? 'nav-item active' : 'nav-item'} onClick={() => setTab('dashboard')}><LayoutDashboard size={19} />Vue d’ensemble<span>↗</span></button><button className={tab === 'editor' ? 'nav-item active' : 'nav-item'} onClick={() => setTab('editor')}><SlidersHorizontal size={19} />Saisie des données</button></nav><div className="sidebar-bottom"><div className="sidebar-note"><span className="mini-icon"><ShieldCheck size={18} /></span><strong>Ton argent. Tes données.</strong><p>{isDemo ? 'Explore avec des données fictives. Aucune donnée personnelle exposée.' : 'Un espace privé, protégé par Supabase.'}</p></div><div className="profile"><div className="avatar">{isDemo ? 'D' : 'F'}</div><div><strong>{isDemo ? 'Démonstration' : 'Mon espace'}</strong><small>{isDemo ? 'Données fictives' : 'Portefeuille personnel'}</small></div></div></div></aside>
    <div className="main-wrapper"><header className="topbar"><span>Mon espace <b>/</b> <strong>{tab === 'dashboard' ? 'Vue d’ensemble' : 'Saisie des données'}</strong></span><div className="topbar-actions"><span className="private"><LockKeyhole size={12} />{isDemo ? 'Mode démo' : 'Espace privé'}</span>{user || isDemo ? <button className="icon-button" onClick={() => void signOut()} aria-label="Quitter la session"><LogOut size={17} /></button> : null}{isDemo && supabase && <button className="button small" onClick={() => setLogin(true)}>Se connecter</button>}</div></header>
    <main>{error && <div className="alert" role="alert">{error}<button className="icon-button" aria-label="Fermer l’erreur" onClick={() => setError('')}><X size={15} /></button></div>}{loading && !data ? <div className="empty panel">Chargement de ton espace…</div> : data ? <>{isDemo && <div className="demo-banner"><span className="status-dot" />DÉMONSTRATION <span>Des données fictives pour explorer ton futur tableau de bord.</span></div>}<MarketPanel key={isDemo ? 'demo' : user} data={data} onSave={save} demo={isDemo} tab={tab} /></> : <section className="welcome panel"><div className="welcome-icon"><Sprout size={38} /></div><div className="eyebrow">BIENVENUE DANS TON ESPACE</div><h1>Ton patrimoine.<br />Une vision plus claire<span>.</span></h1><p>Rassemble tes placements, suis leur évolution et avance vers tes objectifs. Simplement.</p><div className="actions"><button className="button" onClick={() => setLogin(true)}>Accéder à mon portefeuille<ArrowUpRight size={17} /></button><button className="button secondary" onClick={() => { setData(structuredClone(demo)); setIsDemo(true); }}>Explorer la démo</button></div></section>}<footer><span>FinancIAl <i>·</i> Une vision à long terme.</span><span><ShieldCheck size={12} />{isDemo ? 'Données de démonstration' : 'Données privées · Supabase'}</span></footer></main></div>
    {login && <div className="modal-backdrop"><section className="modal panel" role="dialog" aria-modal="true" aria-labelledby="login-title"><button className="modal-close icon-button" onClick={() => { setLogin(false); setPassword(''); }} aria-label="Fermer la connexion"><X size={20} /></button><LockKeyhole className="lime" size={28} /><h2 id="login-title">Ton espace personnel</h2>{supabase ? <form onSubmit={signIn}><p className="muted">Connecte-toi avec le compte créé dans Supabase.</p><label>Adresse e-mail<input type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} /></label><label>Mot de passe<input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></label>{error && <p role="alert" className="negative">{error}</p>}<button className="button" disabled={loading}>{loading ? 'Connexion…' : 'Se connecter'}</button></form> : <p>Supabase n’est pas encore configuré. Renseigne les variables de <code>.env.local</code> puis redémarre l’application. Le README détaille la configuration.</p>}</section></div>}
  </div>;
}
