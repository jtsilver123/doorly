"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import type { FeedListing } from "@/types";
import { tourDays, stopLabel, type TourDay } from "@/lib/tourday";
import { tourWhen } from "@/lib/nextAction";
import Icon from "@/components/Icon";

/**
 * The tour day, drawn.
 *
 * Three bookings on a Saturday exist as three cards until you're on the
 * street realising the 2pm and the 3pm are forty minutes apart. This modal
 * turns the Tour column into an itinerary: one tab per day, the stops
 * numbered on a map in time order, the route drawn between them, and the
 * walk between consecutive stops estimated — with the legs that don't fit
 * their gap flagged while there's still time to rebook.
 *
 * Same Leaflet, same tiles, same visual language as the listings map; the
 * planner is the city view of the pipeline, not a third map style.
 */

const TILES =
  "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";
const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

export default function TourPlanner({
  listings,
  onClose,
  onOpen,
}: {
  listings: FeedListing[];
  onClose: () => void;
  /** Tapping a stop opens the listing behind the planner. */
  onOpen: (listing: FeedListing) => void;
}) {
  const days = useMemo(() => tourDays(listings), [listings]);
  const [dayKey, setDayKey] = useState<string | null>(days[0]?.key ?? null);
  const day: TourDay | undefined = days.find((d) => d.key === dayKey) ?? days[0];

  const boxRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Escape closes; focus starts inside so the keyboard is in the dialog.
  useEffect(() => {
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // The map, once.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const map = L.map(box, { zoomControl: true, attributionControl: true });
    L.tileLayer(TILES, { attribution: ATTRIBUTION, maxZoom: 19 }).addTo(map);
    map.setView([40.73, -73.98], 12);
    mapRef.current = map;
    layerRef.current = L.layerGroup().addTo(map);
    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  // The day's stops, redrawn when the tab changes.
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer || !day) return;
    layer.clearLayers();

    const points: L.LatLngTuple[] = [];
    day.stops.forEach((stop, i) => {
      const { lat, lon } = stop.listing;
      if (lat == null || lon == null) return;
      points.push([lat, lon]);
      const icon = L.divIcon({
        className: "tourstop-wrap",
        // Numbered in time order — the map should read like the plan.
        html: `<span class="tourstop${stop.tight ? " is-tight" : ""}">${i + 1}</span>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15],
      });
      L.marker([lat, lon], { icon })
        .addTo(layer)
        .on("click", () => onOpen(stop.listing));
    });

    if (points.length >= 2) {
      // Dashed: this is the order of visits, not a walking route promise.
      L.polyline(points, {
        color: "#16324f",
        weight: 2.5,
        dashArray: "6 7",
        opacity: 0.75,
      }).addTo(layer);
    }
    if (points.length) {
      map.fitBounds(L.latLngBounds(points).pad(0.25), { maxZoom: 15 });
    }
  }, [day, onOpen]);

  if (!days.length) {
    return (
      <>
        <div className="scrim" onClick={onClose} />
        <div className="planner" role="dialog" aria-modal="true" aria-label="Tour plan" tabIndex={-1} ref={panelRef}>
          <header className="planner-head">
            <h2>Tour plan</h2>
            <button className="btn" onClick={onClose} aria-label="Close">
              <Icon name="close" size={15} />
            </button>
          </header>
          <div className="planner-empty">
            Nothing on the calendar yet. Set a time on a booked tour and it
            lands here, in walking order.
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div
        className="planner"
        role="dialog"
        aria-modal="true"
        aria-label="Tour plan"
        tabIndex={-1}
        ref={panelRef}
      >
        <header className="planner-head">
          <h2>Tour plan</h2>
          {/* One tab per day with bookings. Most weeks this is one or two. */}
          <div className="planner-days" role="tablist" aria-label="Days">
            {days.map((d) => (
              <button
                key={d.key}
                role="tab"
                aria-selected={d.key === day?.key}
                className={d.key === day?.key ? "pill is-on" : "pill"}
                onClick={() => setDayKey(d.key)}
              >
                {d.label}
                <span className="muted"> · {d.stops.length}</span>
              </button>
            ))}
          </div>
          <button className="btn" onClick={onClose} aria-label="Close">
            <Icon name="close" size={15} />
          </button>
        </header>

        <div className="planner-body">
          <div className="planner-map" ref={boxRef} />

          {day && (
            <div className="planner-plan">
              <div className="planner-sum">
                <b>{day.stops.length} stops</b>
                {day.totalWalkMinutes > 0 && (
                  <span className="muted">
                    · about {day.totalWalkMinutes} min walking all day
                  </span>
                )}
              </div>

              <ol className="planner-stops">
                {day.stops.map((stop, i) => (
                  <li key={stop.listing.id}>
                    {/* The leg to this stop, before the stop itself — the
                        plan reads top to bottom as the day actually runs. */}
                    {stop.walkMinutes != null && (
                      <div className={stop.tight ? "planner-leg is-tight" : "planner-leg"}>
                        walk ~{stop.walkMinutes} min
                        {stop.tight && (
                          <>
                            <Icon name="alert" size={12} />
                            tight — {stop.gapMinutes} min gap
                          </>
                        )}
                      </div>
                    )}
                    <button className="planner-stop" onClick={() => onOpen(stop.listing)}>
                      <span className="planner-n" data-tight={stop.tight ? "true" : undefined}>
                        {i + 1}
                      </span>
                      <span className="planner-what">
                        <b>{stopLabel(stop)}</b>
                        <span className="muted">
                          {stop.listing.neighborhood}
                          {stop.listing.tourKind === "open_house"
                            ? ` · open house${stop.listing.tourEndsAt ? ` until ${tourWhen(stop.listing.tourEndsAt)}` : ""}`
                            : ""}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ol>

              <p className="planner-note muted">
                Walking times are straight-line estimates at city pace — check
                transit for anything flagged tight.
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
