export type MeetingParticipant = { userId: string; name: string; nickname: string; avatarUrl?: string | null; role: "host" | "participant"; lastSeenAt?: string | null };
export type MeetingScope = "private" | "team" | "sector";
export type MeetingScopeTeam = { id: string; name: string; projects: { id: string; name: string; sectors: { id: string; name: string }[] }[] };
export type MeetingSummary = {
  id: string; title: string; projectId: string | null; ownerId: string; hostUserId: string;
  memoryMode: "none" | "project"; roomKind: "meeting" | "beam"; revision: number;
  status: string; createdAt?: string; updatedAt?: string; participants: MeetingParticipant[];
  myRole?: "host" | "participant";
  example?: boolean; scope?: MeetingScope; teamId?: string | null; sectorId?: string | null; teamName?: string | null; sectorName?: string | null;
};
export type MeetingInvitation = { id: string; meetingId: string; meetingTitle?: string; title?: string; hostName?: string; status: string };
export type MeetingContribution = { id: string; sequence: number; userId: string; text: string; createdAt: string };

export function meetingFrameURL(id: string, roomKind: MeetingSummary["roomKind"]): string {
  const query = new URLSearchParams({ meeting: id });
  if (typeof window !== "undefined") { const reference = new URLSearchParams(window.location.search); if (reference.get("meeting") === id && /^[A-Za-z0-9_.:-]{1,160}$/.test(reference.get("event") || "")) query.set("event", reference.get("event")!); }
  return `/meeting/${encodeURIComponent(id)}?${query}${roomKind === "beam" ? "#simulacao" : "#reuniao"}`;
}

export function mergeContributions(previous: MeetingContribution[], incoming: MeetingContribution[]): MeetingContribution[] {
  const rows = new Map(previous.map(item => [item.id, item]));
  for (const item of incoming) rows.set(item.id, item);
  return [...rows.values()].sort((a, b) => a.sequence - b.sequence);
}

export function participantIsPresent(participant: MeetingParticipant, now = Date.now()): boolean {
  const timestamp = Date.parse(participant.lastSeenAt || "");
  return Number.isFinite(timestamp) && now >= timestamp && now - timestamp < 90_000;
}
