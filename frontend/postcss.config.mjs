

/** @type {import('postcss-load-config').Config} */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
    'postcss-preset-env': {
      stage: 2,
      features: {
        'has-pseudo-class': true,
        'oklab-function': true,
        'container-rule-prelude-list': true,
      },
    },
  },
}

export default config;
