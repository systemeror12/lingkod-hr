// Inlines the shared engine from round 1 and this round's UI into one self-contained HTML file per variant: node build.mjs
import { readFileSync, writeFileSync } from 'node:fs';
const dir = new URL('.', import.meta.url).pathname;
const r = f => readFileSync(dir + f, 'utf8');
const css = ['../round-1/src/font.css', '../round-1/src/base.css', 'src/r2.css'].map(r).join('\n');
const names = { a: 'Payslips only', b: 'Payslips and runs', c: 'Month bar' };
for (const k of Object.keys(names)) {
  const js = ['../round-1/src/data.js', '../round-1/src/core.js', 'src/' + k + '.js', 'src/ui.js'].map(r).join('\n');
  writeFileSync(dir + k + '.html', `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Payroll workspace · round 2 · ${k.toUpperCase()} ${names[k]} · prototype for #327</title>
<style>
${css}
</style>
</head>
<body>
<div id="app"></div>
<dialog id="dlg" aria-labelledby="dlg-title" aria-describedby="dlg-desc"></dialog>
<script>
${js}
</script>
</body>
</html>
`);
}
