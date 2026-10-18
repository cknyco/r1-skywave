// The nightly white check's verdict (scripts/white-check.ts, pages.yml): reads the Playwright JSON report of a run of
// e2e/white.spec.ts and decides whether the data that run was served may deploy.
//   white      a view drew a white px (smallest channel ≥ 215) at any of its cameras: that data must not deploy;
//   clean      every view that ran is free of white;
//   unchecked  the check could not decide (no report, a run error, a test that failed without a white measurement,
//              no view measured at all): it never blocks the deploy of otherwise good data.
// A test skipped for want of WebGL (needWebGl) is listed, not counted: the Canvas 2D views still decide.

/** The annotation white.spec.ts records for each view: the whitest pixel's smallest channel and the white px count. */
export const whiteNote = (whitest: number, px: number): string =>
  `whitest pixel's smallest channel ${whitest} (white from 215), white px ${px}`;
const NOTE = /^whitest pixel's smallest channel (\d+(?:\.\d+)?) \(white from 215\), white px (\d+)$/;

// The parts of Playwright's JSONReport (@playwright/test/reporter) read here.
interface Annotation { type: string; description?: string }
interface Result { status?: string; annotations?: Annotation[]; errors?: { message?: string }[] }
interface Test { annotations?: Annotation[]; results: Result[] }
interface Spec { title: string; tests: Test[] }
interface Suite { specs: Spec[]; suites?: Suite[] }
export interface Report { suites: Suite[]; errors?: { message?: string }[] }

/** One view's measurement: the globe, the view (name and z), the whitest pixel's smallest channel, the white px. */
export interface View { globe: string; view: string; whitest: number; px: number }

export interface Verdict {
  verdict: 'white' | 'clean' | 'unchecked';
  views: View[];       // every view measured
  white: View[];       // the views with a white px
  skipped: string[];   // tests skipped, with the reason
  broken: string[];    // why the check could not decide, where it could not
}

const GLOBE: Record<string, string> = { gl: 'WebGL', '2d': 'Canvas 2D' };
const firstLine = (s = '') => s.replace(/\u001b\[[0-9;]*m/g, '').split('\n')[0].trim();

function* specs(suites: Suite[]): Generator<Spec> {
  for (const s of suites) {
    yield* s.specs;
    yield* specs(s.suites ?? []);
  }
}

/** The verdict on a report; null (no report) is unchecked. */
export function judge(report: Report | null): Verdict {
  const out: Verdict = { verdict: 'unchecked', views: [], white: [], skipped: [], broken: [] };
  if (!report) {
    out.broken.push('no report');
    return out;
  }
  for (const e of report.errors ?? []) out.broken.push(`run error: ${firstLine(e.message)}`);
  let tests = 0;
  for (const spec of specs(report.suites)) {
    const globe = GLOBE[/\?globe=(\w+)/.exec(spec.title)?.[1] ?? ''] ?? spec.title;
    for (const t of spec.tests) {
      tests++;
      const r = t.results[t.results.length - 1];
      const notes = r?.annotations?.length ? r.annotations : t.annotations ?? [];
      const mine: View[] = [];
      for (const a of notes) {
        const m = NOTE.exec(a.description ?? '');
        if (m) mine.push({ globe, view: a.type, whitest: +m[1], px: +m[2] });
      }
      out.views.push(...mine);
      const status = r?.status ?? 'not run';
      if (status === 'skipped') {
        out.skipped.push(`${spec.title}: ${notes.find(a => a.type === 'skip')?.description ?? 'skipped'}`);
      } else if (status !== 'passed' && !mine.some(v => v.px > 0)) {
        out.broken.push(`${spec.title}: ${status}${r?.errors?.length ? `, ${firstLine(r.errors[0].message)}` : ''}`);
      }
    }
  }
  if (!tests) out.broken.push('no white check ran');
  out.white = out.views.filter(v => v.px > 0);
  if (out.white.length) out.verdict = 'white';
  else if (!out.broken.length && out.views.length) out.verdict = 'clean';
  else if (!out.views.length && !out.broken.length) out.broken.push('no view measured');
  return out;
}

/** A view as the logs name it: `Canvas 2D Europe, z 2.4: whitest 218, white px 50`. */
export const viewLine = (v: View): string => `${v.globe} ${v.view}: whitest ${v.whitest}, white px ${v.px}`;
