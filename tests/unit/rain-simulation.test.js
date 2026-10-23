const { distanceKm, rainStep } = require('../../backend/src/lib/rain-simulation');

const device = (extra = {}) => ({ lat: 0, lng: 0, zone_radius_km: 1.5, risk_level: 1, critical_cm: 20, demo_override_level: null, latest_level_cm: 0, current_alert_level: 'normal', ...extra });
const storm = (extra = {}) => ({ lat: 0, lng: 0, radius_m: 3000, intensity: 30, ...extra });
const longitudeAtKm = km => km * 180 / (6371 * Math.PI);

test('Haversine uses the original 6371km earth radius and accepts zero coordinates', () => {
  expect(distanceKm(0, 0, 0, 0)).toBe(0);
  expect(distanceKm(0, 0, 0, 1)).toBeCloseTo(111.1949266, 6);
});
test.each([
  [1, 5, 0.9], [1, 15, 2], [1, 30, 3.2],
  [3, 5, 1.6], [3, 15, 3], [3, 30, 4.4],
  [5, 5, 2.3], [5, 15, 4], [5, 30, 5.6]
])('initial rise follows original region %i rain %i: %f cm', (risk_level, intensity, expected) => {
  expect(rainStep(device({ risk_level }), [storm({ intensity })]).level_cm).toBe(expected);
});
test('resonance falls to 30 percent at the touch boundary and stops just beyond it', () => {
  const dev = device({ latest_level_cm: 6 });
  expect(rainStep(dev, [storm()]).level_cm).toBe(7.4);
  expect(rainStep(dev, [storm({ lng: longitudeAtKm(4.5) })]).level_cm).toBe(6.4);
  expect(rainStep(dev, [storm({ lng: longitudeAtKm(4.501) })]).level_cm).toBe(4);
});
test('overlapping storms take the highest intensity and resonance independently', () => {
  expect(rainStep(device({ latest_level_cm: 6 }), [storm({ intensity: 5 }), storm({ lng: longitudeAtKm(4.5) })]).level_cm).toBe(7.4);
});
test.each([[1, 18.8, 7.5, 8], [3, 19.4, 8.9, 9.1], [5, 19.7, 9.4, 9.5]])('drain profile %i preserves top/bottom critical and warning durations', (risk_level, top, bottom, warning) => {
  expect(rainStep(device({ risk_level, latest_level_cm: 20 }), [], 'critical').level_cm).toBe(top);
  expect(rainStep(device({ risk_level, latest_level_cm: 10 }), [], 'critical').level_cm).toBe(bottom);
  expect(rainStep(device({ risk_level, latest_level_cm: 10 }), [], 'warning').level_cm).toBe(warning);
});
test('a remembered critical peak survives a warning descent and clears at zero', () => {
  const result = rainStep(device({ latest_level_cm: 8 }), [], 'critical');
  expect(result).toMatchObject({ level_cm: 5.5, peak: 'critical' });
  expect(rainStep(device({ latest_level_cm: 0.2 }), [], 'critical')).toMatchObject({ level_cm: 0, peak: null });
  expect(rainStep(device({ risk_level: 3, latest_level_cm: 1.12 }), [], 'critical')).toMatchObject({ level_cm: 0, peak: null });
});
test('rain caps target plus five at 90cm and uses a positive manual target', () => {
  expect(rainStep(device({ latest_level_cm: 24.9 }), [storm()]).level_cm).toBe(25);
  expect(rainStep(device({ demo_override_level: 90, latest_level_cm: 89.9 }), [storm()]).level_cm).toBe(90);
  expect(rainStep(device({ demo_override_level: 30, latest_level_cm: 6 }), [storm()]).level_cm).toBe(8.1);
});
test('unknown readings initialize only under an affecting storm; missing geography cannot make rain', () => {
  expect(rainStep(device({ latest_level_cm: null }), []).level_cm).toBeNull();
  expect(rainStep(device({ latest_level_cm: null }), [storm({ lng: 1 })]).level_cm).toBeNull();
  expect(rainStep(device({ latest_level_cm: null }), [storm()]).level_cm).toBe(3.2);
  expect(rainStep(device({ lat: null, latest_level_cm: null }), [storm()]).level_cm).toBeNull();
  expect(rainStep(device({ lat: null, latest_level_cm: 1 }), []).level_cm).toBe(0);
});
