import type { PlatformPerson } from '../pages/PeoplePage';
export type Conversation = { id:string; projectId:string|null; teamId?:string; sectorId?:string; title:string; kind:string; participants:PlatformPerson[]; updatedAt:string; unread:number; lastMessage:string };
export type ChatMessage = { id:string; sequence:number; senderId:string; body:string; createdAt:string; source?:string; link?:string; attachment?:{id:string;name:string;url:string} };
export type ChatScope = {kind:'team'|'sector';teamId:string;projectId?:string;sectorId?:string;title:string};
export type ChatAttachment = {dataUrl:string;name:string};
export const conversationLabel = (conversation:Conversation,userId?:string) => conversation.title || conversation.participants.filter(p=>p.id!==userId).map(p=>p.name).join(', ');
