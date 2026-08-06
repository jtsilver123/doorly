/**
 * The icon set.
 *
 * Everything here replaces a Unicode character that was standing in for an
 * icon — ◎ ▤ ↯ ▦ ⇄ ◍ in the nav, ⌕ in search, ☰ on the filter button, 💬 on
 * the text action, ⚠ on flags. Those render differently on every platform,
 * can't inherit stroke weight, sit on their own baseline, and read as
 * placeholder art, because that's what they are.
 *
 * One grid (24), one stroke (1.75), round caps and joins, no fills. Drawn so
 * the family reads as a family: the same door arch appears in `today` and in
 * the logo, the same card rectangle in `listings` and `pipeline`.
 *
 * `currentColor` throughout, so an icon is coloured by the thing it sits in
 * rather than needing a variant per context.
 */

export type IconName =
  | "today"
  | "listings"
  | "changes"
  | "pipeline"
  | "compare"
  | "profile"
  | "play"
  | "image"
  | "video"
  | "search"
  | "filter"
  | "sort"
  | "message"
  | "phone"
  | "mail"
  | "external"
  | "star"
  | "close"
  | "check"
  | "alert"
  | "chevron"
  | "chevron-left"
  | "chevron-right"
  | "plus"
  | "calendar"
  | "people"
  | "bell";

const PATHS: Record<IconName, React.ReactNode> = {
  // A door with an arch — the same shape as the mark, so the home tab and the
  // logo are visibly the same idea.
  today: (
    <>
      <path d="M6 21V9.5a6 6 0 0 1 12 0V21" />
      <path d="M3.5 21h17" />
      <path d="M14.2 14.6h.01" />
    </>
  ),
  listings: (
    <>
      <rect x="3" y="4" width="18" height="7" rx="1.6" />
      <rect x="3" y="14" width="18" height="7" rx="1.6" />
    </>
  ),
  // A price line that steps down — what the Changes tab is actually about.
  changes: (
    <>
      <path d="M3 8h4l3 9 4-13 3 7h4" />
    </>
  ),
  pipeline: (
    <>
      <rect x="3" y="4" width="5" height="16" rx="1.4" />
      <rect x="9.5" y="4" width="5" height="11" rx="1.4" />
      <rect x="16" y="4" width="5" height="7" rx="1.4" />
    </>
  ),
  compare: (
    <>
      <path d="M4 8h13M13.5 4.5 17 8l-3.5 3.5" />
      <path d="M20 16H7M10.5 12.5 7 16l3.5 3.5" />
    </>
  ),
  profile: (
    <>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </>
  ),
  search: (
    <>
      <circle cx="10.8" cy="10.8" r="6.3" />
      <path d="m15.5 15.5 4 4" />
    </>
  ),
  // Sliders, not a hamburger: the panel behind it sets values, not navigation.
  filter: (
    <>
      <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </>
  ),
  sort: (
    <>
      <path d="M4 7h13M4 12h9M4 17h5" />
      <path d="M18 11.5v8M15.5 17l2.5 2.5 2.5-2.5" />
    </>
  ),
  message: (
    <>
      <path d="M20 12.5a7 7 0 0 1-7.5 7 8.6 8.6 0 0 1-3.2-.6L4.5 20.5l1.7-4.4A7 7 0 0 1 5 12.5a7 7 0 0 1 7.5-7 7 7 0 0 1 7.5 7Z" />
    </>
  ),
  phone: (
    <>
      <path d="M6.5 4h3l1.5 4-2 1.4a11 11 0 0 0 5.6 5.6l1.4-2 4 1.5v3a1.6 1.6 0 0 1-1.8 1.6A15.5 15.5 0 0 1 4.9 5.8 1.6 1.6 0 0 1 6.5 4Z" />
    </>
  ),
  mail: (
    <>
      <rect x="3" y="5.5" width="18" height="13" rx="2" />
      <path d="m3.8 7 8.2 6 8.2-6" />
    </>
  ),
  external: (
    <>
      <path d="M14 4h6v6" />
      <path d="m20 4-8.5 8.5" />
      <path d="M18 14.5V19a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 19V8a1.5 1.5 0 0 1 1.5-1.5H10" />
    </>
  ),
  star: (
    <>
      <path d="m12 4 2.5 5.1 5.6.8-4 4 .9 5.6-5-2.7-5 2.7.9-5.6-4-4 5.6-.8Z" />
    </>
  ),
  close: <path d="m6.5 6.5 11 11M17.5 6.5l-11 11" />,
  /* Filled, unlike the rest: a play badge sits on top of a photograph, and a
     1.75px outline disappears against a busy frame. */
  play: <path d="M9 6.5 18 12l-9 5.5Z" fill="currentColor" stroke="none" />,
  image: (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
      <path d="m4.5 16 4.2-4.2a1.6 1.6 0 0 1 2.2 0L15 15.5m-1.2-1.2 1.8-1.8a1.6 1.6 0 0 1 2.2 0l1.7 1.7" />
    </>
  ),
  video: (
    <>
      <rect x="2.5" y="6" width="13" height="12" rx="2.5" />
      <path d="m15.5 13 5 3V8l-5 3Z" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7" />,
  alert: (
    <>
      <path d="M12 4.5 21 20H3Z" />
      <path d="M12 10v4.5M12 17.4h.01" />
    </>
  ),
  chevron: <path d="m6 9.5 6 6 6-6" />,
  "chevron-left": <path d="m14.5 6-6 6 6 6" />,
  "chevron-right": <path d="m9.5 6 6 6-6 6" />,
  plus: <path d="M12 5.5v13M5.5 12h13" />,
  calendar: (
    <>
      <rect x="3.5" y="5.5" width="17" height="15" rx="2" />
      <path d="M3.5 10h17M8 3.5v4M16 3.5v4" />
    </>
  ),
  bell: (
    <>
      <path d="M12 4a5.5 5.5 0 0 0-5.5 5.5c0 4.2-1.5 5.6-2.5 6.5h16c-1-0.9-2.5-2.3-2.5-6.5A5.5 5.5 0 0 0 12 4Z" />
      <path d="M10 19.5a2 2 0 0 0 4 0" />
    </>
  ),
  people: (
    <>
      <circle cx="9" cy="8.5" r="3.2" />
      <path d="M3 19.5a6 6 0 0 1 12 0" />
      <path d="M16 5.7a3.2 3.2 0 0 1 0 5.6M17.5 14.4a6 6 0 0 1 3.5 5.1" />
    </>
  ),
};

export default function Icon({
  name,
  size = 18,
  className,
  filled = false,
}: {
  name: IconName;
  size?: number;
  className?: string;
  /** Star only: a saved listing reads as solid, an unsaved one as outline. */
  filled?: boolean;
}) {
  return (
    <svg
      className={className ? `icon ${className}` : "icon"}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
