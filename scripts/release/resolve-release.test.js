'use strict';

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  ReleaseTagError,
  resolveReleaseTag,
} = require('./resolve-release');

const SCRIPT = path.join(__dirname, 'resolve-release.js');

test('legacy v-prefixed tag still resolves to the backend release', () => {
  const release = resolveReleaseTag('v1.2.0');

  assert.equal(release.package, 'backend');
  assert.equal(release.version, '1.2.0');
  assert.equal(release.gitTag, 'v1.2.0');
  assert.equal(release.versionTag, 'v1.2.0');
  assert.equal(release.legacy, true);
  assert.equal(release.prerelease, false);
  assert.equal(release.artifactName, 'acbu-backend-v1.2.0.tar.gz');
  assert.equal(release.releaseName, 'backend v1.2.0');
  assert.equal(release.directory, '.');
  assert.equal(release.releaseNotes, 'CHANGELOG.md');
  assert.deepEqual(release.imageTags, ['v1.2.0', '1.2.0', '1.2', 'latest']);
});

test('backend tag releases the root package', () => {
  const release = resolveReleaseTag('backend@v1.2.0');

  assert.equal(release.package, 'backend');
  assert.equal(release.gitTag, 'backend@v1.2.0');
  assert.equal(release.componentTag, 'backend@v1.2.0');
  assert.equal(release.legacy, false);
  assert.deepEqual(release.imageTags, ['v1.2.0', '1.2.0', '1.2', 'latest']);
});

test('frontend tag releases the frontend directory with namespaced image tags', () => {
  const release = resolveReleaseTag('frontend@v2.1.0');

  assert.equal(release.package, 'frontend');
  assert.equal(release.directory, 'frontend');
  assert.equal(release.artifactName, 'acbu-frontend-v2.1.0.tar.gz');
  assert.equal(release.releaseName, 'frontend v2.1.0');
  assert.equal(release.releaseNotes, 'frontend/CHANGELOG.md');
  assert.deepEqual(release.imageTags, [
    'frontend-v2.1.0',
    'frontend-2.1.0',
    'frontend-2.1',
    'frontend-latest',
  ]);
});

test('contracts tag releases the contracts directory with namespaced image tags', () => {
  const release = resolveReleaseTag('contracts@v0.8.0');

  assert.equal(release.package, 'contracts');
  assert.equal(release.directory, 'contracts');
  assert.equal(release.artifactName, 'acbu-contracts-v0.8.0.tar.gz');
  assert.equal(release.releaseName, 'contracts v0.8.0');
  assert.equal(release.releaseNotes, 'contracts/CHANGELOG.md');
  assert.deepEqual(release.imageTags, [
    'contracts-v0.8.0',
    'contracts-0.8.0',
    'contracts-0.8',
    'contracts-latest',
  ]);
});

test('prerelease tags keep the version and are marked as prereleases', () => {
  const release = resolveReleaseTag('backend@v1.2.0-rc.1');

  assert.equal(release.version, '1.2.0-rc.1');
  assert.equal(release.prerelease, true);
  assert.equal(release.versionTag, 'v1.2.0-rc.1');
  assert.equal(release.artifactName, 'acbu-backend-v1.2.0-rc.1.tar.gz');
  assert.deepEqual(release.imageTags, [
    'v1.2.0-rc.1',
    '1.2.0-rc.1',
    '1.2',
    'latest',
  ]);
});

test('surrounding whitespace is tolerated', () => {
  assert.equal(resolveReleaseTag('  frontend@v2.1.0\n').package, 'frontend');
});

test('malformed tags are rejected with actionable messages', () => {
  const cases = [
    ['', /No release tag provided/],
    ['v1.2', /Invalid semantic version/],
    ['backend@1.2.0', /Invalid release tag/],
    ['backend@v01.2.0', /Invalid semantic version/],
    ['unknown@v1.0.0', /Unknown package "unknown"/],
    ['release/1.2.0', /Invalid release tag/],
  ];

  for (const [tag, expected] of cases) {
    assert.throws(() => resolveReleaseTag(tag), (error) => {
      assert.ok(error instanceof ReleaseTagError, `${tag}: expected ReleaseTagError`);
      assert.match(error.message, expected);
      return true;
    });
  }
});

test('CLI prints JSON and writes GITHUB_OUTPUT entries', () => {
  const outputFile = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'acbu-release-')),
    'github-output',
  );
  fs.writeFileSync(outputFile, '');

  const stdout = execFileSync(
    process.execPath,
    [SCRIPT, '--ref', 'frontend@v2.1.0', '--github-output', outputFile],
    { encoding: 'utf8' },
  );

  const release = JSON.parse(stdout);
  assert.equal(release.package, 'frontend');
  assert.equal(release.version, '2.1.0');

  const outputs = fs.readFileSync(outputFile, 'utf8');
  assert.match(outputs, /^package=frontend$/m);
  assert.match(outputs, /^version=2\.1\.0$/m);
  assert.match(outputs, /^git_tag=frontend@v2\.1\.0$/m);
  assert.match(outputs, /^release_name=frontend v2\.1\.0$/m);
  assert.match(outputs, /^artifact_name=acbu-frontend-v2\.1\.0\.tar\.gz$/m);
  assert.match(outputs, /^prerelease=false$/m);
  assert.match(outputs, /image_tags<<EOF\nfrontend-v2\.1\.0\n/, outputs);
  assert.match(outputs, /\nfrontend-latest\nEOF\n$/, outputs);
});

test('CLI exits non-zero for an invalid tag', () => {
  const result = spawnSync(process.execPath, [SCRIPT, '--ref', 'v1.2'], {
    encoding: 'utf8',
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Invalid semantic version/);
  assert.equal(result.stdout, '');
});
