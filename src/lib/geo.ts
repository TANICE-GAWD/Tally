import { booleanPointInPolygon, point, polygon as turfPolygon } from '@turf/turf';

export interface LatLon {
  latitude: number;
  longitude: number;
}

export interface ParsedPolygon {
  coordinates: LatLon[];
  centroid: LatLon;
}

export function parseGeoJsonPolygon(geojson: string): ParsedPolygon | null {
  try {
    const obj = JSON.parse(geojson);
    if (obj.type !== 'Polygon') return null;
    const ring = obj.coordinates?.[0];
    if (!Array.isArray(ring) || ring.length < 3) return null;
    const coords: LatLon[] = ring.map(([lon, lat]: [number, number]) => ({
      latitude: lat,
      longitude: lon
    }));
    const centroid = centroidOf(coords);
    return { coordinates: coords, centroid };
  } catch {
    return null;
  }
}

function centroidOf(coords: LatLon[]): LatLon {
  let lat = 0;
  let lon = 0;
  for (const c of coords) {
    lat += c.latitude;
    lon += c.longitude;
  }
  const n = coords.length;
  return { latitude: lat / n, longitude: lon / n };
}

export function isInsidePolygon(p: LatLon, poly: ParsedPolygon): boolean {
  const turfRing = poly.coordinates.map((c) => [c.longitude, c.latitude]);
  if (
    turfRing.length > 0 &&
    (turfRing[0][0] !== turfRing[turfRing.length - 1][0] ||
      turfRing[0][1] !== turfRing[turfRing.length - 1][1])
  ) {
    turfRing.push(turfRing[0]);
  }
  return booleanPointInPolygon(
    point([p.longitude, p.latitude]),
    turfPolygon([turfRing])
  );
}
