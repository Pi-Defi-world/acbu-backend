#!/usr/bin/env node
'use strict';

/**
 * Resolve a release tag into the metadata the release workflow needs.
 *
 * The monorepo ships three independently versioned packages. A git tag names
 * the package it releases, so a run never has to guess whether "v1.2.0" means
 * backend schema migrations, contract WASM, or a frontend build:
 *
 *   backend@v1.2.0     backend (API server, repository root)
 *   frontend@v2.1.0    frontend (Next.js app, frontend/)
 *   contracts@v0.8.0   contracts (Soroban contracts, contracts/)
 *
 * The legacy bare tag "v1.2.0" is still accepted and resolves to the backend,
 * so existing release automation keeps working while tags are migrated.
 *
 * Usage:
 *   node scripts/release/resolve-release.js --ref backend@v1.2.0
 *   node scripts/release/resolve-release.js --ref v1.2.0 --github-output "$GITHUB_OUTPUT"
 */

const fs = require('node:fs');

const PACKAGE_DEFINITIONS = Object.freeze({
  backend: {
    directory: '.',
    artifactPrefix: 'acbu-backend',
    releaseNotes: 'CHANGELOG.md',
    description: 'backend API server',
  },
  frontend: {
    directory: 'frontend',
    artifactPrefix: 'acbu-frontend',
    releaseNotes: 'frontend/CHANGELOG.md',
    description: 'frontend web app',
  },
  contracts: {
    directory: 'contracts',
    artifactPrefix: 'acbu-contracts',
    releaseNotes: 'contracts/CHANGELOG.md',
    description: 'Soroban smart contracts',
  },
});

const SUPPORTED_PACKAGES = Object.keys(PACKAGE_DEFINITIONS);

// Semantic Versioning 2.0.0, without build metadata (a git tag used as a
// release identity must stay stable, so "+build" suffixes are not accepted).
const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?$/;

const TAG_PATTERN = /^(?:([a-z][a-z0-9-]*)@)?v(.+)$/;

class ReleaseTagError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReleaseTagError';
  }
}

/**
 * Split a release tag into its package and version.
 *
 * @param {string} rawRef git tag, e.g. "backend@v1.2.0" or "v1.2.0"
 * @returns {{ref: string, package: string, version: string, legacy: boolean}}
 */
function parseReleaseTag(rawRef) {
  if (typeof rawRef !== 'string' || rawRef.trim() === '') {
    throw new ReleaseTagError(
      'No release tag provided. Pass --ref with a tag such as "backend@v1.2.0".',
    );
  }

  const ref = rawRef.trim();
  const match = TAG_PATTERN.exec(ref);

  if (!match) {
    throw new ReleaseTagError(
      `Invalid release tag "${ref}". Expected "<package>@v<major>.<minor>.<patch>", ` +
        `one of ${SUPPORTED_PACKAGES.map((name) => `${name}@v…`).join(', ')}, ` +
        'or the legacy backend tag "v<major>.<minor>.<patch>".',
    );
  }

  const explicitPackage = match[1];
  const version = match[2];
  const packageName = explicitPackage || 'backend';

  if (!Object.prototype.hasOwnProperty.call(PACKAGE_DEFINITIONS, packageName)) {
    throw new ReleaseTagError(
      `Unknown package "${packageName}" in tag "${ref}". Supported packages: ${SUPPORTED_PACKAGES.join(', ')}.`,
    );
  }

  if (!SEMVER_PATTERN.test(version)) {
    throw new ReleaseTagError(
      `Invalid semantic version "${version}" in tag "${ref}". ` +
        'Expected MAJOR.MINOR.PATCH, optionally followed by a prerelease such as "-rc.1".',
    );
  }

  return {
    ref,
    package: packageName,
    version,
    legacy: explicitPackage === undefined,
  };
}

/**
 * Turn a parsed tag into everything the workflow publishes.
 *
 * @param {ReturnType<typeof parseReleaseTag>} parsed
 */
