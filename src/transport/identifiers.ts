export const CLASS = {
  // tracker
  Project: 'tracker:class:Project' as const,
  Issue: 'tracker:class:Issue' as const,
  IssueStatus: 'tracker:class:IssueStatus' as const,
  Component: 'tracker:class:Component' as const,
  Milestone: 'tracker:class:Milestone' as const,
  TypeIssuePriority: 'tracker:class:TypeIssuePriority' as const,
  // task
  Task: 'task:class:Task' as const,
  // board
  Card: 'board:class:Card' as const,
  // calendar
  Event: 'calendar:class:Event' as const,
  // document
  Document: 'document:class:Document' as const,
  // contact
  Person: 'contact:class:Person' as const
} as const

export const SPACE = {
  Tx: 'core:space:Tx' as const
} as const

export type ClassRef = (typeof CLASS)[keyof typeof CLASS]