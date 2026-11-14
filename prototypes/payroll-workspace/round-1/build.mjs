// Inlines src/ into one self-contained HTML file per variant: node build.mjs
import { readFileSync, writeFileSync } from 'node:fs';
const dir = new URL('.', import.meta.url).pathname;
const r = f => readFileSync(dir + 'src/' + f, 'utf8');
const css = ['font.css', 'base.css', 'payroll.css'].map(r).join('\n');
const names = { a: 'Period file', b: 'Work desk', c: 'Linked registers' };
for (const k of Object.keys(names)) {
  const js = ['data.js', 'core.js', 'sections.js', k + '.js', 'shell.js'].map(r).join('\n');
  writeFileSync(dir + k + '.html', `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Payroll workspace · ${k.toUpperCase()} ${names[k]} · prototype for #327</title>
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
