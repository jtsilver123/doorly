"use client";

import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { stationsWithin } from "@/lib/subway";

/**
 * Where it actually is.
 *
 * The drawer told you the neighborhood and the walk to the train, but not the
 * thing your eye answers instantly from a map: which block, which side of the
 * park, how far from the water, whether "East Village" means Avenue A or
 * Avenue D. A name is a category; a pin is a place.
 *
 * Interactive on purpose: drag to see what's around, pinch or use the
 * buttons to zoom. The one interaction deliberately left off is wheel
 * zoom, because this map lives inside a panel that scrolls, and a wheel
 * that sometimes scrolls the page and sometimes dives into the map is how
 * people lose their place. Wander off and a "Back to the pin" button
 * appears, so exploring is never a one-way trip.
 *
 * The nearby stations are drawn too, because "6 min to Grand Central" and
 * *which direction* Grand Central is in are different facts, and the second
 * one decides whether the walk is toward your commute or away from it.
 */

const TILES =
  "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";

export default function SpotMap({
  lat,
  lon,
  label,
}: {
  lat: number;
  lon: number;
  label: string;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const [wandered, setWandered] = useState(false);
  const HOME_ZOOM = 15;

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;

    const map = L.map(box, {
      center: [lat, lon],
      zoom: HOME_ZOOM,
      dragging: true,
      touchZoom: true,
      doubleClickZoom: true,
      boxZoom: false,
      keyboard: true,
      zoomControl: true,
      attributionControl: false,
      // See the header comment: the wheel stays with the page, not the map.
      scrollWheelZoom: false,
    });
    mapRef.current = map;

    L.tileLayer(TILES, { maxZoom: 19 }).addTo(map);

    // Stations first, so the listing pin always sits on top of them.
    for (const station of stationsWithin(lat, lon, 12)) {
      L.marker([station.lat, station.lon], {
        icon: L.divIcon({
          className: "spotmap-station-wrap",
          html: `<span class="spotmap-station">${station.routes
            .split("")
            .slice(0, 3)
            .map((r) => `<i data-route="${r}">${r}</i>`)
            .join("")}</span>`,
          iconSize: [0, 0],
          iconAnchor: [0, 0],
        }),
        interactive: false,
      }).addTo(map);
    }

    L.marker([lat, lon], {
      icon: L.divIcon({
        className: "spotmap-pin-wrap",
        html: '<span class="spotmap-pin"></span>',
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      }),
      interactive: false,
    }).addTo(map);

    // The way home appears only once you've left: a control that is always
    // there is noise; one that shows up when needed is an answer.
    const onMove = () => {
      const c = map.getCenter();
      setWandered(
        Math.abs(c.lat - lat) > 0.0004 ||
          Math.abs(c.lng - lon) > 0.0004 ||
          map.getZoom() !== HOME_ZOOM
      );
    };
    map.on("moveend zoomend", onMove);

    // Leaflet measures the container on creation; inside a drawer that is
    // still animating in, that measurement is wrong and the tiles land
    // offset. One resize after the animation settles fixes it.
    const settle = setTimeout(() => map.invalidateSize(), 260);

    return () => {
      clearTimeout(settle);
      map.off("moveend zoomend", onMove);
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lon]);

  return (
    <div className="spotmap">
      <div
        className="spotmap-canvas"
        ref={boxRef}
        aria-label={`Map around ${label}. Drag to pan, use the buttons to zoom.`}
      />
      {wandered && (
        <button
          className="spotmap-recenter"
          onClick={() => mapRef.current?.setView([lat, lon], HOME_ZOOM)}
        >
          Back to the pin
        </button>
      )}
      <span className="spotmap-credit">© OpenStreetMap, CARTO</span>
    </div>
  );
}
