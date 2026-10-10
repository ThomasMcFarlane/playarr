import {runtimeLabel} from './runtimeLabel';

const t = (key: string, params: Record<string, number>) => `${key.split('.').pop()}:${JSON.stringify(params)}`;

test('formats runtimes like the web', () => {
  expect(runtimeLabel(null, t)).toBeNull();
  expect(runtimeLabel(0, t)).toBeNull();
  expect(runtimeLabel(45 * 60_000, t)).toBe('runtimeMinutes:{"minutes":45}');
  expect(runtimeLabel(120 * 60_000, t)).toBe('runtimeHours:{"hours":2}');
  expect(runtimeLabel(137 * 60_000, t)).toBe('runtimeHoursMinutes:{"hours":2,"minutes":17}');
  expect(runtimeLabel(10_000, t)).toBe('runtimeMinutes:{"minutes":1}');
});
