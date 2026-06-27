// Class ID registry for every surface in scope.
// Reference: ~/platform/models/<m>/src/index.ts `@Model(...)` declarations.

export const CLASS = {
  // core
  Account: 'core:class:Account' as const,
  Region: 'core:class:Region' as const,
  Space: 'core:class:Space' as const,
  SpaceType: 'core:class:SpaceType' as const,
  Permission: 'core:class:Permission' as const,
  Association: 'core:class:Association' as const,
  Relation: 'core:class:Relation' as const,
  Person: 'contact:class:Person' as const,

  // tracker
  Project: 'tracker:class:Project' as const,
  ProjectType: 'tracker:class:ProjectType' as const,
  TaskType: 'tracker:class:TaskType' as const,
  ProjectTargetPreference: 'tracker:class:ProjectTargetPreference' as const,
  Issue: 'tracker:class:Issue' as const,
  IssueStatus: 'tracker:class:IssueStatus' as const,
  IssueTemplate: 'tracker:class:IssueTemplate' as const,
  Component: 'tracker:class:Component' as const,
  Milestone: 'tracker:class:Milestone' as const,
  TypeIssuePriority: 'tracker:class:TypeIssuePriority' as const,
  RelatedIssueTarget: 'tracker:class:RelatedIssueTarget' as const,

  // task
  Task: 'task:class:Task' as const,

  // board (the Card module — distinct from the Board module which is out of scope)
  Card: 'board:class:Card' as const,
  CardSpace: 'card:class:CardSpace' as const,
  MasterTag: 'card:class:MasterTag' as const,

  // calendar
  Calendar: 'calendar:class:Calendar' as const,
  Event: 'calendar:class:Event' as const,
  ReccuringEvent: 'calendar:class:ReccuringEvent' as const,
  ReccuringInstance: 'calendar:class:ReccuringInstance' as const,
  Schedule: 'calendar:class:Schedule' as const,

  // document
  Document: 'document:class:Document' as const,
  DocumentSnapshot: 'document:class:DocumentSnapshot' as const,
  DocumentEmbedding: 'document:class:DocumentEmbedding' as const,
  Teamspace: 'document:class:Teamspace' as const,

  // chunter (chat)
  Channel: 'chunter:class:Channel' as const,
  ChatMessage: 'chunter:class:ChatMessage' as const,
  DirectMessage: 'chunter:class:DirectMessage' as const,
  Message: 'chunter:class:Message' as const,
  ThreadMessage: 'chunter:class:ThreadMessage' as const,

  // time
  TimeSpendReport: 'time:class:TimeSpendReport' as const,
  WorkSlot: 'time:class:WorkSlot' as const,

  // activity
  ActivityMessage: 'activity:class:ActivityMessage' as const,

  // notification
  Notification: 'notification:class:Notification' as const,

  // request (approvals)
  Request: 'request:class:Request' as const
} as const

export const SPACE = {
  Tx: 'core:space:Tx' as const,
  PersonalTaskList: 'task:space:MyTasks' as const,
  DocumentRoot: 'document:space:Document' as const,
  CalendarPersonal: 'calendar:space:Personal' as const
} as const

export type ClassRef = (typeof CLASS)[keyof typeof CLASS]

// Status categories from `tracker:class:IssueStatus`. Match MCP / huly-mcp
// server behaviour so `--status-category` filtering stays in sync.
export const STATUS_CATEGORIES = ['UnStarted', 'ToDo', 'Active', 'Won', 'Lost'] as const
export type StatusCategory = (typeof STATUS_CATEGORIES)[number]
