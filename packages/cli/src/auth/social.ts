// Server-side socialId lookups expect the full `type:value` key (e.g. `email:alice@example.com`).
// CLI callers naturally pass a bare value (`alice@example.com`); normalize the input
// before sending. Values that already include a `:` (e.g. `github:octocat`) are passed
// through unchanged so callers can look up non-email social IDs.

/**
 * Normalizes a social identifier for server-side lookup.
 *
 * @param input - The identifier to normalize.
 * @param type - The social ID type to prefix when `input` is a bare value.
 * @returns The normalized social key, or `input` unchanged when it is empty or already contains a type prefix.
 */
export function normalizeSocialKey (input: string, type: SocialIdType = 'email'): string {
  if (input == null || input === '') return input
  if (input.includes(':')) return input
  return `${type}:${input}`
}

export type SocialIdType = 'email' | 'github' | 'google' | 'openid' | 'phone' | 'telegram'
