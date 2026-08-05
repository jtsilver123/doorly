"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
// Leaflet's stylesheet is imported from globals.css, ahead of design.css, so
// our overrides win on ordering rather than on !important. A component-level
// import here would be injected *after* the globals and take the sizing of
// the zoom controls back.
import type { FeedListing } from "@/types";

/**
 * A real map.
 *
 * The old map was hand-rolled SVG over neighborhood polygons — honest about
 * its data, but a silhouette of the city with no streets, no subway, no parks.
 * "Is this near the L" is the actual question, and only a street basemap can
 * answer it. This is Leaflet over CARTO's Voyager tiles: the Google look
 * without the Google invoice, no API key, free at this traffic.
 *
 * Pins are priced pills carrying the same four grades as the cards — the map
 * is the grid's judgment laid over the city, not a second opinion. Zoomed out,
 * pins collapse to dots so three hundred of them read as a density picture
 * instead of a smear; anything you've starred or advanced stays a pill at
 * every zoom, because your shortlist should never disappear into the crowd.
 *
 * Hover is bidirectional with the cards through the same linkedId the grid
 * already uses.
 */

const TILES =
  "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";
const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

/** Manhattan-ish fallback for the frame before any listings load. */
const NYC: L.LatLngTuple = [40.73, -73.98];

/** "$3,250" is too wide for a pill at 250 pins; "$3.2K" says enough. */
function short(price: number): string {
  if (price >= 10_000) return `$${Math.round(price / 1000)}K`;
  return `$${(price / 1000).toFixed(1)}K`;
}

/** Pills that survive zooming out: your shortlist, not the whole market. */
function isHot(l: FeedListing): boolean {
  return l.starred || !["inbox", "passed", "no_go"].includes(l.stage);
}

export default function CityMap({
  listings,
  onOpen,
  linkedId,
  onHover,
}: {
  listings: FeedListing[];
  onOpen: (listing: FeedListing) => void;
  linkedId: string | null;
  onHover: (id: string | null) => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef(new Map<string, L.Marker>());
  const didFitRef = useRef(false);
  // The latest callbacks, so marker handlers never close over stale props.
  const onOpenRef = useRef(onOpen);
  const onHoverRef = useRef(onHover);
  onOpenRef.current = onOpen;
  onHoverRef.current = onHover;

  // The map itself, once.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const map = L.map(box, {
      center: NYC,
      zoom: 12,
      zoomControl: true,
      // Scroll wheel zoom without a modifier hijacks the page scroll the
      // moment the cursor crosses the map — the single most hated map
      // behaviour on the web. Zillow requires no modifier because its map
      // pane doesn't scroll; ours sits beside a scrolling column.
      scrollWheelZoom: true,
    });
    L.tileLayer(TILES, {
      attribution: ATTRIBUTION,
      subdomains: "abcd",
      maxZoom: 19,
    }).addTo(map);

    const tier = () =>
      box.setAttribute("data-tier", map.getZoom() >= 14 ? "near" : "far");
    map.on("zoomend", tier);
    tier();

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      markersRef.current.clear();
      didFitRef.current = false;
    };
  }, []);

  // The pins, whenever the result set changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const markers = markersRef.current;
    const keep = new Set<string>();

    for (const l of listings) {
      if (l.lat == null || l.lon == null) continue;
      keep.add(l.id);
      const html = `<span class="mappin${isHot(l) ? " is-hot" : ""}" data-grade="${l.grade}">${short(l.price)}</span>`;
      const existing = markers.get(l.id);
      if (existing) {
        // Price or stage may have moved under the same id.
        existing.setIcon(
          L.divIcon({ className: "pinwrap", html, iconSize: [0, 0] })
        );
        continue;
      }
      const marker = L.marker([l.lat, l.lon], {
        icon: L.divIcon({ className: "pinwrap", html, iconSize: [0, 0] }),
        riseOnHover: true,
      });
      marker.on("click", () => onOpenRef.current(l));
      marker.on("mouseover", () => onHoverRef.current(l.id));
      marker.on("mouseout", () => onHoverRef.current(null));
      marker.addTo(map);
      markers.set(l.id, marker);
    }

    for (const [id, marker] of markers) {
      if (!keep.has(id)) {
        marker.remove();
        markers.delete(id);
      }
    }

    // Frame the results once. Re-fitting on every filter keystroke would
    // yank the map out from under whoever is panning it.
    if (!didFitRef.current && keep.size > 0) {
      const points = listings
        .filter((l) => l.lat != null && l.lon != null)
        .map((l) => [l.lat!, l.lon!] as L.LatLngTuple);
      map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 15 });
      didFitRef.current = true;
    }
  }, [listings]);

  // Hovering a card raises its pin; the pin's own hover comes back the same way.
  useEffect(() => {
    for (const [id, marker] of markersRef.current) {
      const el = marker.getElement()?.querySelector(".mappin");
      if (!el) continue;
      el.classList.toggle("is-linked", id === linkedId);
      marker.setZIndexOffset(id === linkedId ? 1000 : 0);
    }
  }, [linkedId]);

  return <div ref={boxRef} className="citymap" data-tier="far" />;
}
