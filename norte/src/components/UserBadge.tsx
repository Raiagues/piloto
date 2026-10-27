import '../styles/features/account.css';
import { useEffect, useRef, useState } from "react";
import { Bell, Copy, Camera, Check, LoaderCircle, LogOut, Settings2, ShieldCheck, UsersRound, ContactRound, Building2, ChevronDown, X, MessageSquare, Sun, Moon, LifeBuoy } from "lucide-react";
import { ApiError, useAuth } from "../lib/auth";
import { accessRoleLabel } from "../lib/team";
import type { Language } from "../lib/types";
import type { TeamMember, TeamRecord } from "../lib/team";
import { useTheme } from "../lib/theme";

type ProfileMembership = { teamId: string; teamName: string; roleName: string; functionName: string };

type Props = {
  connectedLabel: string;
  compact?: boolean;
  language?: Language;
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

export function UserBadge({ connectedLabel, compact = false, language: preferredLanguage }: Props) {
  const auth = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { user, logout } = auth;
  const [invitationCount, setInvitationCount] = useState(0);
  const [nickname, setNickname] = useState(user?.nickname || "");
  const [open, setOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profile, setProfile] = useState<TeamMember | null>(null);
  const [teams, setTeams] = useState<TeamRecord[]>([]);
  const [memberships, setMemberships] = useState<ProfileMembership[]>([]);
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
    if (!user) return;
    let active = true;
    const load = () => { void auth.api<{ invitations: unknown[] }>("/invitations").then(r => { if (active) setInvitationCount(r.invitations.length); }).catch(() => undefined); };
    load(); const timer = window.setInterval(load, 45_000);
    window.addEventListener("norte-invitations-changed", load);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener("norte-invitations-changed", load); };
  }, [auth.api, user]);

  async function openProfile() {
    setOpen(false);
    setProfileOpen(true);
    setNickname(user?.nickname || "");
    setError("");
    try {
      const [profileResponse, teamResponse] = await Promise.all([
        auth.api<{ profile: TeamMember; memberships?: ProfileMembership[] }>("/profile"),
        auth.api<{ teams: TeamRecord[] }>("/teams")
      ]);
      setProfile(profileResponse.profile);
      setMemberships(profileResponse.memberships || []);
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
            <div className="account-menu-role">{accessRoleLabel(user.accessRole, language)}</div>
            <button type="button" onClick={() => void openProfile()}><Settings2 aria-hidden="true" />{language === "pt" ? "Ver e editar perfil" : "View and edit profile"}</button>
            <button type="button" onClick={() => { setOpen(false); window.location.hash = "#/people"; }}><ContactRound aria-hidden="true" />{language === "pt" ? "Pessoas" : "People"}</button>
            <button type="button" onClick={() => { setOpen(false); window.location.hash = "#/messages"; }}><MessageSquare aria-hidden="true" />{language === "pt" ? "Mensagens" : "Messages"}</button>
            <button type="button" onClick={() => { setOpen(false); window.location.hash = "#/teams"; }}><UsersRound aria-hidden="true" />{language === "pt" ? "Minhas equipes" : "My teams"}</button>
            <button type="button" className="account-menu-theme" onClick={() => { setOpen(false); toggleTheme(); }}>{theme === "dark" ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}{language === "pt" ? (theme === "dark" ? "Usar tema claro" : "Usar tema escuro") : (theme === "dark" ? "Use light theme" : "Use dark theme")}</button>
            <button type="button" onClick={() => { setOpen(false); window.dispatchEvent(new Event("norte:open-chat")); }}><LifeBuoy aria-hidden="true" />{language === "pt" ? "Ajuda e feedback" : "Help and feedback"}</button>
            {user.accessRole === 'owner_admin' && <button type="button" onClick={() => { setOpen(false); window.location.hash = '#/admin/users'; }}><ShieldCheck />{language === 'pt' ? 'Administrar usuários' : 'Manage users'}</button>}
            {<button type="button" onClick={() => void logout()}><LogOut aria-hidden="true" />{language === "pt" ? "Sair" : "Sign out"}</button>}
          </div>
        )}
      </div>

      {profileOpen && <div className="profile-dialog-backdrop" role="presentation" onPointerDown={() => setProfileOpen(false)}>
        <section className="profile-dialog" role="dialog" aria-modal="true" aria-labelledby="profile-dialog-title" onPointerDown={(event) => event.stopPropagation()}>
          <header><div><h2 id="profile-dialog-title">{language === "pt" ? "Seu perfil" : "Your profile"}</h2></div><button type="button" onClick={() => setProfileOpen(false)} aria-label={language === "pt" ? "Fechar" : "Close"}><X aria-hidden="true" /></button></header>
          {!profile ? <div className="profile-loading">{error || <LoaderCircle aria-hidden="true" />}</div> : <form onSubmit={(event) => void saveProfile(event)}>
            <div className="profile-avatar-editor">
              <div>{profile.avatarUrl ? <img src={profile.avatarUrl} alt="" /> : user.initials}</div>
              <label><Camera aria-hidden="true" /><span>{language === "pt" ? "Escolher foto" : "Choose photo"}</span><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void selectAvatar(event.target.files?.[0])} /></label>
            </div>
            <div className="profile-fields">
              <label><span>{language === "pt" ? "Nome" : "Name"}</span><input value={profile.displayName} required maxLength={100} onChange={(event) => setProfile({ ...profile, displayName: event.target.value })} /></label>
              <label><span>Nickname</span><input value={nickname} minLength={3} maxLength={30} pattern="[A-Za-z][A-Za-z0-9_]{2,29}" onChange={e => setNickname(e.target.value)} /></label>
              <label><span>{language === "pt" ? "Login" : "Username"}</span><input value={user.login || user.nickname || ''} readOnly /></label>
              {profile.email && <label><span>E-mail</span><input value={profile.email} readOnly /></label>}
            </div>
            <section className="profile-teams profile-organizations"><h3>{language === "pt" ? "Equipes e empresas" : "Teams and organizations"}</h3><div>{teams.map(team => {
              const membership = memberships.find(item => item.teamId === team.id);
              const role = membership?.roleName || (team.captainMemberId === user.memberId ? (language === 'pt' ? 'Gestor' : 'Manager') : (language === 'pt' ? 'Integrante' : 'Member'));
              return <details key={team.id}><summary><Building2 size={20} /><span><strong>{team.name}</strong><small>{role}</small></span><ChevronDown size={16} /></summary><dl><div><dt>{language === 'pt' ? 'Cargo' : 'Role'}</dt><dd>{role}</dd></div><div><dt>{language === 'pt' ? 'Função' : 'Responsibilities'}</dt><dd>{membership?.functionName || (language === 'pt' ? 'Ainda não definida' : 'Not assigned yet')}</dd></div></dl><p>{language === 'pt' ? 'Cargo e função são definidos pela gestão da equipe.' : 'Roles and responsibilities are assigned by team management.'}</p><a href={`#/teams?team=${encodeURIComponent(team.id)}`} onClick={() => setProfileOpen(false)}>{language === 'pt' ? 'Ver equipe' : 'View team'}</a></details>;
            })}{teams.length === 0 && <p>{language === "pt" ? "Nenhuma equipe associada." : "No associated teams."}</p>}</div></section>
            {error && <p className="profile-error" role="alert">{error}</p>}
            <footer><button type="button" onClick={() => setProfileOpen(false)}>{language === "pt" ? "Cancelar" : "Cancel"}</button><button className="primary" type="submit" disabled={busy}>{busy ? <LoaderCircle className="profile-spin" aria-hidden="true" /> : <Check aria-hidden="true" />}{language === "pt" ? "Salvar perfil" : "Save profile"}</button></footer>
          </form>}
        </section>
      </div>}
    </>
  );
}
