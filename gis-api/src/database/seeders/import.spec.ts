import { firstOccurrences, parseCsv, reportCsv } from './import-formats';
import { validateGeometry, validateSurvey } from '../../common/validation/geometry.validation';

describe('seed import units', () => {
  it('CSV preserves quoted newlines and physical starting line', () => {
    expect(parseCsv('a,b\r\n"one\nline","a""b"\r\nx,y\r\n')).toEqual([
      { line: 1, values: ['a', 'b'] }, { line: 2, values: ['one\nline', 'a"b'] }, { line: 4, values: ['x', 'y'] }]);
    expect(() => parseCsv('a,b\n"bad,x')).toThrow(/CSV/);
  });

  it('duplicate first occurrence includes invalid first rows', () => {
    expect(firstOccurrences(['x', 'x', 'y', 'x'])).toEqual([true, false, true, false]);
  });

  it('report CSV escapes formulas commas quotes and newlines', () => {
    expect(reportCsv([{ source_file: '=bad', row: 2, key: 'a,b', reason_code: 'INVALID', reason: 'a"\nb' }]))
      .toBe('source_file,row,key,reason_code,reason\r\n"\'=bad","2","a,b","INVALID","a""\nb"\r\n');
  });

  it('domain rejects bad coordinates rings real dates cover species', () => {
    expect(() => validateGeometry({ type: 'Point', coordinates: [Infinity, 0] }, 'point')).toThrow();
    expect(() => validateGeometry({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1]]] }, 'polygon')).toThrow();
    expect(() => validateGeometry({ type: 'Point', coordinates: [0, 91] }, 'point')).toThrow();
    const base = { lon: '99', lat: '8', surveyed_on: '2026-02-28', cover_percent: '0', species: 'EA' };
    expect(validateSurvey(base, new Set(['EA']), '2026-11-21').cover).toBe(0);
    for (const change of [{ surveyed_on: '2026-02-30' }, { surveyed_on: '2026-11-22' }, { cover_percent: '' }, { cover_percent: 'NaN' }, { cover_percent: '101' }, { species: 'XX' }])
      expect(() => validateSurvey({ ...base, ...change }, new Set(['EA']), '2026-11-21')).toThrow();
  });

  it('year zero and conflicting explicit CRS are rejected before SQL', () => {
    expect(() => validateSurvey({ lon: '99', lat: '8', surveyed_on: '0000-01-01', cover_percent: '50', species: 'EA' }, new Set(['EA']), '2026-11-21')).toThrow();
    expect(() => validateGeometry({ type: 'Point', coordinates: [99, 8], crs: { type: 'name', properties: { name: 'EPSG:32647' } } }, 'point')).toThrow();
  });
});
