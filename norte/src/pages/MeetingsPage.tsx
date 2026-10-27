import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarDays, Check, FileText, Headphones, LayoutGrid, Link, MessageSquare, Mic, MicOff, Pencil, PhoneOff, Plus, Square, UsersRound, Video, Volume2, X } from "lucide-react";
import { useAuth } from "../lib/auth";
import { ApiError } from "../lib/apiClient";
import { claimBack } from "../lib/navigation";
import { rememberWorkspace } from "../lib/workspaceHistory";
import { ArchivedMeetingView } from "../components/ArchivedMeetingView";
import { meetingFrameURL, participantIsPresent } from "../lib/meetings";
import { createMeetingAudio, emptyAudioState } from "../lib/meetingAudio";
import type { MeetingInvitation, MeetingSummary, MeetingParticipant, MeetingScope, MeetingScopeTeam } from "../lib/meetings";
import type { ProjectSummary } from "../lib/team";
import type { Language } from "../lib/types";
import '../styles/features/meetings.css';

type ButtonState = { hidden: boolean; disabled: boolean };
/** What the embedded room reports about its own controls; the room keeps every rule. */
type RoomControls = { live: ButtonState & { label: string; recording: boolean; host: boolean }; timer: { text: string; hidden: boolean }; finish: ButtonState; stop: ButtonState; minutes: ButtonState; importing: ButtonState; status: string; statusText: string; started: string };

const initials = (person: MeetingParticipant) => (person.name || person.nickname).split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase();
function Avatar({ person }: { person: MeetingParticipant }) {
  return <span className={`meeting-avatar${participantIsPresent(person) ? " present" : ""}`} title={person.name || person.nickname}>{person.avatarUrl ? <img src={person.avatarUrl} alt="" /> : initials(person)}</span>;
}
const statusLabel = (status: string, pt: boolean) => ({ draft: pt ? "Não iniciada" : "Not started", running: pt ? "Em andamento" : "In progress", done: pt ? "Concluída" : "Complete", interrupted: pt ? "Preservada" : "Saved" } as Record<string, string>)[status] || status;

