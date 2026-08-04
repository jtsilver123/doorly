"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FeedListing } from "@/types";
import { PIPELINE_STAGES, SOURCE_LABEL, STAGE_LABEL, ALL_SOURCES } from "@/types";
import {
  CONTACT_ICON,
  CONTACT_LABEL,
  DEFAULT_PROFILE,
  PROOF_OPTIONS,
  bestChannel,
  draftTourMessage,
  mailtoLink,
  smsLink,
  tourSubject,
  type Profile,
} from "@/lib/outreach";
import { daysUntil } from "@/lib/cost";
import ApplicationPacket from "@/components/ApplicationPacket";
import Toasts, { useToasts } from "@/components/Toasts";
import ListingCard, { orderedSources } from "@/components/ListingCard";
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

interface ApiStatus {
  usage: { used: number; limit: number; remaining: number; keyHint: string };
  hasKey: boolean;
  keyHint: string;
  monthlyLimit: number;
  pagesPerSource: number;
}

const money = (n: number) => `$${n.toLocaleString()}`;

export default function Home() {
  const [tab, setTab] = useState<Tab>("feed");
  const [listings, setListings] = useState<FeedListing[]>([]);
  const [changes, setChanges] = useState<Change[]>([]);
  const [profile, setProfile] = useState<Profile>(DEFAULT_PROFILE);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [open, setOpen] = useState<FeedListing | null>(null);
  const [adding, setAdding] = useState(false);
  const [api, setApi] = useState<ApiStatus | null>(null);
  const [focus, setFocus] = useState(0);
  const { toasts, push: toast, dismiss } = useToasts();

  // filters
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("best");
  const [priceMax, setPriceMax] = useState("");
  const [beds, setBeds] = useState("any");
  const [source, setSource] = useState("all");
  const [changedOnly, setChangedOnly] = useState(false);
  const [starredOnly, setStarredOnly] = useState(false);
  const [noFeeOnly, setNoFeeOnly] = useState(false);
  const [followUpOnly, setFollowUpOnly] = useState(false);
  const [readyOnly, setReadyOnly] = useState(false);

  const gridRef = useRef<HTMLDivElement>(null);

  const loadFeed = useCallback(async () => {
    const params = new URLSearchParams({ sort, stage: "all" });
    if (query) params.set("q", query);
    if (priceMax) params.set("priceMax", priceMax);
    if (beds !== "any") {
      params.set("bedsMin", beds);
      params.set("bedsMax", beds);
    }
    if (source !== "all") params.set("source", source);
    if (changedOnly) params.set("changed", "1");
    if (starredOnly) params.set("starred", "1");
    if (noFeeOnly) params.set("noFee", "1");
    if (followUpOnly) params.set("followUp", "1");
    if (readyOnly) params.set("readyBy", "1");

    const res = await fetch(`/api/feed?${params}`);
    const body = await res.json();
    if (body.error) toast({ message: body.error, tone: "warn" });
    setListings(body.listings ?? []);
    setLoading(false);
  }, [
    toast,
    query,
    sort,
    priceMax,
    beds,
    source,
    changedOnly,
    starredOnly,
    noFeeOnly,
    followUpOnly,
    readyOnly,
  ]);

  useEffect(() => {
    loadFeed();
  }, [loadFeed]);

  const loadChanges = useCallback(async () => {
    const body = await fetch("/api/changes").then((r) => r.json());
    setChanges(body.changes ?? []);
  }, []);

  const loadApi = useCallback(async () => {
    try {
      setApi(await fetch("/api/settings").then((r) => r.json()));
    } catch {
      /* settings are optional; the app still works from the env key */
    }
  }, []);

  useEffect(() => {
    loadChanges();
    loadApi();
    fetch("/api/profile")
      .then((r) => r.json())
      .then((b) => b.profile && setProfile({ ...DEFAULT_PROFILE, ...b.profile }))
      .catch(() => {});
  }, [loadChanges, loadApi]);

  async function refresh() {
    setRefreshing(true);

    try {
      const body = await fetch("/api/refresh", { method: "POST" }).then((r) => r.json());
      if (body.error) {
        toast({ message: body.error, tone: "warn" });
      } else if (body.newListings || body.events) {
        toast({
          message: `${body.newListings} new · ${body.events} changes`,
          tone: "good",
        });
      } else {
        toast({ message: "Nothing new since last check" });
      }
      await Promise.all([loadFeed(), loadChanges(), loadApi()]);
    } catch (err) {
      toast({
        message: err instanceof Error ? err.message : "Refresh failed",
        tone: "warn",
      });
    } finally {
      setRefreshing(false);
    }
  }

  const patch = useCallback(
    async (id: string, body: Record<string, unknown>, reload = true) => {
      await fetch(`/api/listings/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (reload) await loadFeed();
    },
    [loadFeed]
  );

  /**
   * Star and pass update the list immediately and reconcile in the background.
   * Waiting on a round trip for a keystroke is what made triage feel heavy —
   * at one card per second, a 300ms refetch is most of the interaction.
   */
  const star = useCallback(
    (listing: FeedListing) => {
      const next = !listing.starred;
      setListings((list) =>
        list.map((l) => (l.id === listing.id ? { ...l, starred: next } : l))
      );
      patch(listing.id, { action: "star", starred: next }, false).catch(() =>
        loadFeed()
      );
    },
    [patch, loadFeed]
  );

  const pass = useCallback(
    (listing: FeedListing) => {
      setListings((list) => list.filter((l) => l.id !== listing.id));
      setFocus((f) => Math.max(0, Math.min(f, listings.length - 2)));
      patch(listing.id, { action: "feedback", value: "pass" }, false).catch(() =>
        loadFeed()
      );
      toast({
        message: `Passed on ${listing.address}`,
        actionLabel: "Undo",
        onAction: () => {
          patch(listing.id, { action: "unpass" }, false)
            .then(loadFeed)
            .catch(() => loadFeed());
        },
      });
    },
    [patch, loadFeed, toast, listings.length]
  );

  /**
   * One "reach out" action whose behaviour depends on what the listing has.
   * Whatever the channel, the CRM is written first — an sms:/mailto: handoff
   * can unload the page before a later request lands.
   */
  const reachOut = useCallback(
    async (listing: FeedListing) => {
      const { channel } = bestChannel(listing);
      const message = draftTourMessage(listing, profile);

      await patch(
        listing.id,
        {
          action: "contact",
          channel,
          direction: "out",
          who: listing.contactName,
          note: "Tour request",
        },
        false
      );
      if (listing.stage === "inbox" || listing.stage === "interested") {
        await patch(listing.id, { action: "stage", stage: "contacted" }, false);
      }
      await loadFeed();

      if (channel === "text") {
        window.location.href = smsLink(listing.contactPhone, message);
      } else if (channel === "email") {
        window.location.href = mailtoLink(
          listing.contactEmail,
          tourSubject(listing),
          message
        );
      } else {
        // No published contact: put the draft on the clipboard and open the
        // listing, where the site's own enquiry form lives.
        try {
          await navigator.clipboard.writeText(message);
          toast({
            message: "Message copied — paste it into their contact form",
            tone: "good",
          });
        } catch {
          toast({ message: "Opened listing — copy the message from the detail panel" });
        }
        const target = orderedSources(listing)[0]?.url ?? listing.url;
        if (target) window.open(target, "_blank", "noopener");
      }
    },
    [patch, profile, loadFeed]
  );

  // --- keyboard triage -----------------------------------------------------
  // With hundreds of listings the bottleneck is triage speed, so the whole
  // feed is drivable without the mouse.
  useEffect(() => {
    if (tab !== "feed" || open) return;

    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const current = listings[focus];
      switch (e.key.toLowerCase()) {
        case "j":
        case "arrowdown":
          e.preventDefault();
          setFocus((f) => Math.min(f + 1, listings.length - 1));
          break;
        case "k":
        case "arrowup":
          e.preventDefault();
          setFocus((f) => Math.max(f - 1, 0));
          break;
        case "enter":
          if (current) {
            e.preventDefault();
            setOpen(current);
          }
          break;
        case "e":
          if (current) {
            e.preventDefault();
            reachOut(current);
          }
          break;
        case "x":
          if (current) {
            e.preventDefault();
            pass(current);
          }
          break;
        case "s":
          if (current) {
            e.preventDefault();
            star(current);
          }
          break;
        case "o":
          if (current) {
            e.preventDefault();
            const target = orderedSources(current)[0]?.url ?? current.url;
            if (target) window.open(target, "_blank", "noopener");
          }
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tab, open, listings, focus, pass, star, reachOut]);

  // Keep the focused card in view as you move through the list.
  useEffect(() => {
    const node = gridRef.current?.children[focus] as HTMLElement | undefined;
    node?.scrollIntoView({ block: "nearest" });
  }, [focus]);

  useEffect(() => setFocus(0), [query, sort, priceMax, beds, source]);

  const counts = useMemo(
    () => ({
      active: listings.filter((l) => l.isActive).length,
      changed: listings.filter((l) => l.unseenEvents > 0 || l.price !== l.originalPrice)
        .length,
      pipeline: listings.filter((l) => l.stage !== "inbox" && l.stage !== "passed").length,
      followUp: listings.filter((l) => l.needsFollowUp).length,
    }),
    [listings]
  );

  const daysToMove = daysUntil(profile.moveInDate);

  async function saveProfile(next: Profile) {
    setProfile(next);
    await fetch("/api/profile", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile: next }),
    });
    toast({ message: "Saved", tone: "good" });
  }

  return (
    <div className="shell">
      <nav className="sidebar">
        <div>
          <div className="brand">Homefinder</div>
          <div className="muted" style={{ fontSize: 11 }}>
            {counts.active} live · {counts.changed} changed
          </div>
          {daysToMove > 0 && (
            <div
              className={daysToMove <= 21 ? "warn-text" : "muted"}
              style={{ fontSize: 11, fontWeight: 600 }}
            >
              {daysToMove} days to move-in
            </div>
          )}
        </div>

        <div style={{ display: "grid", gap: 2 }}>
          {(
            [
              ["feed", "Listings", counts.active],
              ["changes", "What changed", changes.length],
              ["pipeline", "My pipeline", counts.pipeline],
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

        {counts.followUp > 0 && (
          <button
            className="callout"
            onClick={() => {
              setTab("feed");
              setFollowUpOnly(true);
            }}
          >
            <strong>{counts.followUp} waiting on a reply</strong>
            <span className="muted">Contacted 2+ days ago — chase them</span>
          </button>
        )}

        {tab === "feed" && (
          <div style={{ display: "grid", gap: 9 }}>
            <div className="muted section-label">FILTERS</div>
            <input
              className="field"
              placeholder="Address, neighborhood, notes"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div style={{ display: "flex", gap: 6 }}>
              <input
                className="field"
                placeholder="Max rent"
                inputMode="numeric"
                value={priceMax}
                onChange={(e) => setPriceMax(e.target.value.replace(/[^\d]/g, ""))}
              />
              <select
                className="field"
                value={beds}
                onChange={(e) => setBeds(e.target.value)}
              >
                <option value="any">Any beds</option>
                <option value="0">Studio</option>
                <option value="1">1 bed</option>
                <option value="2">2 bed</option>
              </select>
            </div>
            <select className="field" value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="all">All sites</option>
              {ALL_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {SOURCE_LABEL[s]}
                </option>
              ))}
            </select>
            <select className="field" value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="best">Best match</option>
              <option value="newest">Newest</option>
              <option value="effective">Cheapest (after concessions)</option>
              <option value="allin">Cheapest all-in</option>
              <option value="upfront">Least cash up front</option>
              <option value="cheapest">Cheapest sticker price</option>
              <option value="recent_change">Recently changed</option>
            </select>
            {(
              [
                ["Price changed", changedOnly, setChangedOnly],
                ["Starred", starredOnly, setStarredOnly],
                ["No fee", noFeeOnly, setNoFeeOnly],
                ["Needs follow-up", followUpOnly, setFollowUpOnly],
                ["Ready by my date", readyOnly, setReadyOnly],
              ] as [string, boolean, (v: boolean) => void][]
            ).map(([label, value, set]) => (
              <label key={label} className="check">
                <input
                  type="checkbox"
                  checked={value}
                  onChange={(e) => set(e.target.checked)}
                />
                {label}
              </label>
            ))}
            <div className="muted keyhint">
              <kbd>J</kbd>/<kbd>K</kbd> move · <kbd>E</kbd> reach out · <kbd>S</kbd> star ·{" "}
              <kbd>X</kbd> pass · <kbd>O</kbd> open · <kbd>↵</kbd> details
            </div>
          </div>
        )}

        {api?.usage && (
          <button className="usage" onClick={() => setTab("profile")} title="Manage API key">
            <div className="usage-top">
              <span>API requests</span>
              <span className={api.usage.remaining <= 25 ? "warn-text" : "muted"}>
                {api.usage.used}/{api.usage.limit}
              </span>
            </div>
            <div className="meter">
              <span
                style={{
                  width: `${Math.min(100, (api.usage.used / api.usage.limit) * 100)}%`,
                  background:
                    api.usage.remaining <= 25 ? "var(--warn)" : "var(--accent)",
                }}
              />
            </div>
            <div className="muted" style={{ fontSize: 10 }}>
              {api.usage.remaining} left this month · ~
              {Math.max(1, Math.floor(api.usage.remaining / 10))} more checks
            </div>
          </button>
        )}

        <div style={{ marginTop: "auto", display: "grid", gap: 6 }}>
          <button className="btn" onClick={() => setAdding(true)}>
            + Add a place
          </button>
          <button className="btn btn-primary" onClick={refresh} disabled={refreshing}>
            {refreshing ? "Checking…" : "Check for new"}
          </button>
  
        </div>
      </nav>

      <main className="main">
        {loading && (
          <div className="grid" aria-busy="true" aria-label="Loading listings">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="surface card skeleton-card">
                <div className="skeleton skeleton-media" />
                <div className="card-body">
                  <div className="skeleton skeleton-line" style={{ width: "45%", height: 16 }} />
                  <div className="skeleton skeleton-line" style={{ width: "80%" }} />
                  <div className="skeleton skeleton-line" style={{ width: "60%" }} />
                  <div className="skeleton skeleton-line" style={{ width: "100%", height: 30, marginTop: 6 }} />
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && tab === "feed" && (
          <>
            <div className="toolbar">
              <span className="muted" style={{ fontSize: 12 }}>
                {listings.length} listing{listings.length === 1 ? "" : "s"}
                {followUpOnly ? " needing follow-up" : ""}
              </span>
            </div>
            {listings.length === 0 ? (
              <Empty onRefresh={refresh} onAdd={() => setAdding(true)} />
            ) : (
              <div className="grid" ref={gridRef}>
                {listings.map((listing, i) => (
                  <ListingCard
                    key={listing.id}
                    listing={listing}
                    focused={i === focus}
                    onOpen={setOpen}
                    onStar={star}
                    onPass={pass}
                    onReach={reachOut}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {!loading && tab === "changes" && (
          <div className="surface" style={{ overflow: "hidden" }}>
            {changes.length === 0 && (
              <div className="muted" style={{ padding: 16, fontSize: 13 }}>
                Nothing has changed yet. Price drops, relists and places going off
                market will appear here after the next check.
              </div>
            )}
            {changes.map((c) => (
              <button
                key={c.id}
                className="row"
                onClick={() => {
                  const hit = listings.find((l) => l.id === c.listingId);
                  if (hit) setOpen(hit);
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
          <div className="board">
            {PIPELINE_STAGES.map((stage) => {
              const column = listings.filter((l) => l.stage === stage);
              return (
                <div key={stage} className="board-col">
                  <div className="board-head">
                    <span>{STAGE_LABEL[stage]}</span>
                    <span className="muted">{column.length}</span>
                  </div>
                  <div style={{ display: "grid", gap: 8 }}>
                    {column.map((l) => (
                      <button key={l.id} className="surface board-card" onClick={() => setOpen(l)}>
                        <strong style={{ fontSize: 14 }}>{money(l.price)}</strong>
                        <span style={{ fontSize: 12 }}>
                          {l.address}
                          {l.unit ? ` #${l.unit}` : ""}
                        </span>
                        <span className="muted" style={{ fontSize: 11 }}>
                          {l.neighborhood}
                        </span>
                        <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                          {l.lastContactChannel && (
                            <span className="chip">
                              {CONTACT_ICON[l.lastContactChannel]}{" "}
                              {CONTACT_LABEL[l.lastContactChannel]}
                            </span>
                          )}
                          {l.needsFollowUp && <span className="chip chip-warn">follow up</span>}
                        </span>
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
          <div style={{ display: "grid", gap: 16 }}>
            <ProfileForm profile={profile} onSave={saveProfile} />
            <ApplicationPacket profile={profile} onSave={saveProfile} />
            <ApiSettings status={api} onSaved={loadApi} />
          </div>
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

      <Toasts toasts={toasts} onDismiss={dismiss} />

      {adding && (
        <AddListing
          onClose={() => setAdding(false)}
          onAdded={async () => {
            setAdding(false);
            await loadFeed();
            toast({ message: "Added to your pipeline", tone: "good" });
          }}
        />
      )}
    </div>
  );
}

function Empty({ onRefresh, onAdd }: { onRefresh: () => void; onAdd: () => void }) {
  return (
    <div className="surface" style={{ padding: 32, textAlign: "center" }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>Nothing matches</div>
      <div className="muted" style={{ fontSize: 13, marginBottom: 14 }}>
        Loosen the filters, pull fresh listings, or add a place you found yourself.
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
        <button className="btn btn-primary" onClick={onRefresh}>
          Check for new listings
        </button>
        <button className="btn" onClick={onAdd}>
          Add a place
        </button>
      </div>
    </div>
  );
}

/** Anything the scrapers missed still belongs in the pipeline. */
function AddListing({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [form, setForm] = useState({
    address: "",
    price: "",
    bedrooms: "0",
    neighborhood: "",
    url: "",
    contactName: "",
    contactPhone: "",
    contactEmail: "",
    notes: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setBusy(true);
    setError("");
    const res = await fetch("/api/listings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...form, price: Number(form.price) }),
    });
    const body = await res.json();
    setBusy(false);
    if (body.error) setError(body.error);
    else onAdded();
  }

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: e.target.value });

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label="Add a place">
        <header className="drawer-head">
          <strong>Add a place</strong>
          <button className="btn" onClick={onClose}>
            ✕
          </button>
        </header>
        <div style={{ padding: 16, display: "grid", gap: 10, overflowY: "auto" }}>
          <div className="muted" style={{ fontSize: 12 }}>
            For somewhere a friend sent you, a broker emailed, or a sign in a window.
            It joins the same pipeline and outreach flow as everything else.
          </div>
          {(
            [
              ["address", "Address *", "55 Morton Street #5J"],
              ["price", "Monthly rent *", "3500"],
              ["bedrooms", "Bedrooms (0 = studio)", "1"],
              ["neighborhood", "Neighborhood", "West Village"],
              ["url", "Link", "https://…"],
              ["contactName", "Agent / landlord", "Jane at Corcoran"],
              ["contactPhone", "Their phone", "(212) 555-0134"],
              ["contactEmail", "Their email", "jane@example.com"],
              ["notes", "Notes", "Saw a sign in the window"],
            ] as [keyof typeof form, string, string][]
          ).map(([key, label, placeholder]) => (
            <label key={key} style={{ display: "grid", gap: 4, fontSize: 12 }}>
              <span className="muted">{label}</span>
              <input
                className="field"
                value={form[key]}
                placeholder={placeholder}
                onChange={set(key)}
              />
            </label>
          ))}
          {error && (
            <div style={{ color: "var(--warn)", fontSize: 12 }}>{error}</div>
          )}
          <button
            className="btn btn-primary"
            disabled={busy || !form.address || !form.price}
            onClick={submit}
          >
            {busy ? "Adding…" : "Add to pipeline"}
          </button>
        </div>
      </aside>
    </>
  );
}

/**
 * API key and request budget.
 *
 * The free tier is 250 requests a month and a poll costs roughly ten, so the
 * allowance is a real limit rather than a detail — it needs to be visible, and
 * swapping in a fresh trial key has to be possible without redeploying.
 */
function ApiSettings({
  status,
  onSaved,
}: {
  status: ApiStatus | null;
  onSaved: () => void;
}) {
  const [key, setKey] = useState("");
  const [pages, setPages] = useState(String(status?.pagesPerSource ?? 1));
  const [limit, setLimit] = useState(String(status?.monthlyLimit ?? 250));
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!status) return;
    setPages(String(status.pagesPerSource));
    setLimit(String(status.monthlyLimit));
  }, [status]);

  // 4 areas x pages for Zillow and HotPads, plus 2 bed values for StreetEasy.
  const perPoll = Number(pages) * 10;
  const polls = status ? Math.floor(status.usage.remaining / Math.max(perPoll, 1)) : 0;

  async function save() {
    setBusy(true);
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        realtyApiKey: key || undefined,
        pagesPerSource: Number(pages),
        monthlyLimit: Number(limit),
      }),
    });
    setKey("");
    setBusy(false);
    setNote("Saved");
    onSaved();
  }

  return (
    <div className="surface" style={{ padding: 20, maxWidth: 560, display: "grid", gap: 12 }}>
      <div>
        <div style={{ fontWeight: 600 }}>API key & usage</div>
        <div className="muted" style={{ fontSize: 12 }}>
          StreetEasy, Zillow and HotPads all run on one RealtyAPI key. Craigslist
          needs none, so it keeps working when the quota is gone.
        </div>
      </div>

      {status && (
        <div style={{ display: "grid", gap: 6 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
            <span>
              {status.usage.used} of {status.usage.limit} requests used
            </span>
            <span className="muted">key {status.keyHint}</span>
          </div>
          <div className="meter">
            <span
              style={{
                width: `${Math.min(100, (status.usage.used / status.usage.limit) * 100)}%`,
                background: status.usage.remaining <= 25 ? "var(--warn)" : "var(--accent)",
              }}
            />
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            {status.usage.remaining} left — about {polls} more checks at {perPoll}{" "}
            requests each. Usage resets when you paste a new key.
          </div>
        </div>
      )}

      <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
        <span className="muted">New API key</span>
        <input
          className="field"
          value={key}
          placeholder="rt_…"
          onChange={(e) => setKey(e.target.value)}
        />
      </label>

      <div style={{ display: "flex", gap: 8 }}>
        <label style={{ display: "grid", gap: 4, fontSize: 12, flex: 1 }}>
          <span className="muted">Pages per source</span>
          <select className="field" value={pages} onChange={(e) => setPages(e.target.value)}>
            <option value="1">1 — lightest (~10/check)</option>
            <option value="2">2 — deeper (~20/check)</option>
            <option value="3">3 — thorough (~30/check)</option>
          </select>
        </label>
        <label style={{ display: "grid", gap: 4, fontSize: 12, flex: 1 }}>
          <span className="muted">Monthly allowance</span>
          <input
            className="field"
            value={limit}
            inputMode="numeric"
            onChange={(e) => setLimit(e.target.value.replace(/[^\d]/g, ""))}
          />
        </label>
      </div>

      <div className="muted" style={{ fontSize: 11 }}>
        Listings are sorted newest-first, so one page catches everything fresh.
        Raise it only when you want to backfill deeper history.
      </div>

      <button className="btn btn-primary" onClick={save} disabled={busy}>
        {busy ? "Saving…" : "Save"}
      </button>
      {note && (
        <span className="muted" style={{ fontSize: 12 }}>
          {note}
        </span>
      )}
    </div>
  );
}

/**
 * The details every outreach message is built from. Filling this in once is
 * what makes reaching out a single keystroke afterwards.
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

  const owner = draft.employment === "self_employed";

  function toggleProof(proof: string) {
    setDraft({
      ...draft,
      proofs: draft.proofs.includes(proof)
        ? draft.proofs.filter((p) => p !== proof)
        : [...draft.proofs, proof],
    });
  }

  const text: [keyof Profile, string, string][] = [
    ["name", "Your name", "Jake Silver"],
    ["employer", owner ? "Your business" : "Where you work", "BetterCampus"],
    [
      "income",
      owner ? "Income shown on your 2025 return" : "Your income",
      "$240,000",
    ],
    ["moveInDate", "Target move-in", "2026-09-01"],
    ["phone", "Your phone", "(212) 555-0134"],
    ["email", "Your email", "you@example.com"],
    ["creditNote", "Anything else worth saying", "credit in the 700s, no pets"],
  ];

  return (
    <div className="surface" style={{ padding: 20, maxWidth: 560, display: "grid", gap: 14 }}>
      <div>
        <div style={{ fontWeight: 600 }}>Your details</div>
        <div className="muted" style={{ fontSize: 12 }}>
          These fill in every tour request, so you only write them once.
        </div>
      </div>

      <div style={{ display: "grid", gap: 4 }}>
        <span className="muted" style={{ fontSize: 12 }}>
          How you earn
        </span>
        <div style={{ display: "flex", gap: 6 }}>
          {(
            [
              ["self_employed", "I own a business"],
              ["employed", "I'm employed"],
              ["other", "Other"],
            ] as [Profile["employment"], string][]
          ).map(([value, label]) => (
            <button
              key={value}
              className={draft.employment === value ? "btn btn-primary" : "btn"}
              style={{ fontSize: 12 }}
              onClick={() => setDraft({ ...draft, employment: value })}
            >
              {label}
            </button>
          ))}
        </div>
        {owner && (
          <div className="muted" style={{ fontSize: 11 }}>
            No salary to quote is the usual objection. Put the figure from your
            return above and the message cites it as documented income.
          </div>
        )}
      </div>

      {text.map(([key, label, placeholder]) => (
        <label key={key} style={{ display: "grid", gap: 4, fontSize: 12 }}>
          <span className="muted">{label}</span>
          <input
            className="field"
            value={String(draft[key] ?? "")}
            placeholder={placeholder}
            onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
          />
        </label>
      ))}

      <div style={{ display: "grid", gap: 6 }}>
        <span className="muted" style={{ fontSize: 12 }}>
          What you can show
        </span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {PROOF_OPTIONS.map((proof) => (
            <button
              key={proof}
              className={draft.proofs.includes(proof) ? "btn btn-primary" : "btn"}
              style={{ fontSize: 12, padding: "4px 9px" }}
              onClick={() => toggleProof(proof)}
            >
              {proof}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gap: 4 }}>
        <span className="muted" style={{ fontSize: 12 }}>
          Preview
        </span>
        <pre className="preview">
          {draftTourMessage(
            {
              address: "55 Morton Street",
              unit: "5J",
              price: 3500,
              neighborhood: "West Village",
            } as FeedListing,
            draft
          )}
        </pre>
      </div>

      <button className="btn btn-primary" onClick={() => onSave(draft)}>
        Save
      </button>
    </div>
  );
}
