import { describe, expect, it } from 'vitest';
import { isInsidePolygon, parseGeoJsonPolygon } from '@/lib/geo';

const liberty =
  '{"type":"Polygon","coordinates":[[[-74.0140,40.7124],[-74.0128,40.7124],[-74.0128,40.7132],[-74.0140,40.7132],[-74.0140,40.7124]]]}';

describe('parseGeoJsonPolygon', () => {
  it('parses a valid polygon', () => {
    const p = parseGeoJsonPolygon(liberty);
    expect(p).not.toBeNull();
    expect(p!.coordinates.length).toBe(5);
    expect(p!.centroid.latitude).toBeCloseTo(40.7128, 3);
    expect(p!.centroid.longitude).toBeCloseTo(-74.0134, 3);
  });

  it('returns null on garbage input', () => {
    expect(parseGeoJsonPolygon('not json')).toBeNull();
    expect(parseGeoJsonPolygon('{"type":"Point","coordinates":[0,0]}')).toBeNull();
    expect(parseGeoJsonPolygon('{"type":"Polygon","coordinates":[]}')).toBeNull();
  });
});

describe('isInsidePolygon', () => {
  const poly = parseGeoJsonPolygon(liberty)!;

  it('true for a point inside', () => {
    expect(isInsidePolygon({ latitude: 40.7128, longitude: -74.0134 }, poly)).toBe(true);
  });

  it('false for Brooklyn', () => {
    expect(isInsidePolygon({ latitude: 40.6782, longitude: -73.9442 }, poly)).toBe(false);
  });

  it('false for a point just outside the east edge', () => {
    expect(isInsidePolygon({ latitude: 40.7128, longitude: -74.0127 }, poly)).toBe(false);
  });
});
