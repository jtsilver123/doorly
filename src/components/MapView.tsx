"use client";

import { useMemo, useRef, useState } from "react";
import type { FeedListing } from "@/types";
import type { Grade } from "@/lib/verdict";
import { areasIn } from "@/lib/nta";

/**
 * Where these places actually are.
 *
 * The single largest gap against the sites people already use: a list of
 * addresses cannot answer "which of these are near each other", "which are
 * close to my office", or "why is that one so cheap". Every listing carries
 * real coordinates — 324 of 324 in the live corpus — so the geography here is
 * measured, not decorated.
 *
 * The basemap is the city's own neighborhood boundaries, drawn as SVG. No
 * tiles, so no third-party request on every pan, and no invented coastline —
 * these are the same polygons that decide which neighborhood a listing is in,
 * so the shapes under the pins and the labels on the cards can never disagree.
 *
 * Pins are priced rather than dotted, because on a map of apartments the price
 * *is* the label — and they carry the same four grades the cards do, so the map
 * shows the identical judgment laid over the city rather than a second opinion.
 *
 * Everything below the projection exists to fight overplotting. Three hundred
 * pins across four adjacent neighborhoods is a solid mass of overlapping
 * lozenges; bucketing them into a grid and drawing a count where several
 * collide is the difference between a picture of the market and a smear.
 */

/** Longitude compresses with latitude; at NYC's 40.7° that's a ~24% squeeze. */
const LAT_RAD = (40.73 * Math.PI) / 180;

/** Buckets across the frame. Tuned so a bucket is roughly a pin's own width. */
const COLS = 26;
const ROWS = 21;

const GRADE_RANK: Record<Grade, number> = { excellent: 3, strong: 2, fair: 1, weak: 0 };

interface Placed {
  listing: FeedListing;
  x: number;
  y: number;
}

interface Cluster {
  key: string;
  x: number;
  y: number;
  members: Placed[];
  /** The best grade present, so a cluster advertises its most promising pin. */
  grade: Grade;
  medianPrice: number;
}

interface Props {
  listings: FeedListing[];
  onOpen: (listing: FeedListing) => void;
  /** Card currently hovered in the list, so its pin can rise to meet it. */
  linkedId?: string | null;
  onHover?: (id: string | null) => void;
}

const shortMoney = (n: number) =>
  n >= 1000 ? `$${(Math.round(n / 100) / 10).toFixed(1).replace(/\.0$/, "")}k` : `$${n}`;

