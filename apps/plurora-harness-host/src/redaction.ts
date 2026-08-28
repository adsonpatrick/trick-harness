/**
 * What this host refuses to journal, wherever it came from.
 *
 * Two boundaries need the same judgement — the project's database command and
 * a provider's own final output — and both are places a credential realistically
 * appears. Stating the rule once means the two cannot drift into disagreeing
 * about what a secret looks like.
 *
 * @module apps/plurora-harness-host/redaction
 */

/**
 * Text shaped like a credential.
 *
 * Deliberately shaped rather than exhaustive. It cannot catch every secret a
 * process could print, and it is not the last line of defence — each boundary
 * already drops every field it did not validate. What it catches is the
 * realistic accident: a tool or a model that helpfully includes the connection
 * string or bearer token it just used in the line it summarises itself with.
 */
const SECRET_SHAPED = [
  // A URL carrying userinfo: the shape a connection string takes.
  /\b[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s/@]*:[^\s/@]*@/,
  // The prefixes the common token formats announce themselves with.
  /\b(?:sk|pk|ghp|gho|xox[abps])[-_][A-Za-z0-9_-]{10,}/,
  // An authorization header pasted into a message.
  /\b[Bb]earer\s+[A-Za-z0-9._-]{10,}/,
]

/**
 * Whether `value` carries something credential-shaped.
 *
 * @param value - the text about to be kept.
 * @returns true when it must not be journalled.
 */
export function looksLikeSecret(value: string): boolean {
  return SECRET_SHAPED.some(pattern => pattern.test(value))
}
