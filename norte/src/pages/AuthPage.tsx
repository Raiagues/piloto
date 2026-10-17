import { ThemeToggle } from '../components/ThemeToggle';
import { useEffect, useState } from "react";
import { Compass, Eye, EyeOff, KeyRound, LockKeyhole, RadioTower, RefreshCw, ShieldCheck } from "lucide-react";
import { LanguageToggle } from "../components/LanguageToggle";
import { ApiError, useAuth } from "../lib/auth";
import { getStoredLanguage, setStoredLanguage } from "../lib/i18n";
import type { Language } from "../lib/types";

type Mode = "login" | "register";
const routeMode = (): Mode => /^#\/(?:join\?|register)/u.test(window.location.hash) ? "register" : "login";

export function AuthPage() {
  const auth = useAuth();
  const [language, setLanguage] = useState<Language>(getStoredLanguage);
  const [mode, setMode] = useState<Mode>(routeMode);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [demoBusy, setDemoBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const navigate = () => { setMode(routeMode()); setError(""); setShowPassword(false); };
    window.addEventListener("hashchange", navigate);
    return () => window.removeEventListener("hashchange", navigate);
  }, []);

  const joinParameters = new URLSearchParams(window.location.hash.split("?")[1] || "");

  const c = language === "pt" ? {
    loginTitle: "Entrar no Norte",
    registerTitle: "Criar sua conta",
    name: "Nome",
    email: "E-mail",
    password: "Senha",
    passwordHint: "8 caracteres ou mais.",
    showPassword: "Mostrar senha",
    hidePassword: "Ocultar senha",
    creating: "Criando conta…",
    entering: "Entrando…",
    weakPassword: "Escolha uma senha com 8 caracteres ou mais, evitando senhas muito comuns.",
    emailExists: "Já existe uma conta com este e-mail. Use “Já tenho conta” para entrar.",
    enter: "Entrar",
    create: "Criar conta",
    noAccount: "Criar conta",
    hasAccount: "Já tenho conta",
    demoDivider: "ou",
    demoEnter: auth.demoResumeAvailable ? "Retomar conta de teste" : "Explorar com conta de teste",
    demoHint: "A conta de teste fica salva neste navegador por 30 dias após o último acesso.",
    demoError: "Não foi possível abrir a conta de teste agora.",
    offlineTitle: "Serviço temporariamente indisponível",
    offlineText: "Tente novamente em alguns instantes.",
    retry: "Tentar novamente",
    loading: "Abrindo sessão segura"
  } : {
    loginTitle: "Sign in to Norte",
    registerTitle: "Create your account",
    name: "Name",
    email: "Email",
    password: "Password",
    passwordHint: "8 characters or more.",
    showPassword: "Show password",
    hidePassword: "Hide password",
    creating: "Creating account…",
    entering: "Signing in…",
    weakPassword: "Choose a password with 8 or more characters, avoiding very common passwords.",
    emailExists: "An account already uses this email. Select “I already have an account” to sign in.",
    enter: "Sign in",
    create: "Create account",
    noAccount: "Create account",
    hasAccount: "I already have an account",
    demoDivider: "or",
    demoEnter: auth.demoResumeAvailable ? "Resume test account" : "Explore with a test account",
    demoHint: "The test account is saved in this browser for 30 days after your last visit.",
    demoError: "The test account could not be opened right now.",
    offlineTitle: "Service temporarily unavailable",
    offlineText: "Try again in a few moments.",
    retry: "Try again",
    loading: "Opening secure session"
  };

  function changeLanguage(next: Language) {
    setLanguage(next);
    setStoredLanguage(next);
    document.documentElement.lang = next === "pt" ? "pt-BR" : "en";
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || demoBusy) return;
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      if (mode === "login") {
        await auth.login(String(data.get("email") || ""), String(data.get("password") || ""));
      } else {
        await auth.register({
          name: String(data.get("name") || ""),
          email: String(data.get("email") || ""),
          password: String(data.get("password") || "")
        });
      }
      if (/^#\/(?:login|register)/u.test(window.location.hash)) window.location.hash = joinParameters.get("return") === "plans" ? "#/plans" : "#/";
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.code === "WEAK_PASSWORD" ? c.weakPassword : reason.code === "EMAIL_EXISTS" ? c.emailExists : reason.message : (language === "pt" ? "Não foi possível concluir o acesso." : "Access could not be completed."));
    } finally {
      setBusy(false);
    }
  }

  async function openDemo() {
    setDemoBusy(true);
    setError("");
    try {
      await auth.loginDemo();
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : c.demoError);
    } finally {
      setDemoBusy(false);
    }
  }

  if (auth.status === "loading") {
    return <div className="auth-status-screen"><RadioTower aria-hidden="true" /><span>{c.loading}</span></div>;
  }

  if (auth.status === "offline") {
    return (
      <div className="auth-status-screen auth-offline">
        <RadioTower aria-hidden="true" />
        <h1>{c.offlineTitle}</h1>
        <p>{c.offlineText}</p>
        <button onClick={() => void auth.refresh()}><RefreshCw aria-hidden="true" />{c.retry}</button>
      </div>
    );
  }

  return (
    <main className="auth-page">
      <header className="auth-header">
        <a className="auth-brand" href="#/" aria-label="Norte"><RadioTower aria-hidden="true" /><span>NORTE</span></a>
        <div className="auth-header-controls"><ThemeToggle language={language} /><LanguageToggle language={language} onChange={changeLanguage} /></div>
      </header>

      <section className="auth-layout">
        <form className="auth-form" key={mode} onSubmit={submit} aria-busy={busy || demoBusy}>
          <div className="auth-form-heading">
            <div className="auth-form-icon">{mode === "login" ? <KeyRound aria-hidden="true" /> : <LockKeyhole aria-hidden="true" />}</div>
            <h1>{mode === "login" ? c.loginTitle : c.registerTitle}</h1>
          </div>

          {window.location.hash.startsWith("#/invitations") && <p>{language === "pt" ? "Entre ou crie uma conta com o email que recebeu o convite. Você poderá verificar o email e decidir se deseja participar." : "Sign in or register with the invited email. You can verify the address and choose whether to join."}</p>}

          <div className="auth-fields auth-fields-simple">
            {mode === "register" && <label><span>{c.name}</span><input name="name" autoComplete="name" required minLength={2} maxLength={100} /></label>}
            <label><span>{c.email}</span><input name="email" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} required maxLength={254} defaultValue={mode === "register" ? joinParameters.get("email") || "" : ""} /></label>
            <div className="auth-password-field">
              <label htmlFor="auth-password">{c.password}</label>
              <div className="auth-password-input">
                <input id="auth-password" name="password" type={showPassword ? "text" : "password"} autoComplete={mode === "login" ? "current-password" : "new-password"} spellCheck={false} required minLength={mode === "login" ? 1 : 8} maxLength={128} aria-describedby={mode === "register" ? "auth-password-hint" : undefined} />
                <button type="button" aria-label={showPassword ? c.hidePassword : c.showPassword} title={showPassword ? c.hidePassword : c.showPassword} onClick={() => setShowPassword(value => !value)}>{showPassword ? <EyeOff size={18} aria-hidden="true"/> : <Eye size={18} aria-hidden="true"/>}</button>
              </div>
              {mode === "register" && <small id="auth-password-hint">{c.passwordHint}</small>}
            </div>
          </div>

          {error && <div className="auth-error" role="alert">{error}</div>}
          <button className="auth-submit" type="submit" disabled={busy || demoBusy}>{busy ? <RefreshCw className="auth-spinner" aria-hidden="true" /> : mode === "login" ? <KeyRound aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />}{busy ? mode === "login" ? c.entering : c.creating : mode === "login" ? c.enter : c.create}</button>
          <button className="auth-mode-switch" type="button" disabled={busy || demoBusy} onClick={() => { setMode((current) => current === "login" ? "register" : "login"); setError(""); setShowPassword(false); }}>{mode === "login" ? c.noAccount : c.hasAccount}</button>
          {auth.demoAvailable && (
            <div className="auth-demo">
              <div className="auth-demo-divider"><span>{c.demoDivider}</span></div>
              <button className="auth-demo-enter" type="button" onClick={() => void openDemo()} disabled={busy || demoBusy}>{demoBusy ? <RefreshCw className="auth-spinner" aria-hidden="true" /> : <Compass aria-hidden="true" />}{c.demoEnter}</button>
              <small>{c.demoHint}</small>
            </div>
          )}
        </form>
      </section>
    </main>
  );
}
