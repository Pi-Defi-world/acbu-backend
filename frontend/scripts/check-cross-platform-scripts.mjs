import { readFile } from 'node:fs/promises'
import process from 'node:process'

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))

const unixOnlyPatterns = [
  {
    pattern: /\brm\s+(?:-rf|-fr|-r\s+-f|-f\s+-r)\b/,
    replacement: 'rimraf or a Node.js cleanup script',
  },
  {
    pattern: /(?:^|[;&|]\s*)cp\s+\S+/,
    replacement: 'shx cp or a Node.js copy script',
  },
  {
    pattern: /(?:^|[;&|]\s*)mkdir\s+-p\b/,
    replacement: 'shx mkdir -p or a Node.js directory script',
  },
]

const failures = Object.entries(packageJson.scripts ?? {}).flatMap(([name, command]) =>
  unixOnlyPatterns
    .filter(({ pattern }) => pattern.test(command))
    .map(({ replacement }) => ({ name, command, replacement })),
)

if (failures.length > 0) {
  console.error('Found package scripts that rely on Unix-specific shell commands:')

  for (const { name, command, replacement } of failures) {
    console.error(`- ${name}: ${command}`)
    console.error(`  Use ${replacement} for Windows-compatible scripts.`)
  }

  process.exit(1)
}

process.stdout.write('Package scripts are cross-platform compatible.\n')
