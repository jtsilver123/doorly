"use client";

import { useEffect, useState } from "react";
import { siteUrl } from "@/lib/site";

/**
 * The tag-team panel.
 *
 * Two pitches, one mechanism. Someone hunting alone invites *scouts* — the
 * friend with good taste, the parent who reads listings for sport — to fill
 * their pipeline. People moving in together invite each other as *partners*
 * and work one pipeline with a named point person per place.
 *
 * Invites are links because the inviter is standing in a group chat. The
 * link is single-use; generating one whenever you need it beats managing a
 * standing "invite code" that leaks.
 */

export interface CrewMemberView {
  userId: string;
  email: string;
  name: string;
  role: "owner" | "partner" | "scout";
  isYou: boolean;
}

export interface CrewView {
  id: string;
  name: string;
  role: "owner" | "partner" | "scout";
  ownerId: string;
  members: CrewMemberView[];
}

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  partner: "Partner",
  scout: "Scout",
};

export default function CrewPanel({ onChanged }: { onChanged: () => void }) {
  const [crew, setCrew] = useState<CrewView | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [inviteUrl, setInviteUrl] = useState("");
  const [inviteRole, setInviteRole] = useState<"partner" | "scout" | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    const body = await fetch("/api/crew").then((r) => r.json()).catch(() => ({}));
    setCrew(body.crew ?? null);
    setLoaded(true);
  }
  useEffect(() => {
    load();
  }, []);

  async function post(payload: Record<string, unknown>) {
    setBusy(true);
    setError("");
    const res = await fetch("/api/crew", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (body.error) {
      setError(body.error);
      return null;
    }
    return body;
  }

  async function invite(role: "partner" | "scout") {
    const body = await post({ action: "invite", role });
    if (body?.token) {
      setInviteRole(role);
      // An invite minted on a deployment URL would send whoever opens
      // it to a Vercel login page, not to your search.
      setInviteUrl(siteUrl(`/join/${body.token}`));
      setCopied(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  if (!loaded) {
    return (
      <div className="surface" style={{ padding: 20 }} aria-busy="true">
        <div className="skeleton skeleton-line" style={{ width: "40%", height: 14 }} />
        <div className="skeleton skeleton-line" style={{ width: "70%", marginTop: 10 }} />
      </div>
    );
  }

  if (!crew) {
    return (
      <div className="surface" style={{ padding: 20, display: "grid", gap: 14 }}>
        <div>
          <div style={{ fontWeight: 600 }}>Search together</div>
          <div className="muted" style={{ fontSize: 12 }}>
            Apartment hunting is a team sport, even when only one name goes on
            the lease.
          </div>
        </div>

        <ul className="crew-pitch">
          <li>
            <b>Moving in with someone?</b> Invite them as a partner: one shared
            pipeline you both fill and work, with a point person on every place
            so you never both text the same agent.
          </li>
          <li>
            <b>Living alone?</b> Invite friends or family as scouts. They drop
            places into your pipeline, tagged with who found them. You keep
            the final say.
          </li>
        </ul>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            className="field"
            style={{ flex: "1 1 180px" }}
            value={name}
            placeholder="Name it: Winter and Jake's place"
            onChange={(e) => setName(e.target.value)}
          />
          <button
            className="btn btn-primary"
            disabled={busy}
            onClick={async () => {
              const body = await post({ action: "create", name });
              if (body?.crew) {
                setCrew(body.crew);
                onChanged();
              }
            }}
          >
            {busy ? "Setting up…" : "Start your crew"}
          </button>
        </div>
        {error && <div className="warn-text" style={{ fontSize: 12 }}>{error}</div>}
      </div>
    );
  }

  const owner = crew.role === "owner";

  return (
    <div className="surface" style={{ padding: 20, display: "grid", gap: 14 }}>
      <div>
        <div style={{ fontWeight: 600 }}>{crew.name}</div>
        <div className="muted" style={{ fontSize: 12 }}>
          {owner
            ? "Your pipeline is the shared one. Everyone here works it with you."
            : crew.role === "partner"
              ? "You share this pipeline fully: add places, move them, take point on agents."
              : "You're scouting: drop places in, they'll carry your name, and watch it move."}
        </div>
      </div>

      <ul className="crew-list">
        {crew.members.map((m) => (
          <li key={m.userId}>
            <span className="avatar" aria-hidden="true">
              {(m.name || m.email).slice(0, 2).toUpperCase()}
            </span>
            <span className="crew-who">
              <b>
                {m.name}
                {m.isYou ? " (you)" : ""}
              </b>
              <span>{m.email}</span>
            </span>
            <span className="chip">{ROLE_LABEL[m.role]}</span>
            {((owner && !m.isYou) || (m.isYou && !owner)) && (
              <button
                className="linkish"
                disabled={busy}
                onClick={async () => {
                  const verb = m.isYou ? "leave" : "remove";
                  if (!window.confirm(`Really ${verb}${m.isYou ? " this crew" : ` ${m.name}`}?`)) return;
                  const body = await post({ action: "remove", userId: m.userId });
                  if (body) {
                    await load();
                    onChanged();
                  }
                }}
              >
                {m.isYou ? "Leave" : "Remove"}
              </button>
            )}
          </li>
        ))}
      </ul>

      {owner && (
        <div style={{ display: "grid", gap: 8 }}>
          <span className="muted" style={{ fontSize: 12 }}>
            Invite someone. Each link works once
          </span>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button className="btn" disabled={busy} onClick={() => invite("partner")}>
              Partner link: we're moving in together
            </button>
            <button className="btn" disabled={busy} onClick={() => invite("scout")}>
              Scout link: help me look
            </button>
          </div>
          {inviteUrl && (
            <div className="crew-invite">
              <code>{inviteUrl}</code>
              <button className="btn btn-primary" onClick={copy}>
                {copied ? "Copied" : "Copy link"}
              </button>
              <span className="muted" style={{ fontSize: 11 }}>
                Paste it in your group chat. Whoever opens it joins as a{" "}
                {inviteRole === "partner" ? "partner" : "scout"}.
              </span>
            </div>
          )}
        </div>
      )}

      {owner && (
        <button
          className="linkish warn-text"
          disabled={busy}
          onClick={async () => {
            if (!window.confirm("Disband the crew? Everyone loses access to this pipeline (their accounts keep their own).")) return;
            const body = await post({ action: "remove", userId: crew.members.find((m) => m.isYou)!.userId });
            if (body) {
              await load();
              onChanged();
            }
          }}
        >
          Disband the crew
        </button>
      )}

      {error && <div className="warn-text" style={{ fontSize: 12 }}>{error}</div>}
    </div>
  );
}
