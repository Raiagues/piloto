export type Language = "pt" | "en";
export type NodeState = "defined" | "hypothesis" | "open" | "closed";
export type LinkType = "normal" | "suggestion";
export type NodeBucket = "main" | "ideas" | "questions";

export type MissionNode = {
  id: number;
  x: number;
  y: number;
  width: number;
  titleKey?: string;
  title?: string;
  kickerKey: string;
  state: NodeState;
  type?: "normal" | "center" | "question" | "suggestion";
  issueKey?: string;
  bucket?: NodeBucket;
  originLabNodeId?: string;
  domainId?: string;
};

export type MissionLink = {
  id: number;
  from: number;
  to: number;
  type: LinkType;
  sourceSide?: "top" | "right" | "bottom" | "left";
  targetSide?: "top" | "right" | "bottom" | "left";
  sourceOrder?: number;
  targetOrder?: number;
  originLabLinkId?: string;
};

export type IssueSuggestion = {
  titleKey: string;
  descriptionKey: string;
};

export type MissionIssue = {
  key: string;
  titleKey: string;
  descriptionKey: string;
  nodeIds: number[];
  severity: "critical" | "gap";
  suggestions: IssueSuggestion[];
};

export type Checkpoint = {
  key: string;
  nameKey: string;
  descriptionKey: string;
  state: NodeState;
  evidence: MissionNode[];
  mandatory: boolean;
};
