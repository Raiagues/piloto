import '../styles/features/auth.css';
import { ThemeToggle } from '../components/ThemeToggle';
import { useEffect, useState } from "react";
import { Compass, Eye, EyeOff, KeyRound, LockKeyhole, RefreshCw, ShieldCheck } from "lucide-react";
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
  const [error, setError] = useState("");

  useEffect(() => {
    const navigate = () => { setMode(routeMode()); setError(""); setShowPassword(false); };
    window.addEventListener("hashchange", navigate);
    return () => window.removeEventListener("hashchange", navigate);
  }, []);

  const joinParameters = new URLSearchParams(window.location.hash.split("?")[1] || "");
  const invitationSignup = window.location.hash.startsWith('#/join')
    || (window.location.hash.startsWith('#/invitations') && Boolean(joinParameters.get('invite') && joinParameters.get('token')));

  const c = language === "pt" ? {
    loginTitle: "Entrar no Norte",
    registerTitle: "Criar sua conta",
    name: "Nome",
    login: "Login",
    password: "Senha",
    passwordHint: "8 caracteres ou mais.",
    showPassword: "Mostrar senha",
    hidePassword: "Ocultar senha",
    creating: "Criando conta…",
    entering: "Entrando…",
    weakPassword: "Escolha uma senha com 8 caracteres ou mais.",
    loginExists: "Esse login já está em uso. Escolha outro ou entre na sua conta.",
    invalidLogin: "Use de 3 a 30 letras, números, hífen ou sublinhado, sem espaços.",
    invalidCredentials: "Login ou senha incorretos.",
    emailExists: "Já existe uma conta com este e-mail. Use “Já tenho conta” para entrar.",
    enter: "Entrar",
    create: "Criar conta",
    noAccount: "Criar conta",
    hasAccount: "Já tenho conta",
    offlineTitle: "Serviço temporariamente indisponível",
    offlineText: "Tente novamente em alguns instantes.",
    retry: "Tentar novamente",
    loading: "Abrindo sessão segura"
  } : {
    loginTitle: "Sign in to Norte",
    registerTitle: "Create your account",
    name: "Name",
    login: "Username",
    password: "Password",
    passwordHint: "8 characters or more.",
    showPassword: "Show password",
    hidePassword: "Hide password",
    creating: "Creating account…",
    entering: "Signing in…",
    weakPassword: "Choose a password with 8 or more characters.",
    loginExists: "This username is already taken. Choose another or sign in to your account.",
    invalidLogin: "Use 3 to 30 letters, numbers, hyphens or underscores, without spaces.",
    invalidCredentials: "Incorrect username or password.",
    emailExists: "An account already uses this email. Select “I already have an account” to sign in.",
    enter: "Sign in",
    create: "Create account",
    noAccount: "Create account",
    hasAccount: "I already have an account",
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
    if (busy) return;
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      if (mode === "login") {
        await auth.login(String(data.get("login") || ""), String(data.get("password") || ""));
      } else {
        await auth.register({
          name: String(data.get("name") || ""),
          login: String(data.get("login") || ""),
          ...(joinParameters.get("email") || invitationSignup ? { email: joinParameters.get("email") || String(data.get('invitationEmail') || '') } : {}),
          password: String(data.get("password") || "")
        });
      }
      if (/^#\/(?:login|register)/u.test(window.location.hash)) window.location.hash = "#/";
    } catch (reason) {
      const messages: Record<string, string> = { WEAK_PASSWORD: c.weakPassword, EMAIL_EXISTS: c.emailExists, LOGIN_EXISTS: c.loginExists, INVALID_LOGIN: c.invalidLogin, INVALID_CREDENTIALS: c.invalidCredentials };
      setError(reason instanceof ApiError ? messages[reason.code] || reason.message : (language === "pt" ? "Não foi possível concluir o acesso." : "Access could not be completed."));
    } finally {
      setBusy(false);
    }
  }



  if (auth.status === "loading") {
    return <div className="auth-status-screen"><Compass aria-hidden="true" /><span>{c.loading}</span></div>;
  }

  if (auth.status === "offline") {
    return (
      <div className="auth-status-screen auth-offline">
        <Compass aria-hidden="true" />
        <h1>{c.offlineTitle}</h1>
        <p>{c.offlineText}</p>
        <button onClick={() => void auth.refresh()}><RefreshCw aria-hidden="true" />{c.retry}</button>
      </div>
    );
  }

  return (
    <main className="auth-page">
      <header className="auth-header">
        <a className="auth-brand" href="#/landing" aria-label="Norte"><Compass aria-hidden="true" /><span>NORTE</span></a>
        <div className="auth-header-controls"><ThemeToggle language={language} /><LanguageToggle language={language} onChange={changeLanguage} /></div>
      </header>

      <section className="auth-layout">
        <form className="auth-form" key={mode} onSubmit={submit} aria-busy={busy}>
          <div className="auth-form-heading">
            <div className="auth-form-icon">{mode === "login" ? <KeyRound aria-hidden="true" /> : <LockKeyhole aria-hidden="true" />}</div>
            <h1>{mode === "login" ? c.loginTitle : c.registerTitle}</h1>
          </div>

          {window.location.hash.startsWith("#/invitations") && <p>{language === "pt" ? "Entre na sua conta para ver e responder aos convites." : "Sign in to view and respond to your invitations."}</p>}

          <div className="auth-fields auth-fields-simple">
            {mode === "register" && <label><span>{c.name}</span><input name="name" autoComplete="name" required minLength={2} maxLength={100} /></label>}
            <label><span>{c.login}</span><input name="login" type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} required minLength={3} maxLength={mode === "register" ? 30 : 254} pattern={mode === "register" ? "[A-Za-z0-9_\\-]{3,30}" : undefined} title={mode === "register" ? c.invalidLogin : undefined} /></label>
            {mode === "register" && joinParameters.get("email") && <label><span>{language === "pt" ? "E-mail do convite" : "Invitation email"}</span><input type="email" value={joinParameters.get("email")!} readOnly /></label>}
            {mode === "register" && invitationSignup && !joinParameters.get("email") && <label><span>{language === "pt" ? "E-mail do convite" : "Invitation email"}</span><input type="email" name="invitationEmail" autoComplete="email" autoCapitalize="none" spellCheck={false} required maxLength={254} /></label>}
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
          <button className="auth-submit" type="submit" disabled={busy}>{busy ? <RefreshCw className="auth-spinner" aria-hidden="true" /> : mode === "login" ? <KeyRound aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />}{busy ? mode === "login" ? c.entering : c.creating : mode === "login" ? c.enter : c.create}</button>
          <button className="auth-mode-switch" type="button" disabled={busy} onClick={() => { setMode((current) => current === "login" ? "register" : "login"); setError(""); setShowPassword(false); }}>{mode === "login" ? c.noAccount : c.hasAccount}</button>

          <nav className="auth-policy-links" aria-label={language === 'pt' ? 'Políticas' : 'Policies'}><a href="#/privacy">{language === 'pt' ? 'Privacidade' : 'Privacy'}</a><span aria-hidden="true"> · </span><a href="#/terms">{language === 'pt' ? 'Termos de uso' : 'Terms of use'}</a></nav>
        </form>
      </section>
    </main>
  );
}
