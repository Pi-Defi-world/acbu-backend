# Environment Variable Safety Guard

In Next.js, any environment variable prefixed with `NEXT_PUBLIC_` is inlined into the client-side JavaScript bundle during the build process. This makes the value available to the browser, which means **any secret defined with this prefix is compromised**.

## How the Safety Guard Works

To prevent accidental leaks of sensitive information, we have implemented a build-time validation step in `next.config.mjs` that checks all environment variables for suspicious patterns.

If any `NEXT_PUBLIC_` prefixed variable contains keywords associated with sensitive data (e.g., `DATABASE_URL`, `JWT_SECRET`, `PASSWORD`), the build will fail immediately with a clear security alert.

## What Secrets Must Remain Server-Only

Variables that contain sensitive information **must not** have the `NEXT_PUBLIC_` prefix. These variables are only accessible in Server Components, API Routes, or server-side functions (e.g., `getServerSideProps` in older Next.js versions).

Examples of secrets that must be server-only:
- Database connection strings (`DATABASE_URL`)
- Authentication secrets/tokens (`JWT_SECRET`, `API_SECRET`)
- Private keys (`PRIVATE_KEY`)
- Any API keys for 3rd party services used on the backend.

If you need a variable to be accessible in the client, ensure it is truly public (e.g., public API URLs, feature flags) and prefix it with `NEXT_PUBLIC_`.
