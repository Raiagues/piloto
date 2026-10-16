import { useEffect, useRef, useState } from "react";
import { BarChart3, Bell, Copy, Camera, Check, LoaderCircle, LogOut, Settings2, ShieldCheck, UsersRound, X, MessageSquare, CreditCard, Sun, Moon } from "lucide-react";
import { ApiError, useAuth } from "../lib/auth";
import { accessRoleLabel } from "../lib/team";
import type { Language } from "../lib/types";
import type { TeamMember, TeamRecord } from "../lib/team";
import { useTheme } from "../lib/theme";

type Props = {
  connectedLabel: string;
  compact?: boolean;
  language?: Language;
  canManageTeams?: boolean;
};

function avatarData(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/") || file.size > 8 * 1024 * 1024) {
      reject(new Error("INVALID_IMAGE"));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("INVALID_IMAGE"));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("INVALID_IMAGE"));
      image.onload = () => {
        const size = Math.min(image.naturalWidth, image.naturalHeight);
        const canvas = document.createElement("canvas");
        canvas.width = 320;
        canvas.height = 320;
        const context = canvas.getContext("2d");
        if (!context) return reject(new Error("INVALID_IMAGE"));
        context.drawImage(image, (image.naturalWidth - size) / 2, (image.naturalHeight - size) / 2, size, size, 0, 0, 320, 320);
        resolve(canvas.toDataURL("image/jpeg", .82));
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export function UserBadge({ connectedLabel, compact = false, canManageTeams = false, language: preferredLanguage }: Props) {
  const auth = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { user, logout, isDemo } = auth;
  const [invitationCount, setInvitationCount] = useState(0);
  const [nickname, setNickname] = useState(user?.nickname || "");
  const [open, setOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profile, setProfile] = useState<TeamMember | null>(null);
  const [teams, setTeams] = useState<TeamRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const language = preferredLanguage || (document.documentElement.lang.startsWith("en") ? "en" : "pt");

  useEffect(() => {
    function close(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, []);

  useEffect(() => {
    if (!user || isDemo) return;
    let active = true;
    const load = () => { void auth.api<{ invitations: unknown[] }>("/invitations").then(r => { if (active) setInvitationCount(r.invitations.length); }).catch(() => undefined); };
    load(); const timer = window.setInterval(load, 45_000);
    window.addEventListener("norte-invitations-changed", load);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener("norte-invitations-changed", load); };
  }, [auth.api, user, isDemo]);

  async function openProfile() {
    setOpen(false);
    setProfileOpen(true);
    setNickname(user?.nickname || "");
    setError("");
    try {
      const [profileResponse, teamResponse] = await Promise.all([
        auth.api<{ profile: TeamMember }>("/profile"),
        auth.api<{ teams: TeamRecord[] }>("/teams")
      ]);
      setProfile(profileResponse.profile);
      setTeams(teamResponse.teams.filter((team) => team.membership === "member" || team.memberIds.includes(user?.memberId || "")));
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : (language === "pt" ? "Não foi possível abrir o perfil." : "The profile could not be opened."));
    }
  }

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile) return;
    setBusy(true);
    setError("");
    try {
      const response = await auth.api<{ profile: TeamMember }>("/profile", {
        method: "PATCH",
        body: JSON.stringify({
          displayName: profile.displayName,
          ...(nickname ? { nickname } : {}),
          institution: profile.institution,
          course: profile.course,
          academicStage: profile.academicStage,
          availabilityHours: profile.availabilityHours,
          avatarUrl: profile.avatarUrl || ""
        })
      });
      setProfile(response.profile);
      await auth.refresh();
      setProfileOpen(false);
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : (language === "pt" ? "Não foi possível salvar o perfil." : "The profile could not be saved."));
    } finally {
      setBusy(false);
    }
  }

  async function selectAvatar(file: File | undefined) {
    if (!file || !profile) return;
    try {
      const avatarUrl = await avatarData(file);
      setProfile({ ...profile, avatarUrl });
    } catch {
      setError(language === "pt" ? "Escolha uma imagem JPG, PNG ou WebP de até 8 MB." : "Choose a JPG, PNG, or WebP image up to 8 MB.");
    }
  }

  if (!user) return null;

  const avatar = profile?.avatarUrl || user.avatarUrl;

  return (
    <>
      <div className={compact ? "user-badge compact account-badge" : "user-badge account-badge"} ref={rootRef} onKeyDown={e => { if (e.key === "Escape") { setOpen(false); e.stopPropagation(); } }}>
        <button className="theme-toggle" type="button" onClick={toggleTheme} aria-label={language === "pt" ? `Ativar tema ${theme === "dark" ? "claro" : "escuro"}` : `Use ${theme === "dark" ? "light" : "dark"} theme`} title={language === "pt" ? `Tema ${theme === "dark" ? "claro" : "escuro"}` : `${theme === "dark" ? "Light" : "Dark"} theme`}>{theme === "dark" ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}</button>
        <button className="invitation-bell" type="button" aria-label={`${language === "pt" ? "Convites" : "Invitations"} (${invitationCount})`} onClick={() => { window.location.hash = "#/invitations"; }}><Bell size={18} />{invitationCount > 0 && <span>{invitationCount}</span>}</button>
        <button className="account-badge-trigger" type="button" onClick={() => setOpen((current) => !current)} aria-expanded={open} aria-label={user.name}>
          <div className={avatar ? "avatar has-photo" : "avatar"}>{avatar ? <img src={avatar} alt="" /> : user.initials}</div>
          {!compact && <div className="user-copy"><div className="user-name">{user.name}</div><div className="user-state"><span className="online-dot" />{connectedLabel}</div></div>}
        </button>
        {open && (
          <div className="account-menu">
            <div className="account-menu-head"><ShieldCheck aria-hidden="true" /><div><strong>{user.name}</strong><span>{user.email}</span></div></div>
            {user.nickname && <button type="button" onClick={() => { void navigator.clipboard.writeText(user.nickname!).catch(() => undefined); }}><Copy size={16} />@{user.nickname}</button>}
            <button type="button" onClick={() => { setOpen(false); window.location.hash = "#/invitations"; }}><Bell size={16} />{language === "pt" ? "Convites" : "Invitations"} ({invitationCount})</button>
            <div className="account-menu-role">{isDemo ? (language === "pt" ? "Conta de teste · ambiente isolado" : "Test account · isolated workspace") : accessRoleLabel(user.accessRole, language)}</div>
            <button type="button" onClick={() => void openProfile()}><Settings2 aria-hidden="true" />{language === "pt" ? "Ver e editar perfil" : "View and edit profile"}</button>
            <button type="button" onClick={() => { setOpen(false); window.location.hash = "#/people"; }}><UsersRound aria-hidden="true" />{language === "pt" ? "Pessoas na plataforma" : "People on Norte"}</button>
            <button type="button" onClick={() => { setOpen(false); window.location.hash = "#/messages"; }}><MessageSquare aria-hidden="true" />{language === "pt" ? "Mensagens" : "Messages"}</button>
            <button type="button" onClick={() => { setOpen(false); window.location.hash = "#/plans"; }}><CreditCard aria-hidden="true" />{language === "pt" ? "Planos e contratação" : "Plans and subscriptions"}</button>
            <button type="button" onClick={() => { setOpen(false); window.location.hash = "#/teams"; }}><UsersRound aria-hidden="true" />{language === "pt" ? "Minhas equipes" : "My teams"}</button>
            {canManageTeams && <button type="button" onClick={() => { setOpen(false); window.location.hash = '#/dashboard'; }}><BarChart3 />{language === 'pt' ? 'Painel da equipe' : 'Team dashboard'}</button>}
            {user.accessRole === 'owner_admin' && !isDemo && <button type="button" onClick={() => { setOpen(false); window.location.hash = '#/admin/users'; }}><ShieldCheck />{language === 'pt' ? 'Administrar usuários' : 'Manage users'}</button>}
            {!isDemo && <button type="button" onClick={() => void logout()}><LogOut aria-hidden="true" />{language === "pt" ? "Sair" : "Sign out"}</button>}
          </div>
        )}
      </div>

      {profileOpen && <div className="profile-dialog-backdrop" role="presentation" onPointerDown={() => setProfileOpen(false)}>
        <section className="profile-dialog" role="dialog" aria-modal="true" aria-labelledby="profile-dialog-title" onPointerDown={(event) => event.stopPropagation()}>
          <header><div><span>{language === "pt" ? "CONTA" : "ACCOUNT"}</span><h2 id="profile-dialog-title">{language === "pt" ? "Seu perfil" : "Your profile"}</h2></div><button type="button" onClick={() => setProfileOpen(false)} aria-label={language === "pt" ? "Fechar" : "Close"}><X aria-hidden="true" /></button></header>
          {!profile ? <div className="profile-loading">{error || <LoaderCircle aria-hidden="true" />}</div> : <form onSubmit={(event) => void saveProfile(event)}>
            <div className="profile-avatar-editor">
              <div>{profile.avatarUrl ? <img src={profile.avatarUrl} alt="" /> : user.initials}</div>
              <label><Camera aria-hidden="true" /><span>{language === "pt" ? "Escolher foto" : "Choose photo"}</span><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void selectAvatar(event.target.files?.[0])} /></label>
            </div>
            <div className="profile-fields">
              <label><span>{language === "pt" ? "Nome" : "Name"}</span><input value={profile.displayName} required maxLength={100} onChange={(event) => setProfile({ ...profile, displayName: event.target.value })} /></label>
              <label><span>Nickname</span><input value={nickname} minLength={3} maxLength={30} pattern="[A-Za-z][A-Za-z0-9_]{2,29}" onChange={e => setNickname(e.target.value)} /><small>{language === "pt" ? "Identificador público único para receber convites." : "Unique public identifier for invitations."}</small></label>
              <label><span>E-mail</span><input value={profile.email} readOnly /></label>
              <label><span>{language === "pt" ? "Universidade" : "University"}</span><input value={profile.institution} maxLength={160} onChange={(event) => setProfile({ ...profile, institution: event.target.value })} /></label>
              <label><span>{language === "pt" ? "Curso" : "Course"}</span><input value={profile.course} maxLength={120} onChange={(event) => setProfile({ ...profile, course: event.target.value })} /></label>
              <label><span>{language === "pt" ? "Semestre" : "Semester"}</span><input value={profile.academicStage} maxLength={80} onChange={(event) => setProfile({ ...profile, academicStage: event.target.value })} /></label>
              <label><span>{language === "pt" ? "Horas disponíveis por semana" : "Available hours per week"}</span><input type="number" min={0} max={80} value={profile.availabilityHours} onChange={(event) => setProfile({ ...profile, availabilityHours: Number(event.target.value) })} /></label>
            </div>
            <section className="profile-teams"><span>{language === "pt" ? "EQUIPES ASSOCIADAS" : "ASSOCIATED TEAMS"}</span><div>{teams.map((team) => <button type="button" key={team.id} onClick={() => { setProfileOpen(false); window.location.hash = "#/teams"; }}><UsersRound aria-hidden="true" /><strong>{team.name}</strong></button>)}{teams.length === 0 && <p>{language === "pt" ? "Você ainda não participa de uma equipe." : "You are not part of a team yet."}</p>}</div></section>
            {error && <p className="profile-error" role="alert">{error}</p>}
            <footer><button type="button" onClick={() => setProfileOpen(false)}>{language === "pt" ? "Preencher depois" : "Complete later"}</button><button className="primary" type="submit" disabled={busy}>{busy ? <LoaderCircle className="profile-spin" aria-hidden="true" /> : <Check aria-hidden="true" />}{language === "pt" ? "Salvar perfil" : "Save profile"}</button></footer>
          </form>}
        </section>
      </div>}
    </>
  );
}
