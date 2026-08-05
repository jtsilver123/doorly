import { areasIn } from "@/lib/nta";

/**
 * The picture on the sign-in screen.
 *
 * It is the actual city — the same Neighborhood Tabulation Area polygons that
 * decide which neighborhood a listing belongs to, drawn at full bleed. No stock
 * photograph of a skyline, which any product could have used and which says
 * nothing about this one; the shape of Manhattan below 96th Street is
 * recognisable to anyone who has looked for an apartment in it, and it is the
 * only ornament here that is also load-bearing data.
 *
 * Rendered on the server from a file already in the bundle, so it costs no
 * request and no layout shift.
 */

/** Longitude compresses with latitude; matches the projection used on the map. */
const LAT_RAD = (40.75 * Math.PI) / 180;

/** Lower and midtown Manhattan plus the Brooklyn and Queens waterfront. */
const BOX = { minLon: -74.03, maxLon: -73.9, minLat: 40.69, maxLat: 40.81 };

/** Neighborhoods the app's own searches are most often pointed at. */
const HIGHLIGHT = new Set([
  "West Village",
  "East Village",
  "Chelsea-Hudson Yards",
  "Midtown South-Flatiron-Union Square",
  "Greenwich Village",
  "SoHo-Little Italy-Hudson Square",
  "Tribeca-Civic Center",
  "Lower East Side",
  "Gramercy",
]);

export default function AuthArt() {
  const W = 1000;
  const H = 1400;

  const project = (lon: number, lat: number): [number, number] => [
    ((lon * Math.cos(LAT_RAD) - BOX.minLon * Math.cos(LAT_RAD)) /
      ((BOX.maxLon - BOX.minLon) * Math.cos(LAT_RAD))) *
      W,
    (1 - (lat - BOX.minLat) / (BOX.maxLat - BOX.minLat)) * H,
  ];

  const shapes: { key: string; d: string; lit: boolean }[] = [];
  for (const area of areasIn()) {
    let d = "";
    let inFrame = false;
    for (const ring of area.r) {
      const pts = ring.map(([lon, lat]) => project(lon, lat));
      if (!pts.some(([x, y]) => x > -60 && x < W + 60 && y > -60 && y < H + 60)) continue;
      inFrame = true;
      d += `M${pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join("L")}Z`;
    }
    if (inFrame && d) shapes.push({ key: area.n, d, lit: HIGHLIGHT.has(area.n) });
  }

  return (
    <svg
      className="authart"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
    >
      {shapes.map((shape) => (
        <path key={shape.key} d={shape.d} className={shape.lit ? "authart-lit" : "authart-area"} />
      ))}
    </svg>
  );
}
