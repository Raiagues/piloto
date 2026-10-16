import { ThemeToggle } from '../components/ThemeToggle';
import { useEffect, useState } from "react";
import { Compass, KeyRound, LockKeyhole, RadioTower, RefreshCw, ShieldCheck } from "lucide-react";
import { LanguageToggle } from "../components/LanguageToggle";
import { ApiError, useAuth } from "../lib/auth";
import { getStoredLanguage, setStoredLanguage } from "../lib/i18n";
import type { Language } from "../lib/types";

type Mode = "login" | "register";

export function AuthPage() {
  const auth = useAuth();
  const [language, setLanguage] = useState<Language>(getStoredLanguage);
  const [mode, setMode] = useState<Mode>("login");
  const [busy, setBusy] = useState(false);
  const [demoBusy, setDemoBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setMode((window.location.hash.startsWith("#/join?") || window.location.hash.startsWith("#/register")) ? "register" : auth.hasOwner ? "login" : "register");
  }, [auth.hasOwner]);

  const joinParameters = new URLSearchParams(window.location.hash.split("?")[1] || "");

  const c = language === "pt" ? {
    loginTitle: "Entrar no Norte",
    registerTitle: "Criar sua conta",
    firstAccount: "A primeira conta deste ambiente recebe a administração inicial.",
    bootstrapLabel: "Código de configuração inicial",
    bootstrapHint: "Somente o responsável pela instalação precisa deste código, disponível nas configurações privadas do servidor.",
    bootstrapUnavailable: "A instalação ainda precisa do código inicial configurado no servidor. Fale com o responsável pela publicação do site.",
    name: "Nome completo",
    email: "E-mail",
    password: "Senha",
    passwordHint: "Use uma frase com pelo menos 15 caracteres.",
    enter: "Entrar",
    create: "Criar conta",
    noAccount: "Criar conta",
    hasAccount: "Já tenho conta",
    demoDivider: "ou",
    demoEnter: auth.demoResumeAvailable ? "Retomar conta de teste" : "Explorar com conta de teste",
    demoHint: "Documentos e mapa ficam salvos por 30 dias após o último acesso. Volte neste mesmo navegador, sem limpar os cookies. Para projetos permanentes ou outros dispositivos, use uma conta cadastrada.",
    demoError: "Não foi possível abrir a conta de teste agora.",
    offlineTitle: "Serviço temporariamente indisponível",
    offlineText: "Tente novamente em alguns instantes.",
    retry: "Tentar novamente",
    loading: "Abrindo sessão segura"
  } : {
    loginTitle: "Sign in to Norte",
    registerTitle: "Create your account",
    firstAccount: "The first account in this environment receives initial administration.",
    bootstrapLabel: "Initial setup code",
    bootstrapHint: "Only the person setting up this installation needs this code, available in the server's private settings.",
    bootstrapUnavailable: "The initial setup code must be configured on the server. Contact the person deploying this site.",
    name: "Full name",
    email: "Email",
    password: "Password",
    passwordHint: "Use a passphrase with at least 15 characters.",
    enter: "Sign in",
    create: "Create account",
    noAccount: "Create account",
    hasAccount: "I already have an account",
    demoDivider: "or",
    demoEnter: auth.demoResumeAvailable ? "Resume test account" : "Explore with a test account",
    demoHint: "Documents and the map are saved for 30 days after your last visit. Return in this browser without clearing cookies. Use a registered account for permanent projects or other devices.",
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
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      if (mode === "login") {
        await auth.login(String(data.get("email") || ""), String(data.get("password") || ""));
      } else {
        await auth.register({
          name: String(data.get("name") || ""),
          nickname: String(data.get("nickname") || ""),
          email: String(data.get("email") || ""),
          password: String(data.get("password") || ""),
          ...(auth.bootstrapRequired ? { bootstrapToken: String(data.get("bootstrapToken") || "").trim() } : {})
        });
      }
      if (/^#\/(?:login|register)/u.test(window.location.hash)) window.location.hash = joinParameters.get("return") === "plans" ? "#/plans" : "#/";
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.code === "BOOTSTRAP_UNAVAILABLE" ? c.bootstrapUnavailable : reason.message : (language === "pt" ? "Não foi possível concluir o acesso." : "Access could not be completed."));
      if (reason instanceof ApiError && reason.code === "BOOTSTRAP_COMPLETE") void auth.refresh();
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
        <div className="auth-context">
          <h1>NORTE</h1>
          <p>{language === "pt" ? "Um lugar para conectar as decisões do seu projeto." : "A place to connect your project's decisions."}</p>
          <small>{language === "pt" ? "Documentos, arquitetura, requisitos e reuniões — organizados com sua equipe." : "Documents, architecture, requirements and meetings — organized with your team."}</small>
        </div>

        <form className="auth-form" onSubmit={submit}>
          <div className="auth-form-heading">
            <div className="auth-form-icon">{mode === "login" ? <KeyRound aria-hidden="true" /> : <LockKeyhole aria-hidden="true" />}</div>
            <div><span>{mode === "login" ? "LOGIN" : "ACCOUNT"}</span><h2>{mode === "login" ? c.loginTitle : c.registerTitle}</h2></div>
          </div>

          {window.location.hash.startsWith("#/invitations") && <p>{language === "pt" ? "Entre ou crie uma conta com o email que recebeu o convite. Você poderá verificar o email e decidir se deseja participar." : "Sign in or register with the invited email. You can verify the address and choose whether to join."}</p>}
          {mode === "register" && !auth.hasOwner && <p className="auth-owner-note">{c.firstAccount}</p>}

          <div className="auth-fields auth-fields-simple">
            {mode === "register" && <label><span>{c.name}</span><input name="name" autoComplete="name" required minLength={2} maxLength={100} /></label>}
            {mode === "register" && <label><span>Nickname</span><input name="nickname" autoComplete="username" required minLength={3} maxLength={30} pattern="[A-Za-z][A-Za-z0-9_]{2,29}" /><small>{language === "pt" ? "Seu identificador público único: 3 a 30 letras, números ou sublinhado." : "Your unique public identifier: 3–30 letters, numbers or underscores."}</small></label>}
            <label><span>{c.email}</span><input name="email" type="email" autoComplete="email" required maxLength={254} defaultValue={mode === "register" ? joinParameters.get("email") || "" : ""} /></label>
            <label><span>{c.password}</span><input name="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={mode === "login" ? 1 : 15} maxLength={128} /><small>{mode === "register" ? c.passwordHint : ""}</small></label>
            {mode === "register" && auth.bootstrapRequired && <label><span>{c.bootstrapLabel}</span><input name="bootstrapToken" type="password" autoComplete="off" required minLength={32} maxLength={512} spellCheck={false} /><small>{c.bootstrapHint}</small></label>}
          </div>

          {error && <div className="auth-error" role="alert">{error}</div>}
          <button className="auth-submit" type="submit" disabled={busy}>{busy ? <RefreshCw className="auth-spinner" aria-hidden="true" /> : mode === "login" ? <KeyRound aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />}{mode === "login" ? c.enter : c.create}</button>
          <button className="auth-mode-switch" type="button" onClick={() => { setMode((current) => current === "login" ? "register" : "login"); setError(""); }}>{mode === "login" ? c.noAccount : c.hasAccount}</button>
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
