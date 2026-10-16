import { useCallback, useEffect, useRef, useState } from "react";
import { MessageSquare, Plus, ArrowLeft, UsersRound, Pencil, Check, X, Mic, MicOff, PhoneOff, Volume2, Link } from "lucide-react";
import { useAuth } from "../lib/auth";
import { MeetingMemoryLookup } from "../components/MeetingMemoryLookup";
import { meetingFrameURL, participantIsPresent } from "../lib/meetings";
import { createMeetingAudio, emptyAudioState } from "../lib/meetingAudio";
import type { MeetingInvitation, MeetingSummary, MeetingParticipant, MeetingScope, MeetingScopeTeam } from "../lib/meetings";
import type { ProjectSummary } from "../lib/team";
import type { Language } from "../lib/types";
import "./MeetingsPage.css";

function Avatar({ person }: { person: MeetingParticipant }) {
  return <span className={`meeting-avatar${participantIsPresent(person) ? " present" : ""}`} title={person.name || person.nickname}>{person.avatarUrl ? <img src={person.avatarUrl} alt="" /> : (person.name || person.nickname).split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase()}</span>;
}
export function MeetingsPage({ projects, activeProjectId, language }: { projects: ProjectSummary[]; activeProjectId: string; language: Language }) {
  const auth = useAuth(), pt = language === "pt";
  const [meetings, setMeetings] = useState<MeetingSummary[]>([]), [invitations, setInvitations] = useState<MeetingInvitation[]>([]), [teams, setTeams] = useState<MeetingScopeTeam[]>([]);
  const [selected, setSelected] = useState<MeetingSummary | null>(null);
  const [creating, setCreating] = useState(false), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
  const [title, setTitle] = useState(""), [projectId, setProjectId] = useState(activeProjectId), [scope, setScope] = useState<MeetingScope>("private"), [teamId, setTeamId] = useState(""), [sectorId, setSectorId] = useState("");
  const [filter, setFilter] = useState("all"), [filterTeam, setFilterTeam] = useState("");
  const [memoryMode, setMemoryMode] = useState<"none" | "project">("none"), [roomKind, setRoomKind] = useState<"meeting" | "beam">("meeting");
  const [nickname, setNickname] = useState(""), [peopleOpen, setPeopleOpen] = useState(false), [editingTitle, setEditingTitle] = useState(false), [titleDraft, setTitleDraft] = useState("");
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [audio, setAudio] = useState(emptyAudioState);
  const frame = useRef<HTMLIFrameElement>(null), activeCapture = useRef(false), audioClient = useRef<ReturnType<typeof createMeetingAudio> | null>(null), selectedRef = useRef(selected);
  selectedRef.current = selected;
  const fail = useCallback((reason: unknown) => setError(reason instanceof Error ? reason.message : pt ? "Não foi possível concluir. Tente novamente." : "Could not complete this action. Try again."), [pt]);
  const refresh = useCallback(async () => {
    const [list, incoming, scopes] = await Promise.all([auth.api<{ meetings: MeetingSummary[] }>("/meetings"), auth.api<{ invitations: MeetingInvitation[] }>("/meeting-invitations"), auth.api<{ teams: MeetingScopeTeam[] }>("/meeting-scopes")]);
    setMeetings(list.meetings); setInvitations(incoming.invitations); setTeams(scopes.teams);
  }, [auth.api]);
  const open = useCallback(async (meeting: MeetingSummary) => {
    if (activeCapture.current) { setError(pt ? "Encerre a reunião antes de abrir outra." : "Finish the meeting before opening another."); return; }
    const response = await auth.api<{ meeting: MeetingSummary }>(`/meetings/${encodeURIComponent(meeting.id)}/join`, { method: "POST", body: "{}" });
    const url = new URL(window.location.href); if (url.searchParams.get("meeting") !== meeting.id) url.searchParams.delete("event"); url.searchParams.set("meeting", meeting.id); history.replaceState(null, "", url);
    setError(""); setNotice(""); setPeopleOpen(false); setEditingTitle(false); activeCapture.current = false; setSelected(response.meeting);
  }, [auth.api, pt]);
  useEffect(() => { let alive = true; void refresh().then(async () => {
    const id = new URLSearchParams(window.location.search).get("meeting");
    if (!id || !/^[A-Za-z0-9_.:-]{1,160}$/.test(id)) return;
    const response = await auth.api<{ meeting: MeetingSummary }>(`/meetings/${encodeURIComponent(id)}`);
    if (alive) await open(response.meeting);
  }).catch(reason => { if (alive) fail(reason); }).finally(() => { if (alive) setLoading(false); }); return () => { alive = false; }; }, [refresh, auth.api, open, fail]);
  useEffect(() => {
    if (!selected?.id || !auth.user?.id) return;
    const id = selected.id, host = selected.ownerId === auth.user.id;
    const client = createMeetingAudio({ api: auth.api, meetingId: id, userId: auth.user.id, host, onError: setError, onState: state => {
      setAudio(state);
      if (host && state.joined) frame.current?.contentWindow?.postMessage({ type: "norte:meeting-audio-mute", meetingId: id, muted: state.muted }, window.location.origin);
    } });
    audioClient.current = client; setAudio(emptyAudioState());
    return () => { client.dispose(); audioClient.current = null; };
  }, [selected?.id, auth.user?.id, auth.api]);
  useEffect(() => {
    if (!selected) return;
    let cancelled = false, polling = false; const id = selected.id;
    const poll = async () => {
      if (polling) return; polling = true;
      try { const detail = await auth.api<{ meeting: MeetingSummary }>(`/meetings/${encodeURIComponent(id)}`); if (!cancelled) setSelected(detail.meeting); }
      catch (reason) { if (!cancelled) fail(reason); } finally { polling = false; }
    };
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void poll(); }, 4000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [selected?.id, auth.api, fail]);
  useEffect(() => {
    const message = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow || event.data?.type !== "norte:meeting-running") return;
      activeCapture.current = event.data.running === true;
      if (activeCapture.current && audioClient.current?.snapshot().joined && audioClient.current.snapshot().muted) frame.current?.contentWindow?.postMessage({ type: "norte:meeting-audio-mute", meetingId: selectedRef.current?.id, muted: true }, window.location.origin);
    };
    window.addEventListener("message", message); return () => window.removeEventListener("message", message);
  }, []);
  async function create() {
    setBusy(true); setError("");
    try {
      const response = await auth.api<{ meeting: MeetingSummary }>("/meetings", { method: "POST", body: JSON.stringify({ title: title.trim() || (pt ? "Nova reunião" : "New meeting"), projectId: projectId || null, scope, teamId: teamId || null, sectorId: sectorId || null, memoryMode, roomKind }) });
      setCreating(false); setTitle(""); await refresh(); await open(response.meeting);
    } catch (reason) { fail(reason); } finally { setBusy(false); }
  }
  async function respond(invitation: MeetingInvitation, decision: "accept" | "decline") {
    setBusy(true); setError("");
    try { await auth.api(`/meeting-invitations/${encodeURIComponent(invitation.id)}/respond`, { method: "POST", body: JSON.stringify({ decision }) }); await refresh(); if (decision === "accept") { const response = await auth.api<{ meeting: MeetingSummary }>(`/meetings/${encodeURIComponent(invitation.meetingId)}`); await open(response.meeting); } }
    catch (reason) { fail(reason); } finally { setBusy(false); }
  }
  async function invite() {
    if (!selected || !nickname.trim()) return; setBusy(true); setError(""); setNotice("");
    try { await auth.api(`/meetings/${encodeURIComponent(selected.id)}/invitations`, { method: "POST", body: JSON.stringify({ nickname: nickname.trim().replace(/^@/, "") }) }); setNickname(""); setNotice(pt ? "Convite enviado." : "Invitation sent."); }
    catch (reason) { fail(reason); } finally { setBusy(false); }
  }
  async function saveTitle() {
    if (!selected || !titleDraft.trim()) return; setBusy(true); setError("");
    try {
      const latest = await auth.api<{ meeting: MeetingSummary }>(`/meetings/${encodeURIComponent(selected.id)}`);
      const result = await auth.api<{ meeting: MeetingSummary }>(`/meetings/${encodeURIComponent(selected.id)}`, { method: "PATCH", body: JSON.stringify({ title: titleDraft.trim(), expectedRevision: latest.meeting.revision }) });
      setSelected(result.meeting); setEditingTitle(false); frame.current?.contentWindow?.postMessage({ type: "norte:meeting-title", meetingId: selected.id, title: result.meeting.title }, window.location.origin);
    } catch (reason) { fail(reason); } finally { setBusy(false); }
  }
  async function copyLink() { if (!selected) return; try { const url = new URL(window.location.origin); url.searchParams.set("meeting", selected.id); url.hash = "/meetings"; await navigator.clipboard.writeText(url.href); setNotice(pt ? "Link copiado. O acesso segue as permissões desta reunião." : "Link copied. Meeting permissions still apply."); } catch { setError(pt ? "Não foi possível copiar o link neste navegador." : "Unable to copy the link in this browser."); } }
  function leaveRoom() { if (activeCapture.current) { setError(pt ? "Encerre ou interrompa a reunião antes de voltar." : "Finish or stop the meeting before leaving."); return; } setSelected(null); setAudio(emptyAudioState()); const url = new URL(window.location.href); url.searchParams.delete("meeting"); url.searchParams.delete("event"); history.replaceState(null, "", url); void refresh().catch(fail); }
  const host = selected?.ownerId === auth.user?.id && !selected?.example, ended = !!selected && ["completed", "ended", "finished", "done", "interrupted", "stopped"].includes(selected.status);
  const chosenTeam = teams.find(team => team.id === teamId), scopeProjects = chosenTeam?.projects || [], sectors = scopeProjects.find(project => project.id === projectId)?.sectors || [];
  const visible = meetings.filter(meeting => (filter === "all" || (meeting.scope || "private") === filter) && (!filterTeam || meeting.teamId === filterTeam));
  const people = [...(selected?.participants || [])].sort((a, b) => Number(participantIsPresent(b)) - Number(participantIsPresent(a)));
  const scopeLabel = (meeting: MeetingSummary) => meeting.scope === "sector" ? `${meeting.teamName || ""} · ${meeting.sectorName || (pt ? "Setor" : "Sector")}` : meeting.scope === "team" ? `${meeting.teamName || ""} · ${pt ? "Geral" : "General"}` : pt ? "Por convite" : "Invite only";
  return <main className={`meetings-page${selected ? " meeting-open" : ""}`}>
    <header className="meetings-heading"><div className="meeting-title-area"><small>{selected ? scopeLabel(selected) : "NORTE"}</small>{editingTitle ? <form className="meeting-title-editor" onSubmit={event => { event.preventDefault(); void saveTitle(); }}><input aria-label={pt ? "Título da reunião" : "Meeting title"} autoFocus value={titleDraft} maxLength={160} onChange={event => setTitleDraft(event.target.value)} onKeyDown={event => { if (event.key === "Escape") setEditingTitle(false); }} /><button disabled={busy || !titleDraft.trim()} aria-label={pt ? "Salvar título" : "Save title"}><Check size={20} /></button><button type="button" onClick={() => setEditingTitle(false)} aria-label={pt ? "Cancelar edição" : "Cancel editing"}><X size={20} /></button></form> : <div className="meeting-title-line"><h1>{selected?.title || (pt ? "Reuniões" : "Meetings")}</h1>{selected && host && <button className="meeting-pencil" aria-label={pt ? "Editar título da reunião" : "Edit meeting title"} onClick={() => { setTitleDraft(selected.title); setEditingTitle(true); }}><Pencil size={20} /></button>}</div>}{!selected && <p>{pt ? "Encontros da equipe, dos setores e por convite." : "Team, sector and invite-only conversations."}</p>}</div>
      {selected ? <div className="meeting-top-actions"><div className="meeting-people-anchor"><button className="meeting-people-trigger" aria-label={pt ? "Participantes e convites" : "Participants and invitations"} aria-expanded={peopleOpen} onClick={() => setPeopleOpen(!peopleOpen)}><span className="meeting-avatar-stack">{people.slice(0, 3).map(person => <Avatar key={person.userId} person={person} />)}{people.length > 3 && <span className="meeting-avatar more">+{people.length - 3}</span>}</span><UsersRound size={18} /></button>{peopleOpen && <section className="meeting-people-popover" aria-label={pt ? "Participantes" : "Participants"}><header><strong>{pt ? "Participantes" : "Participants"}</strong><button aria-label={pt ? "Fechar participantes" : "Close participants"} onClick={() => setPeopleOpen(false)}><X size={16} /></button></header><ul>{people.map(person => { const peer = audio.peers.find(item => item.userId === person.userId); return <li key={person.userId}><Avatar person={person} /><span>{person.name || person.nickname}<small>{person.role === "host" ? (pt ? "Anfitrião" : "Host") : `@${person.nickname}`}{peer ? peer.muted ? (pt ? " · Silenciado" : " · Muted") : (pt ? " · No áudio" : " · In audio") : ""}</small></span>{host && person.userId !== auth.user?.id && peer && <button title={peer.forcedMuted ? (pt ? "Permitir ativar microfone" : "Allow microphone") : (pt ? "Silenciar participante" : "Mute participant")} aria-label={`${peer.forcedMuted ? "Permitir microfone de" : "Silenciar"} ${person.name}`} onClick={() => void audioClient.current?.moderate(person.userId, !peer.forcedMuted).catch(fail)}>{peer.forcedMuted ? <Mic size={16} /> : <MicOff size={16} />}</button>}</li>; })}</ul>{host && <form onSubmit={event => { event.preventDefault(); void invite(); }}><label>{pt ? "Convidar por nickname" : "Invite by nickname"}<input value={nickname} onChange={event => setNickname(event.target.value)} placeholder="@nickname" maxLength={31} /></label><button disabled={busy || !nickname.trim()}>{pt ? "Enviar convite" : "Send invitation"}</button></form>}<button onClick={() => void copyLink()}><Link size={16} />{pt ? "Copiar link da reunião" : "Copy meeting link"}</button></section>}</div><button className="meeting-back" onClick={leaveRoom} aria-label={pt ? "Todas as reuniões" : "All meetings"}><ArrowLeft size={17} />{pt ? "Voltar" : "Back"}</button></div> : <button className="meetings-primary" onClick={() => { setProjectId(""); setScope(teams.length ? "team" : "private"); setTeamId(teams[0]?.id || ""); setMemoryMode("none"); setCreating(true); }}><Plus size={16} />{pt ? "Nova reunião" : "New meeting"}</button>}
    </header>
    {selected?.example && <p className="meetings-message">{pt ? "Exemplo fictício · transcrição de 25 minutos e tópicos preparados para demonstração. Não representa fatos do projeto nem avaliação de um modelo." : "Fictional example · 25-minute transcript and manually prepared topics. These are not project facts or model evaluation results."}</p>}
    {error && <p role="alert" className="meetings-message error">{error}</p>}{notice && <p role="status" className="meetings-message">{notice}</p>}
    {!selected && invitations.length > 0 && <section className="meetings-invitations" aria-label={pt ? "Convites para reuniões" : "Meeting invitations"}><h2>{pt ? "Convites" : "Invitations"}</h2>{invitations.map(invitation => <article key={invitation.id}><span>{invitation.meetingTitle || invitation.title || "Reunião"}</span><button disabled={busy} onClick={() => void respond(invitation, "accept")}>{pt ? "Aceitar e abrir" : "Accept and open"}</button><button disabled={busy} onClick={() => void respond(invitation, "decline")}>{pt ? "Recusar" : "Decline"}</button></article>)}</section>}
    {!selected && creating && <form className="meetings-create" onSubmit={event => { event.preventDefault(); void create(); }}><h2>{pt ? "Preparar reunião" : "Prepare meeting"}</h2><label>{pt ? "Título" : "Title"}<input autoFocus value={title} maxLength={160} onChange={event => setTitle(event.target.value)} placeholder={pt ? "Alinhamento semanal" : "Weekly check-in"} /></label><label>{pt ? "Quem participa" : "Participants"}<select value={scope} onChange={event => { setScope(event.target.value as MeetingScope); setProjectId(""); setSectorId(""); setMemoryMode("none"); }}><option value="private">{pt ? "Por convite" : "Invite only"}</option><option value="team" disabled={!teams.length}>{pt ? "Equipe inteira · geral" : "Whole team · general"}</option><option value="sector" disabled={!teams.length}>{pt ? "Um setor" : "One sector"}</option></select></label>{scope !== "private" && <label>{pt ? "Equipe" : "Team"}<select required value={teamId} onChange={event => { setTeamId(event.target.value); setProjectId(""); setSectorId(""); setMemoryMode("none"); }}><option value="">{pt ? "Selecionar equipe" : "Select team"}</option>{teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>}{scope === "sector" && <><label>{pt ? "Projeto do setor" : "Sector project"}<select required value={projectId} onChange={event => { setProjectId(event.target.value); setSectorId(""); }}><option value="">{pt ? "Selecionar projeto" : "Select project"}</option>{scopeProjects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><label>{pt ? "Setor" : "Sector"}<select required value={sectorId} onChange={event => setSectorId(event.target.value)}><option value="">{pt ? "Selecionar setor" : "Select sector"}</option>{sectors.map(sector => <option key={sector.id} value={sector.id}>{sector.name}</option>)}</select></label></>}
      <details className="meeting-options"><summary>{pt ? "Memória, simulação e exemplos" : "Memory, simulation and examples"}</summary>{scope !== "sector" && <label>{pt ? "Projeto (opcional)" : "Project (optional)"}<select aria-label={pt ? "Projeto" : "Project"} value={projectId} onChange={event => { setProjectId(event.target.value); if (!event.target.value) setMemoryMode("none"); }}><option value="">{pt ? "Sem projeto" : "No project"}</option>{(scope === "team" ? scopeProjects : projects).map(project => <option value={project.id} key={project.id}>{project.name}</option>)}</select></label>}<label className="meeting-check"><input type="checkbox" checked={memoryMode === "project"} disabled={!projectId} onChange={event => setMemoryMode(event.target.checked ? "project" : "none")} />{pt ? "Consultar a memória do projeto" : "Look up project memory"}</label><label>{pt ? "Ambiente" : "Workspace"}<select value={roomKind} onChange={event => setRoomKind(event.target.value as "meeting" | "beam")}><option value="meeting">{pt ? "Reunião e mapa de assuntos" : "Meeting and topic map"}</option><option value="beam">{pt ? "Reunião com simulação de vigas" : "Meeting with beam simulation"}</option></select></label><p>{pt ? "Exemplos fictícios de 25 minutos para importar na transcrição:" : "Fictional 25-minute examples to import into the transcript:"} <a href={`${import.meta.env.BASE_URL}meeting-mocks/geral-25min.txt`} download>{pt ? "Geral" : "General"}</a> · <a href={`${import.meta.env.BASE_URL}meeting-mocks/setor-25min.txt`} download>{pt ? "Setor" : "Sector"}</a></p></details><div><button className="meetings-primary" disabled={busy}>{busy ? (pt ? "Criando…" : "Creating…") : (pt ? "Criar e abrir" : "Create and open")}</button><button type="button" disabled={busy} onClick={() => setCreating(false)}>{pt ? "Cancelar" : "Cancel"}</button></div></form>}
    {!selected && <><div className="meeting-filters"><label className="sr-only" htmlFor="meetingScopeFilter">{pt ? "Filtrar reuniões" : "Filter meetings"}</label><select id="meetingScopeFilter" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">{pt ? "Todas as reuniões" : "All meetings"}</option><option value="team">{pt ? "Gerais da equipe" : "Team general"}</option><option value="sector">{pt ? "Dos setores" : "Sectors"}</option><option value="private">{pt ? "Por convite" : "Invite only"}</option></select>{teams.length > 0 && <select aria-label={pt ? "Filtrar equipe" : "Filter team"} value={filterTeam} onChange={event => setFilterTeam(event.target.value)}><option value="">{pt ? "Todas as equipes" : "All teams"}</option>{teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select>}</div><section className="meetings-list" aria-label={pt ? "Suas reuniões" : "Your meetings"}>{loading ? <p>{pt ? "Carregando reuniões…" : "Loading meetings…"}</p> : !visible.length ? <div className="meetings-empty"><MessageSquare size={28} /><h2>{pt ? "Seu próximo encontro começa aqui" : "Your next conversation starts here"}</h2></div> : visible.map(meeting => <button className="meetings-card" key={meeting.id} onClick={() => void open(meeting).catch(fail)}><span><strong>{meeting.title}</strong><small>{scopeLabel(meeting)}</small></span><span className="meetings-card-state">{({ draft: pt ? "Não iniciada" : "Not started", running: pt ? "Em andamento" : "Running", done: pt ? "Concluída" : "Complete", interrupted: pt ? "Preservada" : "Saved" } as Record<string, string>)[meeting.status] || meeting.status}</span></button>)}</section></>}
    {selected && <><div className="meeting-audio-controls" data-audio-connected={audio.connected.length} data-audio-joined={audio.joined} data-recording={audio.recording}><span>{pt ? "Áudio da equipe" : "Team audio"}{audio.recording ? (pt ? " · Gravação ativa" : " · Recording") : ""}</span>{!audio.joined ? <button disabled={audio.joining || ended} onClick={() => void audioClient.current?.join()}><Mic size={17} />{audio.joining ? (pt ? "Conectando…" : "Connecting…") : (pt ? "Entrar no áudio" : "Join audio")}</button> : <><button disabled={audio.forcedMuted} onClick={() => void audioClient.current?.setMuted(!audio.muted)}>{audio.muted ? <MicOff size={17} /> : <Mic size={17} />}{audio.forcedMuted ? (pt ? "Silenciado pelo anfitrião" : "Muted by host") : audio.muted ? (pt ? "Ativar microfone" : "Unmute microphone") : (pt ? "Silenciar microfone" : "Mute microphone")}</button><button onClick={() => void audioClient.current?.activateSound().catch(fail)} title={pt ? "Ativar som" : "Enable sound"}><Volume2 size={17} /><span>{pt ? "Ativar som" : "Enable sound"}</span></button><button onClick={() => void audioClient.current?.leave()}><PhoneOff size={17} />{pt ? "Sair do áudio" : "Leave audio"}</button><small>{audio.connected.length ? `${audio.connected.length + 1} ${pt ? "no áudio" : "in audio"}` : pt ? "Aguardando participantes" : "Waiting for participants"}</small></>}</div><div className="meetings-workspace"><iframe ref={frame} key={selected.id} src={meetingFrameURL(selected.id, selected.roomKind)} title={pt ? "Sala de reunião" : "Meeting room"} allow="microphone; clipboard-write" className="meetings-frame" /></div>{selected.memoryMode === "project" && <details className="meeting-memory"><summary>{pt ? "Consultar memória do projeto" : "Look up project memory"}</summary><MeetingMemoryLookup key={selected.id} meetingId={selected.id} language={language} /></details>}</>}
  </main>;
}
