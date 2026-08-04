"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FeedListing, Stage } from "@/types";
import { PIPELINE_STAGES, SOURCE_LABEL, STAGE_LABEL, ALL_SOURCES } from "@/types";
import {
  CONTACT_ICON,
  CONTACT_LABEL,
  DEFAULT_PROFILE,
  draftTourMessage,
  smsLink,
  type Profile,
} from "@/lib/outreach";
import ListingCard from "@/components/ListingCard";
import ListingDrawer from "@/components/ListingDrawer";

type Tab = "feed" | "changes" | "pipeline" | "profile";

interface Change {
  id: number;
  listingId: string;
  kind: string;
  detail: string;
  occurredAt: string;
  address: string;
  neighborhood: string;
  price: number;
  url: string;
}

const money = (n: number) => `$${n.toLocaleString()}`;

export default function Home() {
  const [tab, setTab] = useState<Tab>("feed");
  const [listings, setListings] = useState<FeedListing[]>([]);
  const [changes, setChanges] = useState<Change[]>([]);
  const [profile, setProfile] = useState<Profile>(DEFAULT_PROFILE);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [status, setStatus] = useState("");
  const [open, setOpen] = useState<FeedListing | null>(null);

  // filters
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("best");
  const [priceMax, setPriceMax] = useState("");
  const [source, setSource] = useState("all");
  const [changedOnly, setChangedOnly] = useState(false);
  const [starredOnly, setStarredOnly] = useState(false);
  const [noFeeOnly, setNoFeeOnly] = useState(false);

  const loadFeed = useCallback(async () => {
    const params = new URLSearchParams({ sort, stage: "all" });
    if (query) params.set("q", query);
    if (priceMax) params.set("priceMax", priceMax);
    if (source !== "all") params.set("source", source);
    if (changedOnly) params.set("changed", "1");
    if (starredOnly) params.set("starred", "1");
    if (noFeeOnly) params.set("noFee", "1");

    const res = await fetch(`/api/feed?${params}`);
    const body = await res.json();
    if (body.error) setStatus(body.error);
    setListings(body.listings ?? []);
    setLoading(false);
  }, [query, sort, priceMax, source, changedOnly, starredOnly, noFeeOnly]);

  useEffect(() => {
    loadFeed();
  }, [loadFeed]);

  useEffect(() => {
    fetch("/api/changes")
      .then((r) => r.json())
      .then((b) => setChanges(b.changes ?? []))
      .catch(() => {});
    fetch("/api/profile")
      .then((r) => r.json())
      .then((b) => b.profile && setProfile(b.profile))
      .catch(() => {});
  }, []);

  async function refresh() {
    setRefreshing(true);
    setStatus("Checking all four sites…");
    try {
      const res = await fetch("/api/refresh", { method: "POST" });
      const body = await res.json();
      setStatus(
        body.error
          ? `Refresh failed: ${body.error}`
          : `${body.newListings} new · ${body.events} changes · ${body.fetched} seen`
      );
      await loadFeed();
      const c = await fetch("/api/changes").then((r) => r.json());
      setChanges(c.changes ?? []);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  }

  const patch = useCallback(
    async (id: string, body: Record<string, unknown>) => {
      await fetch(`/api/listings/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      await loadFeed();
    },
    [loadFeed]
  );

  /** Card-level shortcut: same CRM side effects as the drawer's button. */
  const textForTour = useCallback(
    async (listing: FeedListing) => {
      await patch(listing.id, {
        action: "contact",
        channel: "text",
        direction: "out",
        who: listing.contactName,
        note: "Tour request",
      });
      if (listing.stage === "inbox" || listing.stage === "interested") {
        await patch(listing.id, { action: "stage", stage: "contacted" });
      }
      window.location.href = smsLink(
        listing.contactPhone,
        draftTourMessage(listing, profile)
      );
    },
    [patch, profile]
  );

  const counts = useMemo(() => {
    const active = listings.filter((l) => l.isActive).length;
    const changed = listings.filter(
      (l) => l.unseenEvents > 0 || l.price !== l.originalPrice
    ).length;
    const inPipeline = listings.filter(
      (l) => l.stage !== "inbox" && l.stage !== "passed"
    ).length;
    return { active, changed, inPipeline };
  }, [listings]);

  async function saveProfile(next: Profile) {
    setProfile(next);
    await fetch("/api/profile", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile: next }),
    });
  }

  return (
    <div style={{ display: "flex", minHeight: "100dvh" }}>
      {/* ---------------- sidebar ---------------- */}
      <nav
        style={{
          width: 232,
          flexShrink: 0,
          borderRight: "1px solid var(--border)",
          background: "var(--surface)",
          padding: 16,
          display: "flex",
          flexDirection: "column",
          gap: 18,
          position: "sticky",
          top: 0,
          height: "100dvh",
          overflowY: "auto",
        }}
      >
        <div>
          <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-0.02em" }}>
            Homefinder
          </div>
          <div className="muted" style={{ fontSize: 11 }}>
            {counts.active} live · {counts.changed} changed
          </div>
        </div>

        <div style={{ display: "grid", gap: 2 }}>
          {(
            [
              ["feed", "Listings", counts.active],
              ["changes", "What changed", changes.length],
              ["pipeline", "My pipeline", counts.inPipeline],
              ["profile", "My details", 0],
            ] as [Tab, string, number][]
          ).map(([key, label, count]) => (
            <button
              key={key}
              className="nav-item"
              aria-current={tab === key}
              onClick={() => setTab(key)}
            >
              <span>{label}</span>
              {count > 0 && <span className="chip">{count}</span>}
            </button>
          ))}
        </div>

        {tab === "feed" && (
          <div style={{ display: "grid", gap: 10 }}>
            <div className="muted" style={{ fontSize: 11, fontWeight: 600 }}>
              FILTERS
            </div>
            <input
              className="field"
              placeholder="Search address, notes…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <input
              className="field"
              placeholder="Max rent"
              inputMode="numeric"
              value={priceMax}
              onChange={(e) => setPriceMax(e.target.value.replace(/[^\d]/g, ""))}
            />
            <select
              className="field"
              value={source}
              onChange={(e) => setSource(e.target.value)}
            >
              <option value="all">All sites</option>
              {ALL_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {SOURCE_LABEL[s]}
                </option>
              ))}
            </select>
            <select
              className="field"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="best">Best match</option>
              <option value="newest">Newest</option>
              <option value="cheapest">Cheapest</option>
              <option value="recent_change">Recently changed</option>
            </select>
            {(
              [
                ["Price changed", changedOnly, setChangedOnly],
                ["Starred only", starredOnly, setStarredOnly],
                ["No fee only", noFeeOnly, setNoFeeOnly],
              ] as [string, boolean, (v: boolean) => void][]
            ).map(([label, value, set]) => (
              <label
                key={label}
                style={{ display: "flex", gap: 8, fontSize: 13, alignItems: "center" }}
              >
                <input
                  type="checkbox"
                  checked={value}
                  onChange={(e) => set(e.target.checked)}
                />
                {label}
              </label>
            ))}
          </div>
        )}

        <button
          className="btn btn-primary"
          onClick={refresh}
          disabled={refreshing}
          style={{ marginTop: "auto" }}
        >
          {refreshing ? <span className="spin">◌</span> : null}
          {refreshing ? "Checking…" : "Check for new"}
        </button>
        {status && (
          <div className="muted" style={{ fontSize: 11 }}>
            {status}
          </div>
        )}
      </nav>

      {/* ---------------- main ---------------- */}
      <main style={{ flex: 1, padding: 20, minWidth: 0 }}>
        {loading && <div className="muted">Loading…</div>}

        {!loading && tab === "feed" && (
          <>
            {listings.length === 0 ? (
              <Empty onRefresh={refresh} />
            ) : (
              <div
                style={{
                  display: "grid",
                  gap: 14,
                  gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
                }}
              >
                {listings.map((listing) => (
                  <ListingCard
                    key={listing.id}
                    listing={listing}
                    onOpen={setOpen}
                    onStar={(l) => patch(l.id, { action: "star", starred: !l.starred })}
                    onPass={(l) => patch(l.id, { action: "feedback", value: "pass" })}
                    onText={textForTour}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {!loading && tab === "changes" && (
          <div className="surface" style={{ padding: 4 }}>
            {changes.length === 0 && (
              <div className="muted" style={{ padding: 16, fontSize: 13 }}>
                No changes yet. Once a listing you're tracking drops its price or goes
                off market, it shows up here.
              </div>
            )}
            {changes.map((c) => (
              <button
                key={c.id}
                onClick={() => {
                  const hit = listings.find((l) => l.id === c.listingId);
                  if (hit) setOpen(hit);
                }}
                style={{
                  all: "unset",
                  cursor: "pointer",
                  display: "flex",
                  gap: 12,
                  alignItems: "center",
                  padding: "10px 12px",
                  borderBottom: "1px solid var(--border)",
                  width: "100%",
                  boxSizing: "border-box",
                }}
              >
                <span
                  className={
                    c.kind === "price_drop"
                      ? "chip chip-good"
                      : c.kind === "price_rise" || c.kind === "delisted"
                        ? "chip chip-warn"
                        : "chip"
                  }
                >
                  {c.kind.replace(/_/g, " ")}
                </span>
                <span style={{ flex: 1, fontSize: 13, minWidth: 0 }}>
                  {c.address}
                  <span className="muted"> · {c.neighborhood}</span>
                </span>
                <span style={{ fontSize: 13 }}>{c.detail}</span>
                <span className="muted" style={{ fontSize: 11 }}>
                  {new Date(c.occurredAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              </button>
            ))}
          </div>
        )}

        {!loading && tab === "pipeline" && (
          <div style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 8 }}>
            {PIPELINE_STAGES.map((stage) => {
              const column = listings.filter((l) => l.stage === stage);
              return (
                <div key={stage} style={{ minWidth: 240, flex: 1 }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      marginBottom: 8,
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    <span>{STAGE_LABEL[stage]}</span>
                    <span className="muted">{column.length}</span>
                  </div>
                  <div style={{ display: "grid", gap: 8 }}>
                    {column.map((l) => (
                      <button
                        key={l.id}
                        className="surface"
                        onClick={() => setOpen(l)}
                        style={{
                          padding: 10,
                          textAlign: "left",
                          cursor: "pointer",
                          display: "grid",
                          gap: 4,
                        }}
                      >
                        <strong style={{ fontSize: 14 }}>{money(l.price)}</strong>
                        <span style={{ fontSize: 12 }}>
                          {l.address}
                          {l.unit ? ` #${l.unit}` : ""}
                        </span>
                        <span className="muted" style={{ fontSize: 11 }}>
                          {l.neighborhood}
                        </span>
                        {l.lastContactChannel && (
                          <span className="chip">
                            {CONTACT_ICON[l.lastContactChannel]}{" "}
                            {CONTACT_LABEL[l.lastContactChannel]}
                            {l.contactCount > 1 ? ` ×${l.contactCount}` : ""}
                          </span>
                        )}
                      </button>
                    ))}
                    {column.length === 0 && (
                      <div className="muted" style={{ fontSize: 12, padding: 8 }}>
                        Nothing here
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {!loading && tab === "profile" && (
          <ProfileForm profile={profile} onSave={saveProfile} />
        )}
      </main>

      {open && (
        <ListingDrawer
          listing={open}
          profile={profile}
          onClose={() => setOpen(null)}
          onChanged={loadFeed}
        />
      )}
    </div>
  );
}

function Empty({ onRefresh }: { onRefresh: () => void }) {
  return (
    <div className="surface" style={{ padding: 32, textAlign: "center" }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>Nothing here yet</div>
      <div className="muted" style={{ fontSize: 13, marginBottom: 14 }}>
        Pull listings from StreetEasy, Zillow, HotPads and Craigslist to get started.
      </div>
      <button className="btn btn-primary" onClick={onRefresh}>
        Check for new listings
      </button>
    </div>
  );
}

/**
 * The details that go into every outreach message. Filling this in once is what
 * makes "Text for tour" a single tap later.
 */
function ProfileForm({
  profile,
  onSave,
}: {
  profile: Profile;
  onSave: (p: Profile) => void;
}) {
  const [draft, setDraft] = useState(profile);
  useEffect(() => setDraft(profile), [profile]);

  const fields: [keyof Profile, string, string][] = [
    ["name", "Your name", "Jake Silver"],
    ["employer", "Where you work", "BetterCampus"],
    ["income", "Income", "$180k/yr"],
    ["creditNote", "Anything else that qualifies you", "credit in the 700s, no pets"],
    ["moveInDate", "Target move-in (YYYY-MM-DD)", "2026-09-01"],
    ["phone", "Your phone", "(212) 555-0134"],
    ["email", "Your email", "you@example.com"],
    ["extra", "Extra line for messages", ""],
  ];

  return (
    <div className="surface" style={{ padding: 20, maxWidth: 560, display: "grid", gap: 12 }}>
      <div>
        <div style={{ fontWeight: 600 }}>Your details</div>
        <div className="muted" style={{ fontSize: 12 }}>
          Used to fill in the tour request so it&apos;s one tap to send.
        </div>
      </div>
      {fields.map(([key, label, placeholder]) => (
        <label key={key} style={{ display: "grid", gap: 4, fontSize: 12 }}>
          <span className="muted">{label}</span>
          <input
            className="field"
            value={draft[key]}
            placeholder={placeholder}
            onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
          />
        </label>
      ))}
      <button className="btn btn-primary" onClick={() => onSave(draft)}>
        Save
      </button>
    </div>
  );
}
