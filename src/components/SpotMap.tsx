"use client";

import { useEffect, useRef } from "react";
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
 * Deliberately small and static — no dragging, no zoom buttons, no scroll
 * hijack. It's an illustration of one address, and a map you can lose your
 * place in inside a scrolling panel is worse than no map. Tapping it opens
 * the full map view on that spot.
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

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;

    const map = L.map(box, {
      center: [lat, lon],
      zoom: 15,
      // Every interaction off: this is a picture, and a panel that scrolls
      // shouldn't fight a map that also scrolls.
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      zoomControl: false,
      attributionControl: false,
      touchZoom: false,
    });

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

    // Leaflet measures the container on creation; inside a drawer that is
    // still animating in, that measurement is wrong and the tiles land
    // offset. One resize after the animation settles fixes it.
    const settle = setTimeout(() => map.invalidateSize(), 260);

    return () => {
      clearTimeout(settle);
      map.remove();
    };
  }, [lat, lon]);

  return (
    <div className="spotmap">
      <div className="spotmap-canvas" ref={boxRef} role="img" aria-label={`Map showing ${label}`} />
      <span className="spotmap-credit">© OpenStreetMap, CARTO</span>
    </div>
  );
}
