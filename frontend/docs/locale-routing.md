# Locale routing status

The frontend has a `next-intl` middleware in `middleware.ts` and request configuration in
`i18n/request.ts`. Supported locales are `en`, `en-NG`, and `en-KE`, with `en` as the default. For localized routes, `next-intl` uses the request locale cookie and the `Accept-Language` header when choosing a locale.

## Current limitation

The route tree is only partially localized: the app has both `app/[locale]` and root-level routes such as `app/bills`. The middleware matcher is therefore intentionally limited to `/` and locale-prefixed paths. Applying locale redirects to every root-level route before migrating those pages could redirect users to paths that do not exist (for example, `/en/bills`).

## Follow-up

Migrate remaining root-level pages into `app/[locale]`, verify navigation and localized layouts, and then expand the middleware matcher to cover all application pages while excluding API routes, Next.js internals, and static assets. Until that migration is complete, full application-wide locale routing is deferred.
