import {yearRangeLabel} from './workYear';

test('release year, or a range for an ended series, never the added date', () => {
  expect(yearRangeLabel({release_date: null})).toBeNull();
  expect(yearRangeLabel({release_date: '2011-09-19'})).toBe('2011');
  expect(yearRangeLabel({release_date: '2011-09-19', end_date: '2017-05-15'})).toBe('2011–2017');
  expect(yearRangeLabel({release_date: '2011-09-19', end_date: '2011-12-01'})).toBe('2011');
});
