const fs = require('fs');
const path = require('path');

function readFiles(dir) {
  const list = [];
  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const it of items) {
    const full = path.join(dir, it.name);
    if (it.isDirectory()) list.push(...readFiles(full));
    else if (/\.tsx?$/.test(it.name)) list.push(full);
  }
  return list;
}

function parseImports(content) {
  const imports = [];
  const re = /import\s+([^;]+)\s+from\s+['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(content))) {
    imports.push({ spec: m[1].trim(), source: m[2] });
  }
  return imports;
}

function extractNamed(spec) {
  const res = [];
  if (spec.startsWith('{')) {
    const inside = spec.replace(/^{|}$/g, '').trim();
    inside.split(',').map(s => s.trim()).forEach(s => {
      const parts = s.split(/\s+as\s+/);
      res.push(parts[0].trim());
    });
  } else if (spec.includes('{')) {
    const parts = spec.split(',');
    const after = parts.slice(1).join(',').trim();
    if (after.startsWith('{')) {
      const inside = after.replace(/^{|}$/g, '').trim();
      inside.split(',').map(s => s.trim()).forEach(s => {
        const p = s.split(/\s+as\s+/);
        res.push(p[0].trim());
      });
    }
  }
  return res;
}

function findUnusedInFile(file) {
  const content = fs.readFileSync(file, 'utf8');
  const imports = parseImports(content);
  const unused = [];
  for (const imp of imports) {
    if (imp.source === 'lucide-react' || imp.source === "lucide-react") {
      const named = extractNamed(imp.spec);
      for (const n of named) {
        const re = new RegExp("\\b" + n + "\\b", 'g');
        const count = (content.match(re) || []).length;
        if (count <= 1) unused.push({ type: 'icon', name: n });
      }
    }
    if (imp.source.startsWith('@/components/ui') || imp.source === "@/components/ui") {
      const named = extractNamed(imp.spec);
      for (const n of named) {
        const re = new RegExp("\\b" + n + "\\b", 'g');
        const count = (content.match(re) || []).length;
        if (count <= 1) unused.push({ type: 'ui', name: n });
      }
    }
    if (imp.source === 'react' || imp.source === "react") {
      const hooks = ['useState','useEffect','useMemo','useCallback','useRef','useContext'];
      const named = extractNamed(imp.spec);
      for (const n of named) {
        if (hooks.includes(n)) {
          const re = new RegExp("\\b" + n + "\\b", 'g');
          const count = (content.match(re) || []).length;
          if (count <= 1) unused.push({ type: 'hook', name: n });
        }
      }
    }
  }
  return unused.length ? { file, unused } : null;
}

const files = readFiles(path.join(process.cwd(), 'app'));
const report = [];
for (const f of files) {
  const r = findUnusedInFile(f);
  if (r) report.push(r);
}
console.log(JSON.stringify(report, null, 2));
