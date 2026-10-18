// The nightly white check (pages.yml, build job): runs e2e/white.spec.ts headless and muted (playwright.config.ts) on
// the data in public/data, which the dev server serves, and decides whether that data may deploy (scripts/lib/white-verdict.ts).
// Prints every view's whitest pixel and, as GitHub workflow commands, a ::notice:: for views skipped without WebGL and a
// ::warning:: when the check could not decide. In GitHub Actions it writes `verdict` (white, clean, unchecked) and
// `views` (the white views with their values, one line) to $GITHUB_OUTPUT.
// Exit status: 0 clean, 1 white, 2 unchecked. Usage: pnpm run white-check (locally with PW_CHANNEL=chrome).
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { judge, viewLine, type Report } from './lib/white-verdict';

/** A workflow command's message: %, CR and LF escaped, as GitHub reads them. */
const esc = (s: string) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

const file = join(mkdtempSync(join(process.env.RUNNER_TEMP || tmpdir(), 'white-')), 'report.json');
const run = spawnSync('pnpm', ['exec', 'playwright', 'test', 'e2e/white.spec.ts', '--reporter=list,json'], {
  stdio: 'inherit', env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_FILE: file },
});
if (run.error) console.log(`white check: Playwright did not start: ${run.error.message}`);

let report: Report | null = null;
try {
  if (existsSync(file)) report = JSON.parse(readFileSync(file, 'utf8')) as Report;
} catch (e) {
  console.log(`white check: unreadable report: ${(e as Error).message}`);
}
const v = judge(report);

console.log(`\nwhite check (white from 215): ${v.verdict}`);
for (const view of v.views) console.log(`  ${viewLine(view)}`);
for (const s of v.skipped) console.log(`::notice title=White check::${esc(`skipped: ${s}. The Canvas 2D views decide.`)}`);
if (v.verdict === 'unchecked') {
  console.log(`::warning title=White check::${esc(`could not decide (${v.broken.join('; ')}): the fresh data deploys unchecked`)}`);
}
const views = v.white.map(viewLine).join('; ');
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `verdict=${v.verdict}\nviews=${views}\n`);
process.exit({ clean: 0, white: 1, unchecked: 2 }[v.verdict]);
