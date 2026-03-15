// Vault file path mappings
export const VAULT_FILES = {
  aboutMe: 'Core Memory/About me.md',
  goals: 'Core Memory/Goals.md',
  morningBrief: (date: string) => `0 - Daily Briefs/${date}.md`,
  todos: (date: string) => `3 - Todos/${date}.md`,
  calls: (date: string) => `1 - Inbox (Last 7 days)/Calendar/${date}.md`,
} as const

export type VaultFileType = 'aboutMe' | 'goals' | 'morningBrief' | 'todos' | 'calls'
