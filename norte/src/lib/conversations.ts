import type { PlatformPerson } from '../pages/PeoplePage';
export type Conversation = { id:string; projectId:string|null; teamId?:string; sectorId?:string; title:string; kind:string; participants:PlatformPerson[]; updatedAt:string; unread:number; lastMessage:string };
export type ChatImage = {id:string;name:string;url:string};
export type ChatContentBlock = {type:'text';text:string}|{type:'image';image:ChatImage};
export type ChatDraftBlock = {id:string;type:'text';text:string}|{id:string;type:'image';image:ChatAttachment};
export type ChatMessage = { id:string; sequence:number; senderId:string; body:string; createdAt:string; source?:string; link?:string; blocks?:ChatContentBlock[]; attachment?:ChatImage };
export type ChatScope = {kind:'team'|'sector';teamId:string;projectId?:string;sectorId?:string;title:string};
export type ChatAttachment = {dataUrl:string;name:string};
export const conversationLabel = (conversation:Conversation,userId?:string) => conversation.title || conversation.participants.filter(p=>p.id!==userId).map(p=>p.name).join(', ');
export const messageContent = (message:ChatMessage):ChatContentBlock[] => message.blocks || [
  ...(message.body ? [{type:'text' as const,text:message.body}] : []),
  ...(message.attachment ? [{type:'image' as const,image:message.attachment}] : []),
];
