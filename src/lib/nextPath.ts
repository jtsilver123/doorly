/**
 * Where a link is allowed to send someone after it authenticates them.
 *
 * Both email landing routes take a `next` parameter, and both are reachable
 * from a URL we mail out. `new URL(next, base)` resolves `//evil.example.com`
 * and `https://evil.example.com` to a whole other origin, so an unchecked
 * value turns our own domain into an open redirect. That is the exact shape a
 * phishing link wants, because the address in the email really is ours.
 *
 * Only a same-site absolute path survives. Anything else falls back, which
 * costs a redirected user nothing and costs an attacker the whole trick.
 */
export function safeNext(value: string | null | undefined, fallback = "/"): string {
  if (!value) return fallback;
  // A single leading slash, and not the protocol-relative "//" that browsers
  // read as "same scheme, different host". Backslashes because some parsers
  // normalise "\\" to "//" and would let it through.
  if (!value.startsWith("/")) return fallback;
  if (value.startsWith("//") || value.startsWith("/\\")) return fallback;
  return value;
}
