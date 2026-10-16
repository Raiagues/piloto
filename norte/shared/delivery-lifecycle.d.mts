export interface Lifecycle { profile:string; startDate:string; durations:number[]; selectedReviews?:string[]; }
export interface ReviewDefinition { id:string;title:string;english?:string;phase:number;position:number;lane:number;week?:number;active:boolean;focus:string; }
export interface LifecycleRange {code:string;name:string;index:number;start:string;end:string;}
export const REVIEW_PROFILES:Record<string,ReviewDefinition[]>;
export const LIFE_PHASES:Record<string,string[][]>;
export const LIFE_DURATIONS:Record<string,number[]>;
export const LIFE_LANES:string[];
export const DOCUMENT_DEFINITIONS:Record<string,unknown>[];
export const ENGINEERING_SOURCES:Record<string,Record<string,string>>;
export function shiftDate(date:string,days:number):string;
export function lifecycleRanges(lifecycle:Lifecycle):LifecycleRange[];
export function lifecycleMilestones(lifecycle:Lifecycle):(ReviewDefinition & {date:string})[];
export function reviewDocuments(profile:string,code:string):Record<string,unknown>[];
