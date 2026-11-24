/**
 * Safety guard for environment variables.
 * Prevents accidental exposure of server-side secrets in the client-side bundle
 * by validating NEXT_PUBLIC_ prefixed variables.
 */

const DANGEROUS_PATTERNS = [
  'DATABASE_URL',
  'JWT_SECRET',
  'API_SECRET',
  'PRIVATE_KEY',
  'TOKEN',
  'PASSWORD',
];

export function validateEnv(env) {
  const errors = [];
  
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith('NEXT_PUBLIC_') && value) {
      const upperKey = key.toUpperCase();
      
      for (const pattern of DANGEROUS_PATTERNS) {
        if (upperKey.includes(pattern)) {
          errors.push(
            `Security Alert: Sensitive environment variable '${key}' detected with NEXT_PUBLIC_ prefix. ` +
            `This will be exposed in the client-side bundle.`
          );
        }
      }
    }
  }

  if (errors.length > 0) {
    console.error(errors.join('\n'));
    throw new Error('Build failed due to detected sensitive environment variables in client-side config.');
  }
}
