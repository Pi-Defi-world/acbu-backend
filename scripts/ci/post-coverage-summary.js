'use strict';

// #1070: coverage is collected and uploaded as an artifact, but an artifact
// zip is invisible to a reviewer unless they download and extract it — no
// in-PR regression signal. This reads jest's json-summary reporter output
// and appends a small table to the workflow run's job summary, which
// renders directly on the Actions run page (and the PR's Checks tab) with
// no download required. Coverage is still ENFORCED separately by
// jest.config.js's coverageThreshold, which fails the "Run tests" step
// before this one ever runs; this script only makes the numbers visible.

const fs = require('node:fs');
const path = require('node:path');

const SUMMARY_PATH = path.join(process.cwd(), 'coverage', 'coverage-summary.json');
const METRICS = ['statements', 'branches', 'functions', 'lines'];

function loadSummary() {
  if (!fs.existsSync(SUMMARY_PATH)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(SUMMARY_PATH, 'utf8'));
  } catch (error) {
    console.error(`Could not parse ${SUMMARY_PATH}: ${error.message}`);
    return null;
  }
}

function formatRow(name, metric) {
  const pct = typeof metric.pct === 'number' ? `${metric.pct.toFixed(2)}%` : 'n/a';
  return `| ${name} | ${pct} | ${metric.covered}/${metric.total} |`;
}

function buildMarkdown(summary) {
  const total = summary.total;
  const lines = [
    '## Coverage summary',
    '',
    '| Metric | Coverage | Covered / Total |',
    '|---|---|---|',
    ...METRICS.map((metric) => formatRow(metric[0].toUpperCase() + metric.slice(1), total[metric])),
    '',
    'Full HTML report and raw lcov are in the `coverage` artifact for this run. ' +
      'Coverage thresholds are enforced by the "Run tests" step above (jest.config.js `coverageThreshold`) — ' +
      'this table is for visibility only.',
  ];
  return lines.join('\n');
}

function main() {
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  const summary = loadSummary();

  const markdown = summary
    ? buildMarkdown(summary)
    : '## Coverage summary\n\nNo `coverage/coverage-summary.json` was produced (tests likely failed before coverage was written).';

  if (summaryFile) {
    fs.appendFileSync(summaryFile, `${markdown}\n`);
  } else {
    // Not running inside GitHub Actions (e.g. local `node scripts/ci/post-coverage-summary.js`).
    console.log(markdown);
  }
}

main();