export function MeetingsPage({ projects, activeProjectId, language }: { projects: ProjectSummary[]; activeProjectId: string; language: Language }) {
  const auth = useAuth(), pt = language === "pt";
  const [meetings, setMeetings] = useState<MeetingSummary[]>([]), [invitations, setInvitations] = useState<MeetingInvitation[]>([]), [teams, setTeams] = useState<MeetingScopeTeam[]>([]);
  const [roomView, setRoomView] = useState<"canvas" | "minutes">("canvas");
  const [frameSrc, setFrameSrc] = useState("");
  const [selected, setSelected] = useState<MeetingSummary | null>(null);
  const [controls, setControls] = useState<RoomControls | null>(null);
  const [creating, setCreating] = useState(false), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
  const [title, setTitle] = useState(""), [projectId, setProjectId] = useState(activeProjectId), [scope, setScope] = useState<MeetingScope>("private"), [teamId, setTeamId] = useState(""), [sectorId, setSectorId] = useState("");
  const [filter, setFilter] = useState("all"), [filterTeam, setFilterTeam] = useState("");
  const [nickname, setNickname] = useState(""), [peopleOpen, setPeopleOpen] = useState(false), [editingTitle, setEditingTitle] = useState(false), [titleDraft, setTitleDraft] = useState(""), [titleOriginal, setTitleOriginal] = useState("");
  const [dismissedExample, setDismissedExample] = useState<string | null>(null);
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [audio, setAudio] = useState(emptyAudioState);
  const frame = useRef<HTMLIFrameElement>(null), activeCapture = useRef(false), audioClient = useRef<ReturnType<typeof createMeetingAudio> | null>(null), selectedRef = useRef(selected), peopleRef = useRef<HTMLDivElement>(null);
  selectedRef.current = selected;
  const fail = useCallback((reason: unknown) => setError(reason instanceof Error ? reason.message : pt ? "Não foi possível concluir. Tente novamente." : "Could not complete this action. Try again."), [pt]);
  const refresh = useCallback(async () => {
    const [list, incoming, scopes] = await Promise.all([auth.api<{ meetings: MeetingSummary[] }>("/meetings"), auth.api<{ invitations: MeetingInvitation[] }>("/meeting-invitations"), auth.api<{ teams: MeetingScopeTeam[] }>("/meeting-scopes")]);
    setMeetings(list.meetings); setInvitations(incoming.invitations); setTeams(scopes.teams);
  }, [auth.api]);
  const open = useCallback(async (meeting: MeetingSummary) => {
    if (activeCapture.current) { setError(pt ? "Encerre a reunião antes de abrir outra." : "Finish the meeting before opening another."); return; }
    const alreadyJoined = meeting.ownerId === auth.user?.id || meeting.participants.some(person => person.userId === auth.user?.id);
    const response = alreadyJoined ? { meeting } : await auth.api<{ meeting: MeetingSummary }>(`/meetings/${encodeURIComponent(meeting.id)}/join`, { method: "POST", body: "{}" });
    const url = new URL(window.location.href); if (url.searchParams.get("meeting") !== meeting.id) { url.searchParams.delete("event"); url.searchParams.delete("view"); } url.searchParams.set("meeting", meeting.id); history.replaceState(history.state, "", url);
    setError(""); setNotice(""); setPeopleOpen(false); setEditingTitle(false); setControls(null); activeCapture.current = false; setRoomView(url.searchParams.get("view") === "minutes" ? "minutes" : "canvas"); setFrameSrc(meetingFrameURL(meeting.id, meeting.roomKind)); setSelected(response.meeting);
    rememberWorkspace(meeting.title, { kind: "meeting", context: meeting.projectName || meeting.teamName || "", detail: statusLabel(meeting.status, pt) });
  }, [auth.api, auth.user?.id, pt]);
  useEffect(() => { let alive = true;
    const id = new URLSearchParams(window.location.search).get("meeting");
    const openLinked = async () => {
      if (!id || !/^[A-Za-z0-9_.:-]{1,160}$/.test(id)) return;
      const response = await auth.api<{ meeting: MeetingSummary }>(`/meetings/${encodeURIComponent(id)}`);
      if (alive) await open(response.meeting);
    };
    void Promise.all([refresh(), openLinked()]).catch(reason => { if (alive) fail(reason); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [refresh, auth.api, open, fail]);
  useEffect(() => {
    const navigate = () => {
      if (!location.hash.startsWith("#/meetings")) return;
      const params = new URLSearchParams(location.search), id = params.get("meeting");
      if (activeCapture.current) return;
      if (!id) { setSelected(null); setRoomView("canvas"); return; }
      if (!/^[A-Za-z0-9_.:-]{1,160}$/.test(id)) return;
      const view = params.get("view") === "minutes" ? "minutes" : "canvas";
      if (selectedRef.current?.id === id) { setRoomView(view); frame.current?.contentWindow?.postMessage({ type: "norte:meeting-view", meetingId: id, view }, location.origin); return; }
      void auth.api<{ meeting: MeetingSummary }>(`/meetings/${encodeURIComponent(id)}`).then(result => open(result.meeting)).catch(fail);
    };
    window.addEventListener("popstate", navigate); return () => window.removeEventListener("popstate", navigate);
  }, [auth.api, open, fail]);
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("norte:page-context", { detail: selected ? { teamId: selected.teamId, teamName: selected.teamName, projectId: selected.projectId, projectName: selected.projectName, sectorId: selected.sectorId, sectorName: selected.sectorName } : null }));
    return () => { window.dispatchEvent(new CustomEvent("norte:page-context", { detail: null })); };
  }, [selected?.id, selected?.teamId, selected?.teamName, selected?.projectId, selected?.projectName, selected?.sectorId, selected?.sectorName]);
  useEffect(() => {
    // Read-only archives never open an audio session.
    if (!selected?.id || !auth.user?.id || selected.roomKind === "archive") return;
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
      if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow) return;
      if (event.data?.type === "norte:meeting-controls" && event.data.meetingId === selectedRef.current?.id && event.data.controls?.live) { setControls(event.data.controls as RoomControls); return; }
      if (event.data?.type === "norte:meeting-view" && event.data.meetingId === selectedRef.current?.id && ["canvas", "minutes"].includes(event.data.view)) {
        const view = event.data.view as "canvas" | "minutes"; setRoomView(view); const url = new URL(location.href); if (view === "minutes") url.searchParams.set("view", "minutes"); else url.searchParams.delete("view"); history.replaceState(history.state, "", url);
        if (selectedRef.current) rememberWorkspace(selectedRef.current.title, { kind: view === "minutes" ? "minutes" : "meeting", context: selectedRef.current.projectName || selectedRef.current.teamName || "", detail: statusLabel(selectedRef.current.status, pt) }); return;
      }
      if (event.data?.type !== "norte:meeting-running") return;
      activeCapture.current = event.data.running === true;
      if (activeCapture.current && audioClient.current?.snapshot().joined && audioClient.current.snapshot().muted) frame.current?.contentWindow?.postMessage({ type: "norte:meeting-audio-mute", meetingId: selectedRef.current?.id, muted: true }, window.location.origin);
    };
    window.addEventListener("message", message); return () => window.removeEventListener("message", message);
  }, [pt]);
  useEffect(() => {
    if (!peopleOpen) return;
    const close = (event: Event) => { if (event instanceof KeyboardEvent ? event.key === "Escape" : !peopleRef.current?.contains(event.target as Node)) setPeopleOpen(false); };
    document.addEventListener("pointerdown", close); document.addEventListener("keydown", close);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", close); };
  }, [peopleOpen]);
  const command = (name: "live" | "finish" | "stop" | "minutes" | "import") => frame.current?.contentWindow?.postMessage({ type: "norte:meeting-command", meetingId: selected?.id, command: name }, location.origin);
  async function create() {
    setBusy(true); setError("");
    try {
      const response = await auth.api<{ meeting: MeetingSummary }>("/meetings", { method: "POST", body: JSON.stringify({ title: title.trim() || (pt ? "Nova reunião" : "New meeting"), projectId: projectId || null, scope, teamId: teamId || null, sectorId: sectorId || null }) });
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
      const path = `/meetings/${encodeURIComponent(selected.id)}`;
      let latest = await auth.api<{ meeting: MeetingSummary }>(path), result: { meeting: MeetingSummary } | undefined;
      for (let attempt = 0; attempt < 2; attempt++) {
        if (latest.meeting.title !== titleOriginal) throw new Error(pt ? "O título foi alterado em outra aba. Feche a edição e confira o título atual." : "The title changed in another tab. Close the editor and review the current title.");
        try { result = await auth.api<{ meeting: MeetingSummary }>(path, { method: "PATCH", body: JSON.stringify({ title: titleDraft.trim(), expectedRevision: latest.meeting.revision }) }); break; }
        catch (reason) { if (attempt || !(reason instanceof ApiError) || reason.code !== "MEETING_CHANGED") throw reason; latest = await auth.api<{ meeting: MeetingSummary }>(path); }
      }
      if (!result) return;
      setSelected(result.meeting); setEditingTitle(false); frame.current?.contentWindow?.postMessage({ type: "norte:meeting-title", meetingId: selected.id, title: result.meeting.title }, window.location.origin);
    } catch (reason) { fail(reason); } finally { setBusy(false); }
  }
  async function copyLink() { if (!selected) return; try { const url = new URL(window.location.origin); url.searchParams.set("meeting", selected.id); url.hash = "/meetings"; await navigator.clipboard.writeText(url.href); setNotice(pt ? "Link copiado. O acesso segue as permissões desta reunião." : "Link copied. Meeting permissions still apply."); } catch { setError(pt ? "Não foi possível copiar o link neste navegador." : "Unable to copy the link in this browser."); } }
  const leaveRoom = useCallback(() => {
    if (roomView === "minutes") { frame.current?.contentWindow?.postMessage({ type: "norte:meeting-view", meetingId: selectedRef.current?.id, view: "canvas" }, location.origin); return; }
    if (activeCapture.current) { setError(pt ? "Encerre ou interrompa a reunião antes de voltar." : "Finish or stop the meeting before leaving."); return; }
    setSelected(null); setControls(null); setAudio(emptyAudioState()); const url = new URL(window.location.href); url.searchParams.delete("meeting"); url.searchParams.delete("event"); url.searchParams.delete("view"); history.replaceState(history.state, "", url); void refresh().catch(fail);
  }, [roomView, pt, refresh, fail]);
  // An open meeting is this page's inner level: the header's back returns to the list (or from the minutes to the canvas).
  useEffect(() => selected ? claimBack(() => { leaveRoom(); return true; }) : undefined, [selected, leaveRoom]);
  const host = selected?.ownerId === auth.user?.id && !selected?.example && selected?.roomKind !== "archive", ended = !!selected && ["completed", "ended", "finished", "done", "interrupted", "stopped"].includes(selected.status);
  const chosenTeam = teams.find(team => team.id === teamId), scopeProjects = chosenTeam?.projects || [], sectors = scopeProjects.find(project => project.id === projectId)?.sectors || [];
  const visible = meetings.filter(meeting => (filter === "all" || (meeting.scope || "private") === filter) && (!filterTeam || meeting.teamId === filterTeam));
  const people = [...(selected?.participants || [])].sort((a, b) => Number(participantIsPresent(b)) - Number(participantIsPresent(a)));
  // At most three bubbles: with more people the third one summarizes the rest.
  const shownPeople = people.length > 3 ? people.slice(0, 2) : people;
  const scopeLabel = (meeting: MeetingSummary) => meeting.scope === "sector" ? `${meeting.teamName || ""} · ${meeting.sectorName || (pt ? "Setor" : "Sector")}` : meeting.scope === "team" ? `${meeting.teamName || ""} · ${pt ? "Geral" : "General"}` : pt ? "Por convite" : "Invite only";
  const date = (value?: string) => { const at = Date.parse(value || ""); return Number.isFinite(at) ? new Intl.DateTimeFormat(pt ? "pt-BR" : "en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(at) : ""; };
  const recording = Boolean(controls?.live.recording);
  const liveLabel = (label: string) => pt ? label : ({ "Gravar": "Record", "Pausar": "Pause", "Pausando…": "Pausing…", "Retomar": "Resume", "Continuar gravação": "Continue recording", "Concluída": "Complete", "Interrompida": "Interrupted" } as Record<string, string>)[label] || label;

  if (selected) return <main className="meetings-page meeting-open">
    <header className="meeting-bar">
      <div className="meeting-bar-title">
        {editingTitle ? <form className="meeting-title-editor" onSubmit={event => { event.preventDefault(); void saveTitle(); }}><input aria-label={pt ? "Título da reunião" : "Meeting title"} autoFocus value={titleDraft} maxLength={160} onChange={event => setTitleDraft(event.target.value)} onKeyDown={event => { if (event.key === "Escape") setEditingTitle(false); }} /><button className="meeting-icon" disabled={busy || !titleDraft.trim()} aria-label={pt ? "Salvar título" : "Save title"}><Check size={17} /></button><button className="meeting-icon" type="button" onClick={() => setEditingTitle(false)} aria-label={pt ? "Cancelar edição" : "Cancel editing"}><X size={17} /></button></form>
          : <div className="meeting-title-line"><h1 title={selected.title}>{selected.title}</h1>{host && <button className="meeting-icon meeting-pencil" aria-label={pt ? "Editar título da reunião" : "Edit meeting title"} title={pt ? "Editar título" : "Edit title"} onClick={() => { setTitleDraft(selected.title); setTitleOriginal(selected.title); setEditingTitle(true); }}><Pencil size={15} /></button>}</div>}
        <small><span className={`meeting-status-dot ${controls?.status || selected.status}`} aria-hidden="true" />{statusLabel(controls?.status || selected.status, pt)} · {scopeLabel(selected)}</small>
      </div>
      {selected.roomKind !== "archive" && <div hidden={roomView === "minutes"} className="meeting-bar-center" role="group" aria-label={pt ? "Gravação e áudio" : "Recording and audio"} data-ended={ended} data-audio-connected={audio.connected.length} data-audio-joined={audio.joined} data-recording={audio.recording}>
        {host ? <button className={`meeting-record${recording ? " is-recording" : ""}`} aria-pressed={recording} disabled={!controls || controls.live.disabled} onClick={() => command("live")}>
          <span className="meeting-record-dot" aria-hidden="true">{recording ? <span /> : <Mic size={16} />}</span>
          <span>{controls ? liveLabel(controls.live.label) : (pt ? "Preparando…" : "Preparing…")}</span>
          {controls && !controls.timer.hidden && <time>{controls.timer.text}</time>}
        </button> : <span className={`meeting-record-status${controls?.status === "running" ? " live" : ""}`}><span className="meeting-record-dot" aria-hidden="true"><span /></span>{controls?.statusText || statusLabel(selected.status, pt)}</span>}
        {host && controls && !controls.finish.hidden && <button className="meeting-pill" disabled={controls.finish.disabled} onClick={() => command("finish")}><Square size={13} />{pt ? "Encerrar" : "Finish"}</button>}
        {host && controls && !controls.stop.hidden && <button className="meeting-pill" disabled={controls.stop.disabled} onClick={() => command("stop")}><X size={13} />{pt ? "Interromper" : "Stop"}</button>}
        <span className="meeting-bar-divider" aria-hidden="true" />
        {!audio.joined ? <button className="meeting-icon meeting-audio-join" disabled={audio.joining || ended} onClick={() => void audioClient.current?.join()} title={ended ? (pt ? "Áudio indisponível em reunião encerrada" : "Audio unavailable after the meeting") : (pt ? "Entrar no áudio da equipe" : "Join team audio")} aria-label={pt ? "Entrar no áudio da equipe" : "Join team audio"}><Headphones size={17} /><span>{audio.joining ? (pt ? "Conectando…" : "Connecting…") : (pt ? "Áudio" : "Audio")}</span></button>
          : <span className="meeting-audio-group">
            <button className={`meeting-icon${audio.muted ? " muted" : " live"}`} disabled={audio.forcedMuted} onClick={() => void audioClient.current?.setMuted(!audio.muted)} title={audio.forcedMuted ? (pt ? "Silenciado pelo anfitrião" : "Muted by host") : audio.muted ? (pt ? "Ativar microfone" : "Unmute microphone") : (pt ? "Silenciar microfone" : "Mute microphone")} aria-label={audio.forcedMuted ? (pt ? "Silenciado pelo anfitrião" : "Muted by host") : audio.muted ? (pt ? "Ativar microfone" : "Unmute microphone") : (pt ? "Silenciar microfone" : "Mute microphone")}>{audio.muted ? <MicOff size={17} /> : <Mic size={17} />}</button>
            <button className="meeting-icon" onClick={() => void audioClient.current?.activateSound().catch(fail)} title={pt ? "Ativar som" : "Enable sound"} aria-label={pt ? "Ativar som" : "Enable sound"}><Volume2 size={17} /></button>
            <button className="meeting-icon danger" onClick={() => void audioClient.current?.leave()} title={pt ? "Sair do áudio" : "Leave audio"} aria-label={pt ? "Sair do áudio" : "Leave audio"}><PhoneOff size={17} /></button>
            <small>{audio.connected.length ? `${audio.connected.length + 1} ${pt ? "no áudio" : "in audio"}` : (pt ? "Aguardando" : "Waiting")}</small>
          </span>}
      </div>}
      <div className="meeting-bar-actions">
        <div className="meeting-people-anchor" ref={peopleRef}>
          <button className="meeting-people-trigger" aria-label={pt ? `Participantes e convites (${people.length})` : `Participants and invitations (${people.length})`} aria-expanded={peopleOpen} onClick={() => setPeopleOpen(!peopleOpen)}>
            <span className="meeting-avatar-stack">{shownPeople.map(person => <Avatar key={person.userId} person={person} />)}{people.length > 3 && <span className="meeting-avatar more" title={`+${people.length - 2}`}>…</span>}{!people.length && <span className="meeting-avatar empty"><UsersRound size={14} /></span>}</span>
          </button>
          {peopleOpen && <section className="meeting-people-popover" aria-label={pt ? "Participantes" : "Participants"}><header><strong>{pt ? "Participantes" : "Participants"} · {people.length}</strong><button className="meeting-icon" aria-label={pt ? "Fechar participantes" : "Close participants"} onClick={() => setPeopleOpen(false)}><X size={16} /></button></header><ul>{people.map(person => { const peer = audio.peers.find(item => item.userId === person.userId); return <li key={person.userId}><Avatar person={person} /><span>{person.name || person.nickname}<small>{person.role === "host" ? (pt ? "Anfitrião" : "Host") : `@${person.nickname}`}{participantIsPresent(person) ? (pt ? " · na sala" : " · in the room") : ""}{peer ? peer.muted ? (pt ? " · silenciado" : " · muted") : (pt ? " · no áudio" : " · in audio") : ""}</small></span>{host && person.userId !== auth.user?.id && peer && <button className="meeting-icon" title={peer.forcedMuted ? (pt ? "Permitir ativar microfone" : "Allow microphone") : (pt ? "Silenciar participante" : "Mute participant")} aria-label={`${peer.forcedMuted ? (pt ? "Permitir microfone de" : "Allow microphone for") : (pt ? "Silenciar" : "Mute")} ${person.name}`} onClick={() => void audioClient.current?.moderate(person.userId, !peer.forcedMuted).catch(fail)}>{peer.forcedMuted ? <Mic size={16} /> : <MicOff size={16} />}</button>}</li>; })}</ul>{host && <form onSubmit={event => { event.preventDefault(); void invite(); }}><label>{pt ? "Convidar por nickname" : "Invite by nickname"}<input value={nickname} onChange={event => setNickname(event.target.value)} placeholder="@nickname" maxLength={31} /></label><button className="meetings-primary" disabled={busy || !nickname.trim()}>{pt ? "Enviar convite" : "Send invitation"}</button></form>}<button className="meeting-link-button" onClick={() => void copyLink()}><Link size={15} />{pt ? "Copiar link da reunião" : "Copy meeting link"}</button></section>}
        </div>
        {selected.roomKind !== "archive" && <button className="meeting-minutes-button" disabled={roomView === "canvas" && (!controls || controls.minutes.disabled)} title={roomView === "canvas" && controls?.minutes.disabled ? (pt ? "A ata fica disponível quando houver registros e a captura estiver encerrada" : "Minutes are available once there are records and capture has ended") : undefined} onClick={() => roomView === "minutes" ? leaveRoom() : command("minutes")}>{roomView === "minutes" ? <><LayoutGrid size={16} />{pt ? "Voltar ao canvas" : "Back to canvas"}</> : <><FileText size={16} />{pt ? "Ata / PDF" : "Minutes / PDF"}</>}</button>}
      </div>
    </header>
    {(selected.example || selected.copiedFromExample) && dismissedExample !== selected.id && <div className="meeting-example-note"><span>{pt ? "Exemplo fictício" : "Fictional example"}{selected.copiedFromExample ? (pt ? " · sua cópia privada" : " · your private copy") : ""}</span><button className="meeting-example-dismiss" aria-label={pt ? "Dispensar aviso de exemplo" : "Dismiss example notice"} onClick={() => setDismissedExample(selected.id)}><X size={14} /></button></div>}
    {error && <p role="alert" className="meetings-message error">{error}<button className="meeting-icon" aria-label={pt ? "Fechar aviso" : "Dismiss"} onClick={() => setError("")}><X size={14} /></button></p>}{notice && <p role="status" className="meetings-message">{notice}<button className="meeting-icon" aria-label={pt ? "Fechar aviso" : "Dismiss"} onClick={() => setNotice("")}><X size={14} /></button></p>}
    {selected.roomKind === "archive" ? <ArchivedMeetingView key={selected.id} meetingId={selected.id} language={language} /> : <div className="meetings-workspace"><iframe ref={frame} key={selected.id} src={frameSrc} title={pt ? "Sala de reunião" : "Meeting room"} allow="microphone; clipboard-write" className="meetings-frame" onLoad={() => frame.current?.contentWindow?.postMessage({ type: "norte:meeting-command", meetingId: selected.id, command: "refresh" }, location.origin)} /></div>}
  </main>;

  return <main className="meetings-page">
    <div className="meetings-toolbar">
      <div className="meeting-filters" role="group" aria-label={pt ? "Filtrar reuniões" : "Filter meetings"}>
        {([["all", pt ? "Todas" : "All"], ["team", pt ? "Gerais da equipe" : "Team general"], ["sector", pt ? "Dos setores" : "Sectors"], ["private", pt ? "Por convite" : "Invite only"]] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}<small>{meetings.filter(meeting => value === "all" || (meeting.scope || "private") === value).length}</small></button>)}
        {teams.length > 1 && <select aria-label={pt ? "Filtrar equipe" : "Filter team"} value={filterTeam} onChange={event => setFilterTeam(event.target.value)}><option value="">{pt ? "Todas as equipes" : "All teams"}</option>{teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select>}
      </div>
      <button className="meetings-primary" onClick={() => { setProjectId(""); setScope(teams.length ? "team" : "private"); setTeamId(teams[0]?.id || ""); setCreating(true); }}><Plus size={16} />{pt ? "Nova reunião" : "New meeting"}</button>
    </div>
    {error && <p role="alert" className="meetings-message error">{error}<button className="meeting-icon" aria-label={pt ? "Fechar aviso" : "Dismiss"} onClick={() => setError("")}><X size={14} /></button></p>}{notice && <p role="status" className="meetings-message">{notice}</p>}
    {invitations.length > 0 && <section className="meetings-invitations" aria-label={pt ? "Convites para reuniões" : "Meeting invitations"}><h2>{pt ? "Convites" : "Invitations"}</h2>{invitations.map(invitation => <article key={invitation.id}><Video size={16} aria-hidden="true" /><span>{invitation.meetingTitle || invitation.title || (pt ? "Reunião" : "Meeting")}{invitation.hostName && <small>{pt ? "Convite de" : "From"} {invitation.hostName}</small>}</span><button className="meetings-primary" disabled={busy} onClick={() => void respond(invitation, "accept")}>{pt ? "Aceitar e abrir" : "Accept and open"}</button><button disabled={busy} onClick={() => void respond(invitation, "decline")}>{pt ? "Recusar" : "Decline"}</button></article>)}</section>}
    {creating && <div className="meetings-dialog-backdrop" role="presentation" onPointerDown={() => setCreating(false)}><form className="meetings-create" role="dialog" aria-modal="true" aria-labelledby="meetings-create-title" onPointerDown={event => event.stopPropagation()} onSubmit={event => { event.preventDefault(); void create(); }}>
      <header><h2 id="meetings-create-title">{pt ? "Preparar reunião" : "Prepare meeting"}</h2><button type="button" className="meeting-icon" aria-label={pt ? "Fechar" : "Close"} onClick={() => setCreating(false)}><X size={17} /></button></header>
      <label>{pt ? "Título" : "Title"}<input autoFocus value={title} maxLength={160} onChange={event => setTitle(event.target.value)} placeholder={pt ? "Alinhamento semanal" : "Weekly check-in"} /></label>
      <label>{pt ? "Quem participa" : "Participants"}<select value={scope} onChange={event => { setScope(event.target.value as MeetingScope); setProjectId(""); setSectorId(""); }}><option value="private">{pt ? "Por convite" : "Invite only"}</option><option value="team" disabled={!teams.length}>{pt ? "Equipe inteira · geral" : "Whole team · general"}</option><option value="sector" disabled={!teams.length}>{pt ? "Um setor" : "One sector"}</option></select></label>
      {scope !== "private" && <label>{pt ? "Equipe" : "Team"}<select required value={teamId} onChange={event => { setTeamId(event.target.value); setProjectId(""); setSectorId(""); }}><option value="">{pt ? "Selecionar equipe" : "Select team"}</option>{teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>}
      {scope === "sector" && <div className="meetings-create-row"><label>{pt ? "Projeto do setor" : "Sector project"}<select required value={projectId} onChange={event => { setProjectId(event.target.value); setSectorId(""); }}><option value="">{pt ? "Selecionar projeto" : "Select project"}</option>{scopeProjects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><label>{pt ? "Setor" : "Sector"}<select required value={sectorId} onChange={event => setSectorId(event.target.value)}><option value="">{pt ? "Selecionar setor" : "Select sector"}</option>{sectors.map(sector => <option key={sector.id} value={sector.id}>{sector.name}</option>)}</select></label></div>}
      {scope !== "sector" && <label>{pt ? "Projeto (opcional)" : "Project (optional)"}<select aria-label={pt ? "Projeto" : "Project"} value={projectId} onChange={event => { setProjectId(event.target.value); }}><option value="">{pt ? "Sem projeto" : "No project"}</option>{(scope === "team" ? scopeProjects : projects).map(project => <option value={project.id} key={project.id}>{project.name}</option>)}</select></label>}
      <footer><button type="button" disabled={busy} onClick={() => setCreating(false)}>{pt ? "Cancelar" : "Cancel"}</button><button className="meetings-primary" data-usage-action="meeting.create" disabled={busy}>{busy ? (pt ? "Criando…" : "Creating…") : (pt ? "Criar e abrir" : "Create and open")}</button></footer>
    </form></div>}
    <section className="meetings-list" aria-label={pt ? "Suas reuniões" : "Your meetings"}>
      {loading ? <p className="meetings-loading" role="status">{pt ? "Carregando reuniões…" : "Loading meetings…"}</p> : !visible.length ? <div className="meetings-empty"><MessageSquare size={28} aria-hidden="true" /><h2>{meetings.length ? (pt ? "Nenhuma reunião neste filtro" : "No meetings in this filter") : (pt ? "Seu próximo encontro começa aqui" : "Your next conversation starts here")}</h2><p>{pt ? "Crie uma reunião da equipe ou de um setor. A transcrição vira blocos organizados por assunto e a ata sai pronta para revisão." : "Create a team or sector meeting. The transcript becomes blocks organized by topic and minutes ready for review."}</p></div>
        : visible.map(meeting => <button className="meetings-card" key={meeting.id} onClick={() => void open(meeting).catch(fail)}>
          <span className={`meetings-card-icon ${meeting.status}`}><Video size={17} aria-hidden="true" /></span>
          <span className="meetings-card-copy"><strong>{meeting.title}</strong><small>{[scopeLabel(meeting), meeting.projectName].filter(Boolean).join(" · ")}</small></span>
          <span className="meetings-card-people">{meeting.participants.slice(0, meeting.participants.length > 3 ? 2 : 3).map(person => <Avatar key={person.userId} person={person} />)}{meeting.participants.length > 3 && <span className="meeting-avatar more">…</span>}</span>
          <span className="meetings-card-date"><CalendarDays size={13} aria-hidden="true" />{date(meeting.updatedAt || meeting.createdAt)}</span>
          <span className={`meetings-card-state ${meeting.status}`}>{statusLabel(meeting.status, pt)}</span>
        </button>)}
    </section>
  </main>;
}
