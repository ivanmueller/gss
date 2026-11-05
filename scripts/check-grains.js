// Checks the Grains reference (apps/web/src/data/grains) against its sources: every value,
// table cell, grade name and variety must appear in the text of the source it cites, and a
// table row's numbers near that row's label (owner's request, 2026-11-05: nothing on the page
// may be estimated or filled in from memory).
//
//   node --experimental-strip-types scripts/check-grains.js --fetch   # download the sources once
//   node --experimental-strip-types scripts/check-grains.js           # check every grain file
//   node --experimental-strip-types scripts/check-grains.js oats.ts   # check some
//
// The sources are public pages and PDFs of the Canadian Grain Commission and the Alberta Seed
// Guide; their text is kept in .grain-sources/ (not in Git). PDFs are read with pdftotext
// (poppler-utils). The check cannot tell whether a number sits in the right column: check that
// by eye against the source when adding or changing a table.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = new URL('..', import.meta.url).pathname;
const DATA = join(ROOT, 'apps/web/src/data/grains');
const TEXTS = join(ROOT, '.grain-sources');
const NOT_GRAINS = new Set(['index.ts', 'types.ts', 'sources.ts']);

/** The PDF behind a source whose page links to it. */
const PDFS = {
  'cgc-oggg':
    'https://www.grainscanada.gc.ca/en/grain-quality/official-grain-grading-guide/pdf/oggg-2026-27.pdf',
};

/** Downloads with curl, which follows the system's proxy settings and retries. */
function download(url) {
  return execFileSync(
    'curl',
    ['-sSfL', '--retry', '5', '--retry-all-errors', '--max-time', '300', url],
    { maxBuffer: 1 << 28 },
  );
}

/** A web page's main text, table cells separated by " | ". */
function pageText(html) {
  const main = /<main[\s\S]*?<\/main>/.exec(html)?.[0] ?? html;
  return main
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '')
    .replace(/<\/(td|th)>/g, ' | ')
    .replace(/<\/(p|li|tr|h\d|div|caption|dt|dd)>|<br\s*\/?>/g, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&rsquo;/g, '’')
    .replace(/&quot;/g, '"')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

function pdfText(bytes, name) {
  const file = join(TEXTS, `${name}.pdf`);
  writeFileSync(file, bytes);
  return execFileSync('pdftotext', ['-layout', file, '-'], { maxBuffer: 1 << 28 }).toString();
}

function fetchSources(sources) {
  mkdirSync(TEXTS, { recursive: true });
  for (const [id, source] of Object.entries(sources)) {
    let text;
    if (PDFS[id] || source.url.endsWith('.pdf')) {
      text = pdfText(download(PDFS[id] ?? source.url), id);
    } else if (source.url.endsWith('.csv')) {
      text = download(source.url).toString();
    } else if (id === 'cgc-variety-lists') {
      // The index links one page per class; their texts together are the source.
      const index = download(source.url).toString();
      const links = [
        ...new Set(index.match(/\/en\/grain-quality\/variety-lists\/\d{4}\/vdl-[\w-]+\.html/g)),
      ];
      const pages = [];
      for (const link of links) {
        pages.push(pageText(download(new URL(link, source.url).href).toString()));
      }
      text = pages.join('\n');
    } else {
      text = pageText(download(source.url).toString());
    }
    writeFileSync(join(TEXTS, `${id}.txt`), text);
    console.log(`fetched ${id}`);
  }
}

const norm = (s) =>
  s
    .toLowerCase()
    .replace(/[‐-―−]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const cache = new Map();
function text(id) {
  if (!cache.has(id)) {
    const file = join(TEXTS, `${id}.txt`);
    if (!existsSync(file)) throw new Error(`No text for ${id}: run with --fetch first`);
    cache.set(id, norm(readFileSync(file, 'utf8')));
  }
  return cache.get(id);
}

/**
 * Where a phrase starts in the text: exactly, or (a PDF's columns split a cell over lines) all
 * its words in order, each within 400 characters of the one before. Footnote marks and a lone
 * % are ignored in the words.
 */
function positions(t, value) {
  const v = norm(value);
  const out = [];
  for (let i = t.indexOf(v); i !== -1; i = t.indexOf(v, i + 1)) out.push(i);
  const words = v
    .replace(/[*†]/g, ' ')
    .split(' ')
    .filter((w) => w && w !== '%');
  if (words.length < 2) return out;
  for (let start = t.indexOf(words[0]); start !== -1; start = t.indexOf(words[0], start + 1)) {
    let at = start + words[0].length;
    let ok = true;
    for (const w of words.slice(1)) {
      const next = t.indexOf(w, at);
      if (next === -1 || next - at > 400) {
        ok = false;
        break;
      }
      at = next + w.length;
    }
    if (ok && !out.includes(start)) out.push(start);
  }
  return out;
}

const has = (id, value) => positions(text(id), value).length > 0;
const near = (id, label, value) => {
  const t = text(id);
  const v = norm(value);
  return positions(t, label).some((i) => t.slice(Math.max(0, i - 1500), i + 4000).includes(v));
};
const isNumeric = (s) => /^[<>≤≥~-]?\s*\d[\d.,]*\s*%?$/.test(s.trim());

async function check(files) {
  let problems = 0;
  const fail = (where, message) => {
    problems++;
    console.log(`${where}: ${message}`);
  };
  for (const file of files) {
    const module = await import(pathToFileURL(join(DATA, file)).href);
    for (const grain of Object.values(module)) {
      if (!grain || typeof grain !== 'object' || !('family' in grain)) continue;
      const tag = `${file} [${grain.id}]`;
      const checkFact = (fact) => {
        if (!has(fact.source, fact.value))
          fail(tag, `fact "${fact.label}": "${fact.value}" not in ${fact.source}`);
      };
      const checkTable = (table) => {
        for (const row of table.rows) {
          row.forEach((cell, n) => {
            if (cell === '' || cell === '—') return;
            if (!has(table.source, cell)) {
              fail(tag, `table "${table.title}": "${cell}" not in ${table.source}`);
            } else if (n > 0 && isNumeric(cell) && !near(table.source, row[0], cell)) {
              fail(
                tag,
                `table "${table.title}": "${cell}" not near "${row[0]}" in ${table.source}`,
              );
            }
          });
        }
      };
      grain.facts.forEach(checkFact);
      grain.tables.forEach(checkTable);
      for (const grainClass of grain.classes) {
        (grainClass.facts ?? []).forEach(checkFact);
        (grainClass.tables ?? []).forEach(checkTable);
        for (const [list, citation] of [
          [grainClass.grades, grainClass.gradesCitation],
          [grainClass.varieties, grainClass.varietiesCitation],
        ]) {
          for (const name of list ?? []) {
            if (citation && !has(citation.source, name))
              fail(tag, `${grainClass.name}: "${name}" not in ${citation.source}`);
          }
        }
      }
    }
  }
  console.log(
    problems === 0 ? 'OK: every value found in its source' : `${String(problems)} problem(s)`,
  );
  return problems === 0;
}

const args = process.argv.slice(2);
const { GRAIN_SOURCES } = await import(pathToFileURL(join(DATA, 'sources.ts')).href);
if (args.includes('--fetch')) {
  fetchSources(GRAIN_SOURCES);
} else {
  const named = args.filter((arg) => arg.endsWith('.ts'));
  const files =
    named.length > 0
      ? named
      : readdirSync(DATA).filter(
          (f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !NOT_GRAINS.has(f),
        );
  if (!(await check(files))) process.exit(1);
}
