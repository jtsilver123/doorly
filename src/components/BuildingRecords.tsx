"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { BuildingRecords as Records, RecordEntry } from "@/lib/nycdata";
import Icon from "@/components/Icon";

/**
 * The building's whole record, one report per line.
 *
 * The drawer's summary answers "is this building a problem" in four lines,
 * which is the right answer while you're deciding whether to bother. This is
 * the other question, asked by someone who has decided to bother: show me
 * every one. Violations, 311 calls on the block and bedbug filings in a
 * single reverse-chronological history, because a building's story is told by
 * the order things happened in, not by which city department filed them.
 *
 * Fetched only when opened. It's hundreds of rows from four public endpoints,
 * and nobody reads it on the way past.
 *
 * Portaled to the body: its caller lives inside the listing drawer, which is
 * a positioned animated element, so a fixed child would be laid out against
 * the drawer and trapped in its stacking context. Same trap as Lightbox.
 */

const KINDS: { key: RecordEntry["kind"] | "all"; label: string }[] = [
  { key: "all", label: "Everything" },
  { key: "violation", label: "Violations" },
  { key: "complaint", label: "311 calls" },
  { key: "bedbug", label: "Bedbugs" },
];

/** "2024-03-08" as a human date, and honest about a missing one. */
function stamp(iso: string): string {
  if (!iso) return "no date";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function BuildingRecords({
  listingId,
  address,
  onClose,
}: {
  listingId: string;
  /** The listing's own address, shown until the city's spelling arrives. */
  address: string;
  onClose: () => void;
}) {
  const [records, setRecords] = useState<Records | null>(null);
  const [error, setError] = useState("");
  const [kind, setKind] = useState<RecordEntry["kind"] | "all">("all");
  const [openOnly, setOpenOnly] = useState(false);
  /**
   * Off by default. 311's radius query returns the whole corner, and on a
   * busy block that is four hundred parking and taxi complaints in front of
   * the sixty things that are actually about this building. Available in one
   * tap for anyone who wants to know what the street is like.
   */
  const [withBlock, setWithBlock] = useState(false);
  const [query, setQuery] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/listings/${encodeURIComponent(listingId)}/records`)
      .then((r) => r.json())
      .then((body) => {
        if (!alive) return;
        if (body.records) setRecords(body.records);
        else setError(body.error ?? "The city's records didn't answer.");
      })
      .catch(() => alive && setError("The city's records didn't answer."));
    return () => {
      alive = false;
    };
  }, [listingId]);

  useEffect(() => {
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    // Capture, so Escape closes this rather than the drawer underneath it.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  /** Everything in scope, before the kind and text filters narrow it. */
  const inScope = useMemo(
    () =>
      (records?.entries ?? []).filter((e) => withBlock || e.scope === "building"),
    [records, withBlock]
  );

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return inScope.filter((e) => {
      if (kind !== "all" && e.kind !== kind) return false;
      if (openOnly && e.status.toLowerCase() !== "open") return false;
      if (!needle) return true;
      return `${e.title} ${e.detail} ${e.where}`.toLowerCase().includes(needle);
    });
  }, [inScope, kind, openOnly, query]);

  const openCount = useMemo(
    () => inScope.filter((e) => e.status.toLowerCase() === "open").length,
    [inScope]
  );
  /** Per-kind counts of what's in scope, so the chips never overstate. */
  const kindCounts = useMemo(() => {
    const n = { violation: 0, complaint: 0, bedbug: 0 };
    for (const e of inScope) n[e.kind]++;
    return n;
  }, [inScope]);

  const body = (
    <div
      className="records"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="records-panel"
        role="dialog"
        aria-modal="true"
        aria-label="The building's full record"
        tabIndex={-1}
        ref={panelRef}
      >
        <header className="records-head">
          <div className="records-title">
            <h2>The building&apos;s record</h2>
            <p className="muted">
              {records?.matched || address}
              {records && (
                <>
                  {" · "}
                  {inScope.length.toLocaleString()} report
                  {inScope.length === 1 ? "" : "s"}
                  {openCount > 0 && `, ${openCount} still open`}
                  {!withBlock && records.block > 0 && ` · ${records.block} more on the block`}
                </>
              )}
            </p>
          </div>
          <button className="btn records-x" onClick={onClose} aria-label="Close">
            <Icon name="close" size={16} />
          </button>
        </header>

        {records && records.entries.length > 0 && (
          <div className="records-tools">
            <div className="records-kinds" role="tablist" aria-label="Filter by kind">
              {KINDS.map((k) => {
                const n = k.key === "all" ? inScope.length : kindCounts[k.key];
                if (k.key !== "all" && n === 0) return null;
                return (
                  <button
                    key={k.key}
                    role="tab"
                    aria-selected={kind === k.key}
                    className={kind === k.key ? "pill is-on" : "pill"}
                    onClick={() => setKind(k.key)}
                  >
                    {k.label} <span className="records-n">{n}</span>
                  </button>
                );
              })}
              {openCount > 0 && (
                <button
                  className={openOnly ? "pill is-on" : "pill"}
                  aria-pressed={openOnly}
                  onClick={() => setOpenOnly((v) => !v)}
                >
                  Open only
                </button>
              )}
              {records.block > 0 && (
                <button
                  className={withBlock ? "pill is-on" : "pill"}
                  aria-pressed={withBlock}
                  onClick={() => setWithBlock((v) => !v)}
                  title="311 calls from the surrounding street, not this address"
                >
                  Include the block <span className="records-n">{records.block}</span>
                </button>
              )}
            </div>
            <input
              className="field records-search"
              value={query}
              placeholder="Search these reports"
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search the building's reports"
            />
          </div>
        )}

        <div className="records-scroll">
          {error ? (
            <p className="warn-text records-note">{error}</p>
          ) : !records ? (
            <ul className="records-list" aria-busy="true">
              {Array.from({ length: 6 }, (_, i) => (
                <li key={i} className="records-row">
                  <div className="skeleton skeleton-line" style={{ width: "22%" }} />
                  <div className="skeleton skeleton-line" style={{ width: "80%" }} />
                </li>
              ))}
            </ul>
          ) : records.entries.length === 0 ? (
            <p className="muted records-note">
              Nothing on file for this address. That is genuinely good news, and
              also worth a sanity check: buildings sometimes file under a
              different street spelling than the listing uses.
            </p>
          ) : shown.length === 0 ? (
            <p className="muted records-note">
              {inScope.length === 0
                ? "Nothing filed against the building itself."
                : "No reports match that."}{" "}
              <button
                className="linkish"
                onClick={() => {
                  setQuery("");
                  setKind("all");
                  setOpenOnly(false);
                  setWithBlock(true);
                }}
              >
                Show all {records.entries.length}, block included
              </button>
            </p>
          ) : (
            <ul className="records-list">
              {shown.map((e, i) => (
                <li
                  key={`${e.kind}-${e.date}-${i}`}
                  className="records-row"
                  data-tone={e.tone}
                  data-scope={e.scope}
                >
                  <div className="records-when">
                    <span className="records-date">{stamp(e.date)}</span>
                    <span className="records-kind">
                      {labelFor(e.kind)}
                      {e.scope === "block" && <em>nearby</em>}
                    </span>
                  </div>
                  <div className="records-what">
                    <span className="records-headline">
                      <b>{e.title}</b>
                      {e.status && (
                        <span
                          className={
                            e.status.toLowerCase() === "open"
                              ? "tag tag-amber"
                              : "tag tag-grey"
                          }
                        >
                          {e.status}
                        </span>
                      )}
                      {e.where && <span className="muted records-where">{e.where}</span>}
                    </span>
                    {e.detail && <p className="records-detail">{e.detail}</p>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* An empty section and a section that failed to load look identical,
            and on this screen that difference is the whole point. */}
        {records?.partial && (
          <p className="warn-text records-partial" role="status">
            One of the city&apos;s datasets didn&apos;t answer just now, so this
            list is incomplete. Reopening it tries again.
          </p>
        )}

        <footer className="records-foot muted">
          {records?.truncated
            ? "Showing the most recent reports; older ones are trimmed. "
            : ""}
          NYC Open Data: HPD violations and the bedbug registry filed against
          this address, plus 311 calls going back two years. Calls from the
          surrounding street are marked nearby and hidden until you ask for
          them. Public record, not a judgment.
        </footer>
      </div>
    </div>
  );

  return typeof document === "undefined" ? null : createPortal(body, document.body);
}

function labelFor(kind: RecordEntry["kind"]): string {
  if (kind === "violation") return "HPD";
  if (kind === "complaint") return "311";
  return "Bedbugs";
}