function buildReleaseDescriptor(parsed) {
  const definition = PACKAGE_DEFINITIONS[parsed.package];
  const [major, minor] = parsed.version.split('-')[0].split('.');
  const versionTag = `v${parsed.version}`;
  const imagePrefix = parsed.package === 'backend' ? '' : `${parsed.package}-`;

  // The backend keeps the image tags it has always published. Other packages
  // share the same GHCR repository but namespace their tags by package, so a
  // frontend or contracts image can never be mistaken for a backend image.
  const imageTags = [
    `${imagePrefix}${versionTag}`,
    `${imagePrefix}${parsed.version}`,
    `${imagePrefix}${major}.${minor}`,
    `${imagePrefix}latest`,
  ];

  return {
    ref: parsed.ref,
    package: parsed.package,
    version: parsed.version,
    legacy: parsed.legacy,
    gitTag: parsed.ref,
    componentTag: `${parsed.package}@${versionTag}`,
    versionTag,
    releaseName: `${parsed.package} ${versionTag}`,
    artifactName: `${definition.artifactPrefix}-${versionTag}.tar.gz`,
    releaseNotes: definition.releaseNotes,
    directory: definition.directory,
    prerelease: parsed.version.includes('-'),
    imageTags,
  };
}

function resolveReleaseTag(rawRef) {
  return buildReleaseDescriptor(parseReleaseTag(rawRef));
}

/**
 * Append workflow outputs. Multiline values (image tags) use the heredoc form
 * understood by GITHUB_OUTPUT.
 */
function writeGitHubOutput(filePath, descriptor) {
  const lines = [
    `package=${descriptor.package}`,
    `version=${descriptor.version}`,
    `version_tag=${descriptor.versionTag}`,
    `git_tag=${descriptor.gitTag}`,
    `release_name=${descriptor.releaseName}`,
    `artifact_name=${descriptor.artifactName}`,
    `release_notes=${descriptor.releaseNotes}`,
    `directory=${descriptor.directory}`,
    `legacy=${descriptor.legacy}`,
    `prerelease=${descriptor.prerelease}`,
    'image_tags<<EOF',
    ...descriptor.imageTags,
    'EOF',
  ];

  fs.appendFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');
}

function parseArgs(argv) {
  const options = { ref: undefined, githubOutput: undefined, help: false };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--ref') {
      options.ref = argv[index + 1];
      index += 1;
    } else if (arg.startsWith('--ref=')) {
      options.ref = arg.slice('--ref='.length);
    } else if (arg === '--github-output') {
      options.githubOutput = argv[index + 1];
      index += 1;
    } else if (arg.startsWith('--github-output=')) {
      options.githubOutput = arg.slice('--github-output='.length);
    } else {
      throw new ReleaseTagError(`Unknown argument "${arg}". See --help.`);
    }
  }

  return options;
}

const USAGE = `Resolve a component-scoped release tag.

Usage:
  node scripts/release/resolve-release.js --ref <tag> [--github-output <file>]

Tags:
  backend@v1.2.0     backend release
  frontend@v2.1.0    frontend release
  contracts@v0.8.0   contracts release
  v1.2.0             legacy tag, still resolved as a backend release
`;

function main() {
  let options;

  try {
    options = parseArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(USAGE);
      return;
    }

    const descriptor = resolveReleaseTag(options.ref);

    if (descriptor.legacy) {
      process.stderr.write(
        `::warning::Legacy tag "${descriptor.ref}" is treated as a backend release. ` +
          `Use "backend@${descriptor.versionTag}" for new backend releases so the package is explicit.\n`,
      );
    }

    if (options.githubOutput) {
      writeGitHubOutput(options.githubOutput, descriptor);
    }

    process.stdout.write(`${JSON.stringify(descriptor, null, 2)}\n`);
  } catch (error) {
    if (!(error instanceof ReleaseTagError)) {
      throw error;
    }

    const message = error.message.replace(/\r?\n/g, ' ');
    process.stderr.write(
      process.env.GITHUB_ACTIONS === 'true'
        ? `::error::${message}\n`
        : `error: ${message}\n`,
    );
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  PACKAGE_DEFINITIONS,
  SUPPORTED_PACKAGES,
  ReleaseTagError,
  buildReleaseDescriptor,
  parseReleaseTag,
  resolveReleaseTag,
  writeGitHubOutput,
};
