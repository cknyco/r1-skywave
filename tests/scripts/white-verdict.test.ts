import { describe, expect, it } from 'vitest';
import { judge, viewLine, whiteNote, type Report } from '../../scripts/lib/white-verdict';

// Reports shaped as Playwright's JSON reporter writes them for e2e/white.spec.ts: one spec per globe and group, the
// views' values in the last result's annotations (written with whiteNote, as the spec writes them).

type Status = 'passed' | 'failed' | 'timedOut' | 'skipped' | 'interrupted';
const note = (view: string, whitest: number, px: number) => ({ type: view, description: whiteNote(whitest, px) });
const spec = (globe: 'gl' | '2d', group: string, status: Status, annotations: { type: string; description?: string }[], error?: string) => ({
  title: `?globe=${globe}, ${group}: nothing white at any of 15 cameras`,
  tests: [{ annotations: [], results: [{ status, annotations, errors: error ? [{ message: error }] : [] }] }],
});
const report = (...specs: ReturnType<typeof spec>[]): Report => ({ suites: [{ specs, suites: [] }], errors: [] });

const FACE = 'dense regions face on', LIMB = 'dense regions edge-on at the limb';
const NO_WEBGL = { type: 'skip', description: 'no WebGL in this browser: the WebGL globe cannot be checked here' };

describe('judge (the nightly white check)', () => {
  it('passes data free of white, with every view and its values', () => {
    const v = judge(report(
      spec('gl', FACE, 'passed', [note('Europe, z 2.4', 184, 0), note('Mexico, z 2.4', 177, 0)]),
      spec('2d', FACE, 'passed', [note('Europe, z 2.4', 206, 0)]),
      spec('2d', LIMB, 'passed', [note('Europe from the west, z 2', 200, 0)]),
    ));
    expect(v.verdict).toBe('clean');
    expect(v.views.map(viewLine)).toEqual([
      'WebGL Europe, z 2.4: whitest 184, white px 0', 'WebGL Mexico, z 2.4: whitest 177, white px 0',
      'Canvas 2D Europe, z 2.4: whitest 206, white px 0', 'Canvas 2D Europe from the west, z 2: whitest 200, white px 0',
    ]);
    expect(v.white).toEqual([]);
  });

  it('turns away data that draws white, naming every white view and its values', () => {
    const v = judge(report(
      spec('gl', FACE, 'passed', [note('Europe, z 2.4', 201, 0)]),
      spec('2d', FACE, 'failed', [note('Europe, z 2.4', 218, 50), note('Brazil, z 2.2', 165, 0), note('Mexico, z 2.4', 216, 3)],
        'Europe at z 2.4: white px over 15 cameras (whitest 218)'),
    ));
    expect(v.verdict).toBe('white');
    expect(v.white.map(viewLine)).toEqual([
      'Canvas 2D Europe, z 2.4: whitest 218, white px 50', 'Canvas 2D Mexico, z 2.4: whitest 216, white px 3',
    ]);
    expect(v.broken).toEqual([]);
  });

  it('lets the Canvas 2D views decide where the browser has no WebGL', () => {
    const v = judge(report(
      spec('gl', FACE, 'skipped', [NO_WEBGL]), spec('gl', LIMB, 'skipped', [NO_WEBGL]),
      spec('2d', FACE, 'passed', [note('Europe, z 2.4', 206, 0)]), spec('2d', LIMB, 'passed', [note('Europe from Korea, z 2', 176, 0)]),
    ));
    expect(v.verdict).toBe('clean');
    expect(v.skipped).toEqual([
      `?globe=gl, ${FACE}: nothing white at any of 15 cameras: ${NO_WEBGL.description}`,
      `?globe=gl, ${LIMB}: nothing white at any of 15 cameras: ${NO_WEBGL.description}`,
    ]);
    const white = judge(report(spec('gl', FACE, 'skipped', [NO_WEBGL]), spec('2d', FACE, 'failed', [note('Europe, z 2.4', 218, 50)])));
    expect(white.verdict).toBe('white');
  });

  it('cannot decide, and so never blocks, when the check itself fails', () => {
    expect(judge(null)).toMatchObject({ verdict: 'unchecked', broken: ['no report'] });
    const run = judge({ suites: [], errors: [{ message: '\u001b[31mError: Timed out waiting 60000ms from config.webServer.\u001b[39m\n  at …' }] });
    expect(run.verdict).toBe('unchecked');
    expect(run.broken).toEqual(['run error: Error: Timed out waiting 60000ms from config.webServer.', 'no white check ran']);
    const timeout = judge(report(
      spec('2d', FACE, 'passed', [note('Europe, z 2.4', 206, 0)]),
      spec('2d', LIMB, 'timedOut', [note('Europe from Korea, z 2', 176, 0)], 'Test timeout of 240000ms exceeded.'),
    ));
    expect(timeout.verdict).toBe('unchecked');
    expect(timeout.broken).toEqual([`?globe=2d, ${LIMB}: nothing white at any of 15 cameras: timedOut, Test timeout of 240000ms exceeded.`]);
    expect(judge(report(spec('gl', FACE, 'skipped', [NO_WEBGL]))))
      .toMatchObject({ verdict: 'unchecked', broken: ['no view measured'] });
  });

  it('turns away white found before the check broke off', () => {
    const v = judge(report(
      spec('2d', FACE, 'timedOut', [note('Europe, z 2.4', 217, 5)], 'Test timeout of 240000ms exceeded.'),
      spec('2d', LIMB, 'interrupted', []),
    ));
    expect(v.verdict).toBe('white');
    expect(v.white.map(viewLine)).toEqual(['Canvas 2D Europe, z 2.4: whitest 217, white px 5']);
    expect(v.broken).toEqual([`?globe=2d, ${LIMB}: nothing white at any of 15 cameras: interrupted`]);
  });

  it('reads specs in nested suites and the annotations of the last result', () => {
    const inner = spec('2d', FACE, 'passed', [note('Europe, z 2.4', 206, 0)]);
    inner.tests[0].results.unshift({ status: 'failed', annotations: [note('Europe, z 2.4', 230, 9)], errors: [] });
    const v = judge({ suites: [{ specs: [], suites: [{ specs: [inner], suites: [] }] }] });
    expect(v.verdict).toBe('clean');
    expect(v.views.map(viewLine)).toEqual(['Canvas 2D Europe, z 2.4: whitest 206, white px 0']);
  });
});
