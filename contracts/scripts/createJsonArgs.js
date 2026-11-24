const fs = require('fs');
const { execFileSync } = require('child_process');
const path = require('path');

function parseArgs() {
  const args = process.argv.slice(2);
  const config = {};
  for (let i = 0; i < args.length; i += 2) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      config[key] = args[i + 1];
    }
  }
  return config;
}

const config = parseArgs();

function loadFromFile(filePath) {
  try {
    const fileConfig = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return fileConfig;
  } catch (e) {
    console.error(`Error reading config file: ${e.message}`);
    process.exit(1);
  }
}

let admin = config.admin || process.env.ADMIN;
let currenciesInput = config.currencies || null;
let weightsInput = config.weights || null;

if (config.config && fs.existsSync(config.config)) {
  const fileConfig = loadFromFile(config.config);
  admin = admin || fileConfig.admin || process.env.ADMIN;
  currenciesInput = currenciesInput || fileConfig.currencies || null;
  weightsInput = weightsInput || fileConfig.weights || null;
}

if (!admin) {
  console.error('Error: ADMIN must be provided via --admin flag, --config file, or ADMIN env var');
  process.exit(1);
}

const rawCurrencies = currenciesInput ? currenciesInput.split(',') : ["NGN", "ZAR", "KES", "EGP", "GHS", "RWF", "XOF", "MAD", "TZS", "UGX"];
const currencies = rawCurrencies.map(c => { return {"SorobanString": c}; });

const rawWeightsStr = weightsInput || null;
let rawWeights;
if (rawWeightsStr) {
  try {
    rawWeights = JSON.parse(rawWeightsStr);
  } catch (e) {
    console.error('Error: --weights must be valid JSON object');
    process.exit(1);
  }
} else {
  rawWeights = { "NGN": 18, "ZAR": 15, "KES": 12, "EGP": 11, "GHS": 9, "RWF": 8, "XOF": 8, "MAD": 7, "TZS": 6, "UGX": 6 };
}

const weights = Object.entries(rawWeights).map(([k, v]) => {
  return {
    key: {"SorobanString": k},
    val: v
  };
});

const rootDir = path.resolve(__dirname, '..');
fs.writeFileSync(path.join(rootDir, 'validators.json'), JSON.stringify([admin]));
fs.writeFileSync(path.join(rootDir, 'currencies.json'), JSON.stringify(currencies));
fs.writeFileSync(path.join(rootDir, 'weights.json'), JSON.stringify(weights));

execFileSync('python3', [path.join(rootDir, 'scripts', 'validate_config.py')], {
  cwd: rootDir,
  stdio: 'inherit',
});

console.log('JSON files created and validated.');
console.log('Usage: node scripts/createJsonArgs.js --admin <admin_pubkey> [--currencies NGN,ZAR,KES] [--weights \'{"NGN":18,"ZAR":15}\' [--config config.json]');
console.log('Config file format: {"admin": "pubkey", "currencies": "NGN,ZAR", "weights": "{\"NGN\":18,\"ZAR\":15}"}');
console.log('Or set ADMIN environment variable.');