export default function MapView({ listings, onOpen, linkedId, onHover }: Props) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  /**
   * Zoom exists because three hundred apartments in four adjacent
   * neighborhoods cannot be separated at one scale, however the pins are
   * drawn. Clustering makes the picture readable; zoom makes it workable.
   */
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  const model = useMemo(() => {
    const withGeo = listings.filter(
      (l) => l.lat != null && l.lon != null && Number.isFinite(l.lat) && Number.isFinite(l.lon)
    );
    if (!withGeo.length) return null;

    // Project to a unit square. Equirectangular is exact enough across four
    // adjacent neighborhoods, and it keeps the maths inspectable.
    const xs = withGeo.map((l) => l.lon! * Math.cos(LAT_RAD));
    const ys = withGeo.map((l) => l.lat!);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);

    // Pad so pins near the edge aren't clipped by their own labels.
    const padX = (maxX - minX) * 0.07 || 0.001;
    const padY = (maxY - minY) * 0.07 || 0.001;
    const spanX = maxX - minX + padX * 2;
    const spanY = maxY - minY + padY * 2;

    const points: Placed[] = withGeo.map((listing) => ({
      listing,
      // y inverts: north is up.
      x: ((listing.lon! * Math.cos(LAT_RAD) - minX + padX) / spanX) * 100,
      y: (1 - (listing.lat! - minY + padY) / spanY) * 100,
    }));

    // --- collapse collisions ------------------------------------------
    const buckets = new Map<string, Placed[]>();
    for (const p of points) {
      const key = `${Math.floor((p.x / 100) * COLS)}:${Math.floor((p.y / 100) * ROWS)}`;
      const list = buckets.get(key) ?? [];
      list.push(p);
      buckets.set(key, list);
    }

    const clusters: Cluster[] = [...buckets.entries()].map(([key, members]) => {
      const prices = members.map((m) => m.listing.price).sort((a, b) => a - b);
      const best = members.reduce((a, b) =>
        GRADE_RANK[b.listing.grade] > GRADE_RANK[a.listing.grade] ? b : a
      );
      return {
        key,
        x: members.reduce((s, m) => s + m.x, 0) / members.length,
        y: members.reduce((s, m) => s + m.y, 0) / members.length,
        members: [...members].sort((a, b) => b.listing.rating - a.listing.rating),
        grade: best.listing.grade,
        medianPrice: prices[Math.floor(prices.length / 2)],
      };
    });

    // Neighborhood labels sit at the mean position of their own listings, so
    // they land where the data actually is rather than at a guessed centroid.
    const byHood = new Map<string, { x: number; y: number; n: number }>();
    for (const p of points) {
      const name = p.listing.neighborhood;
      if (!name) continue;
      const acc = byHood.get(name) ?? { x: 0, y: 0, n: 0 };
      acc.x += p.x;
      acc.y += p.y;
      acc.n++;
      byHood.set(name, acc);
    }
    const labels = [...byHood.entries()]
      .filter(([, a]) => a.n >= 3)
      .map(([name, a]) => ({ name, x: a.x / a.n, y: a.y / a.n, n: a.n }));

    // --- basemap -------------------------------------------------------
    // Only the neighborhoods the frame actually covers. Drawing all 199 would
    // be 5,500 points of Staten Island nobody asked to see.
    const project = (lon: number, lat: number): [number, number] => [
      ((lon * Math.cos(LAT_RAD) - minX + padX) / spanX) * 100,
      (1 - (lat - minY + padY) / spanY) * 100,
    ];

    const shapes: { name: string; d: string; hasListings: boolean }[] = [];
    const present = new Set(withGeo.map((l) => l.neighborhood).filter(Boolean));
    for (const area of areasIn()) {
      let d = "";
      let visible = false;
      for (const ring of area.r) {
        const pts = ring.map(([lon, lat]) => project(lon, lat));
        // A ring entirely off-frame contributes nothing but bytes.
        if (!pts.some(([x, y]) => x > -25 && x < 125 && y > -25 && y < 125)) continue;
        visible = true;
        d += `M${pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join("L")}Z`;
      }
      if (visible && d) {
        shapes.push({ name: area.n, d, hasListings: present.has(area.n) });
      }
    }

    return { clusters, labels, shapes, spanKm: spanX * 111.32, total: points.length };
  }, [listings]);

  if (!model) {
    return (
      <div className="empty">
        <div className="empty-title">Nothing to map</div>
        <p className="empty-body">
          None of the listings in view have coordinates yet. They&apos;ll appear
          here after the next check.
        </p>
      </div>
    );
  }

  const { clusters, labels, shapes, spanKm, total } = model;

  // A round distance that fills a sensible share of the frame.
  const scaleKm = spanKm > 6 ? 2 : spanKm > 2.5 ? 1 : 0.5;
  const scalePct = (scaleKm / spanKm) * 100;

  const active = hovered ?? linkedId ?? null;
  const peekFor = active
    ? clusters.flatMap((c) => c.members).find((m) => m.listing.id === active)
    : null;

  /** A pin, whether it stands alone or has been fanned out of a cluster. */
  function pin(p: Placed, offset?: { dx: number; dy: number }) {
    const l = p.listing;
    return (
      <button
        key={l.id}
        className="mappin"
        data-grade={l.grade}
        data-active={active === l.id ? "true" : undefined}
        data-saved={l.starred ? "true" : undefined}
        style={{
          left: `${p.x + (offset?.dx ?? 0)}%`,
          top: `${p.y + (offset?.dy ?? 0)}%`,
        }}
        onClick={(e) => {
          e.stopPropagation();
          onOpen(l);
        }}
        onMouseEnter={() => {
          setHovered(l.id);
          onHover?.(l.id);
        }}
        onMouseLeave={() => {
          setHovered(null);
          onHover?.(null);
        }}
        onFocus={() => setHovered(l.id)}
        onBlur={() => setHovered(null)}
      >
        {l.starred && <b aria-hidden="true">★</b>}
        {shortMoney(l.price)}
        <span className="sr-only">
          , {l.address}, rated {l.rating} out of 100
        </span>
      </button>
    );
  }

  return (
    <div className="mapframe">
      <div
        className="mapcanvas"
        role="group"
        aria-label={`${total} listings plotted by location`}
        data-dragging={drag.current ? "true" : undefined}
        onClick={() => setExpanded(null)}
        onWheel={(e) => {
          // Ctrl/⌘ + wheel is the browser's own page zoom; leave it alone.
          if (e.ctrlKey || e.metaKey) return;
          const next = Math.min(6, Math.max(1, zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
          setZoom(next);
          if (next === 1) setPan({ x: 0, y: 0 });
        }}
        onPointerDown={(e) => {
          if (zoom <= 1) return;
          drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
          setPan({
            x: d.px + ((e.clientX - d.x) / box.width) * 100,
            y: d.py + ((e.clientY - d.y) / box.height) * 100,
          });
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
      >
        {/* Everything in map space scales together, so a pin never drifts off
            the neighborhood it belongs to. */}
        <div
          className="mapworld"
          style={{ transform: `scale(${zoom}) translate(${pan.x / zoom}%, ${pan.y / zoom}%)` }}
        >
        <svg className="mapshapes" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {shapes.map((shape) => (
            <path
              key={shape.name}
              d={shape.d}
              className="mapshape"
              data-live={shape.hasListings ? "true" : undefined}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
        {/* Neighborhood names sit beneath the pins so they orient without
            competing — the pins are the data, this is the context. */}
        {labels.map((label) => (
          <span
            key={label.name}
            className="maphood"
            style={{ left: `${label.x}%`, top: `${label.y}%` }}
            aria-hidden="true"
          >
            {label.name}
            <i>{label.n} places</i>
          </span>
        ))}

        {clusters.map((cluster) => {
          const open = expanded === cluster.key;

          // A lone listing is always its own price pin — collapsing one into a
          // "1" bubble would hide the number people are actually scanning for.
          if (cluster.members.length === 1) return pin(cluster.members[0]);

          if (open) {
            // Fan the members onto a small ring so each is individually
            // clickable without moving them far from the truth.
            const r = Math.min(4.2, 1.5 + cluster.members.length * 0.22);
            return cluster.members.map((m, i) => {
              const angle = (i / cluster.members.length) * Math.PI * 2;
              return pin(m, {
                dx: Math.cos(angle) * r - (m.x - cluster.x),
                dy: Math.sin(angle) * r * 1.2 - (m.y - cluster.y),
              });
            });
          }

          return (
            <button
              key={cluster.key}
              className="mapcluster"
              data-grade={cluster.grade}
              style={{
                left: `${cluster.x}%`,
                top: `${cluster.y}%`,
                // Area, not diameter, tracks the count — otherwise a bucket of
                // twenty looks four times busier than it is.
                width: `${20 + Math.sqrt(cluster.members.length) * 9}px`,
                height: `${20 + Math.sqrt(cluster.members.length) * 9}px`,
              }}
              onClick={(e) => {
                e.stopPropagation();
                setExpanded(cluster.key);
              }}
              title={`${cluster.members.length} places here · median ${shortMoney(cluster.medianPrice)} · click to open up`}
            >
              {cluster.members.length}
            </button>
          );
        })}

        {/* The hovered listing gets a real card, anchored to its own pin. */}
        {peekFor && (
          <div
            className="mappeek"
            style={{
              left: `${peekFor.x}%`,
              top: `${peekFor.y}%`,
              // Flip to the other side near an edge so it never leaves frame.
              transform: `translate(${peekFor.x > 62 ? "-104%" : "4%"}, ${
                peekFor.y > 68 ? "-108%" : "8%"
              })`,
            }}
          >
            <strong>${peekFor.listing.price.toLocaleString()}</strong>
            <span>
              {peekFor.listing.address}
              {peekFor.listing.unit ? ` #${peekFor.listing.unit}` : ""}
            </span>
            <span className="mappeek-sub">
              {peekFor.listing.bedrooms === 0 ? "Studio" : `${peekFor.listing.bedrooms} bed`} ·{" "}
              {peekFor.listing.neighborhood || peekFor.listing.borough} · rated{" "}
              {peekFor.listing.rating}
            </span>
          </div>
        )}
        </div>

        {zoom > 1 && (
          <button className="mapreset" onClick={(e) => { e.stopPropagation(); setZoom(1); setPan({ x: 0, y: 0 }); }}>
            Reset view
          </button>
        )}
      </div>

      <div className="maplegend">
        <span className="mapscale" style={{ width: `${scalePct}%` }}>
          {scaleKm < 1 ? `${scaleKm * 1000} m` : `${scaleKm} km`}
        </span>
        <span className="maphint">
          {expanded
            ? "Click the map to close"
            : zoom > 1
              ? "Drag to pan · scroll to zoom out"
              : "Scroll to zoom · numbered circles hold several places"}
        </span>
        <span className="mapkey">
          <i data-grade="excellent"></i> 78+
          <i data-grade="strong"></i> 62+
          <i data-grade="fair"></i> 45+
          <i data-grade="weak"></i> under 45
        </span>
      </div>
    </div>
  );
}
