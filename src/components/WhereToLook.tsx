"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { SearchCriteria } from "@/types";
import { directoryLanes, type DirectorySite } from "@/lib/siteLinks";
import { criteriaSummary } from "@/lib/criteria";
import { AREAS } from "@/lib/areas";
import Icon from "@/components/Icon";
import SiteLogo from "@/components/SiteLogo";

/**
 * Where to look: the door out, not a store inside.
 *
 * This page used to imitate a listings site — grid, map, filters — and lost
 * that comparison every time, because StreetEasy is a thousand people's job
 * and this is a tab. Worse, it miscast the product: people read DamnLease as
 * a weaker search engine when the actual work is everything that happens
 * after the search.
 *
 * So the page says the honest thing, and says it to someone stressed and
 * new to this: here is the whole plan, in three steps you can hold in your
 * head. Search happens on the sites that own the inventory, organized by
 * what kind of hunt this is, each link already carrying your criteria where
 * the site's URL grammar allows. The hunt happens here: paste what you find
 * and the pipeline takes over — contact, tours, the decision, the
 * application.
 */

export default function WhereToLook({
  criteria,
  hasPlaces,
  onFind,
  onEditSearch,
  activityPill,
}: {
  criteria: SearchCriteria | null;
  /**
   * Whether anything is on the board yet. A first-timer gets the plan
   * spelled out; someone mid-hunt has lived it and doesn't need the recap.
   */
  hasPlaces: boolean;
  /**
   * The same intake as the pipeline's bar: a URL or a pasted group post
   * becomes a tracked place. Returns false when the text isn't takeable so
   * the box can say why instead of silently ignoring it.
   */
  onFind: (query: string) => boolean;
  onEditSearch: () => void;
  /** The Activity toggle, owned by the parent so the panel state lives once. */
  activityPill?: ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [miss, setMiss] = useState(false);

  /*
   * The header is frozen at the top while the lanes scroll, and the lane
   * headers pin directly beneath it. "Beneath it" needs a number, and the
   * header's height isn't one — it changes with the first-timer steps, the
   * criteria line, the viewport. Measured once here, kept fresh by a
   * ResizeObserver, and published as a CSS variable the lane-head rule reads.
   */
  const wrapRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const head = headRef.current;
    const wrap = wrapRef.current;
    if (!head || !wrap) return;
    const publish = () =>
      wrap.style.setProperty("--wtl-head-h", `${head.offsetHeight}px`);
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(head);
    return () => ro.disconnect();
  }, []);

  const areaLabels = criteria
    ? criteria.areas
        .map((slug) => AREAS.find((a) => a.slug === slug)?.label)
        .filter((l): l is string => Boolean(l))
    : [];

  function submit() {
    const q = query.trim();
    if (!q) return;
    const taken = onFind(q);
    setMiss(!taken);
    if (taken) setQuery("");
  }

  return (
    <div className="wtl" ref={wrapRef}>
      <header className="wtl-head surface" ref={headRef}>
        <div className="wtl-head-top">
          <div>
            <h2>Where to look</h2>
            <p className="muted wtl-lede">
              The inventory lives on the sites. The hunt lives here.
            </p>
          </div>
          {activityPill}
        </div>

        {/* The whole method in one breath, for the visit where everything
            about this process feels like too much. Gone once places are on
            the board: by then it's how you already work. */}
        {!hasPlaces && (
          <ol className="wtl-steps">
            <li>
              <b>Open a site below.</b> The good ones start with your search
              already set.
            </li>
            <li>
              <b>See somewhere you&rsquo;d live?</b> Copy the listing&rsquo;s
              link.
            </li>
            <li>
              <b>Paste it here.</b> We run the rest: the message, the tour,
              the follow-up, the application.
            </li>
          </ol>
        )}

        {/*
          The search that rides on every link below. Labeled, because for a
          newcomer this is the page's whole trick — the sites open already
          knowing what you want — and an unlabeled summary reads as metadata.
        */}
        {criteria && (
          <p className="wtl-criteria">
            <span className="wtl-criteria-label">Your search</span>
            <span className="wtl-criteria-terms">
              {criteriaSummary(criteria, areaLabels)}
            </span>
            <button className="linkish" onClick={onEditSearch}>
              Edit
            </button>
          </p>
        )}

        {/* The way back in. Everything on this page leads out; this is the
            one control that matters when you return with something. */}
        <form
          className="wtl-paste"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <input
            className="field searchfield"
            value={query}
            placeholder="Found one? Paste its link, or a whole group post"
            onChange={(e) => {
              setQuery(e.target.value);
              setMiss(false);
            }}
            aria-label="Paste a listing link or post"
          />
          <button className="btn btn-primary" type="submit">
            Track it
          </button>
        </form>
        {miss && (
          <p className="wtl-miss" role="status">
            That doesn&rsquo;t look like a link or a listing post. Paste the
            page&rsquo;s URL, or the whole text of the post.
          </p>
        )}
      </header>

      {directoryLanes(criteria).map((lane) => (
        <section key={lane.kind} className="wtl-lane" aria-label={lane.title}>
          <div className="wtl-lane-head">
            <h3>{lane.title}</h3>
            <p className="muted">{lane.when}</p>
          </div>
          <div className="wtl-sites">
            {lane.sites.map((site) => (
              <SiteCard key={site.key} site={site} />
            ))}
          </div>
        </section>
      ))}

      <p className="muted wtl-foot">
        Spot a place anywhere — a site above, a group, a sign in a window —
        and paste it up top. From there this app runs the part that wins
        apartments: the outreach, the tour, the follow-through, the
        application.
      </p>
    </div>
  );
}

function SiteCard({ site }: { site: DirectorySite }) {
  return (
    <a
      className="wtl-site surface"
      data-lead={site.lead ? "yes" : undefined}
      href={site.url}
      target="_blank"
      rel="noreferrer"
    >
      {/* The site's own mark, drawn inline — see SiteLogo for the rules. */}
      <span className="wtl-mark" aria-hidden="true">
        <SiteLogo site={site.key} />
      </span>
      <span className="wtl-site-body">
        <span className="wtl-site-name">
          {site.name}
          <Icon name="external" size={12} className="wtl-out" />
          {site.lead && <span className="wtl-lead">start here</span>}
        </span>
        <span className="muted wtl-site-line">{site.tagline}</span>
        {site.carries && <span className="wtl-carries">opens with your search</span>}
      </span>
    </a>
  );
}
