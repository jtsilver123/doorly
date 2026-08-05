/**
 * Phone entry.
 *
 * A number you dug up gets typed in once, under time pressure, usually off a
 * sign or a text somebody forwarded you — so it arrives as "212.555.0134",
 * "+1 (212) 555 0134", or ten digits with no punctuation at all. Storing it
 * verbatim means the same broker looks like three different contacts, and
 * means the tel:/sms: link is a coin toss.
 *
 * So the field only accepts digits and formats them as you type. Nothing is
 * rejected mid-entry — a half-typed number has to be allowed to exist, or the
 * field fights you on every keystroke.
 */

/** Just the digits, with the US country code dropped if it's there. */
export function phoneDigits(input: string): string {
  const digits = input.replace(/\D/g, "");
  // 1-212-555-0134 and 212-555-0134 are the same number.
  const local = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return local.slice(0, 10);
}

/**
 * Format for display as it's typed: 2 -> "2", 212 -> "(212)", 2125 ->
 * "(212) 5", and so on to "(212) 555-0134".
 *
 * Deliberately no trailing "(" or "-" on an exact boundary: appending a
 * separator the moment you finish a group makes backspace feel broken, because
 * deleting the character you just typed leaves the separator behind and the
 * cursor doesn't move.
 */
export function formatPhone(input: string): string {
  const d = phoneDigits(input);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

/** Ten digits, or it isn't a number anyone can call. */
export function isCompletePhone(input: string): boolean {
  return phoneDigits(input).length === 10;
}

/** E.164, for `tel:` and `sms:` links. Empty when there aren't ten digits. */
export function phoneHref(input: string): string {
  const d = phoneDigits(input);
  return d.length === 10 ? `+1${d}` : "";
}
