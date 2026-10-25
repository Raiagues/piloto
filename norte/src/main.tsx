import './styles/index.css';
import { StrictMode, Suspense, lazy, useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { AuthProvider, useAuth } from "./lib/auth";
import { PageBoundary } from './components/PageBoundary';
import { UsageTelemetry } from "./lib/usageTelemetry";
import { applyTheme, getStoredTheme, ThemeProvider } from "./lib/theme";

const App = lazy(() => import('./App').then(module => ({ default: module.App })));
const AuthPage = lazy(() => import('./pages/AuthPage').then(module => ({ default: module.AuthPage })));
const LandingPage = lazy(() => import('./pages/LandingPage').then(module => ({ default: module.LandingPage })));
const PolicyPage = lazy(() => import('./pages/PolicyPage').then(module => ({ default: module.PolicyPage })));

applyTheme(getStoredTheme());

function Root() {
  const auth = useAuth();
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => { const change = () => setHash(window.location.hash); window.addEventListener("hashchange", change); return () => window.removeEventListener("hashchange", change); }, []);
  const policy = hash === '#/privacy' ? 'privacy' : hash === '#/terms' ? 'terms' : undefined;
  const landing = hash === '#/landing' || auth.status === 'anonymous' && ['', '#/', '#'].includes(hash);
  useEffect(() => { document.body.classList.toggle("public-view", auth.status !== "authenticated" || landing || Boolean(policy)); return () => document.body.classList.remove("public-view"); }, [auth.status, landing, policy]);
  const page = policy ? <PolicyPage kind={policy} /> : landing && auth.status !== 'loading' ? <LandingPage /> : auth.status === "authenticated" ? <App /> : <AuthPage />;
  return <><UsageTelemetry /><PageBoundary route={hash}><Suspense fallback={<div className="auth-status-screen" role="status">Carregando…</div>}>{page}</Suspense></PageBoundary></>;
}

const root = document.getElementById("root");

if (!root) throw new Error("Norte root element was not found.");

createRoot(root).render(
  <StrictMode>
    <ThemeProvider><AuthProvider>
      <Root />
    </AuthProvider></ThemeProvider>
  </StrictMode>
);
