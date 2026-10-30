import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFParse } from 'pdf-parse';
import { setup, finish } from './helpers.js';
import { pdfReport } from '../src/engine/report.js';

test('PDF provides navigable visual findings before the evidence appendix', async (t) => {
  const { engine, p } = await setup(t);
  await finish(engine, p.id);
  const parser = new PDFParse({ data: await pdfReport(engine.get(p.id)) });
  t.after(() => parser.destroy());
  const result = await parser.getText();
  assert.match(result.text, /Risk landscape/);
  assert.match(result.text, /Likelihood/);
  assert.match(result.text, /Impact/);
  assert.match(result.text, /Evidence index/);
  assert.ok(
    result.text.indexOf('Ranked STRIDE threats') < result.text.lastIndexOf('Evidence files'),
  );
  assert.match(result.text, /Shared custody is not yet confirmed/);
  assert.match(result.text, /Test independent compromise boundaries/);
  assert.match(result.text, /Release path considered/);
  await checkLayout(parser);
  const document = await parser.load();
  const outline = await document.getOutline();
  assert.ok(outline?.some((item) => item.title === 'Attack trees'));
});

test('PDF preserves long fields and quotes across pages without clipping or footer-only pages', async (t) => {
  const { engine, p } = await setup(t);
  await finish(engine, p.id);
  const project = engine.get(p.id);
  project.name = 'Long assessment title for a system with multiple trust boundaries '.repeat(4);
  project.scope = 'Long scope paragraph with explicit boundaries. '.repeat(100) + ' SCOPE-END';
  project.artifacts.stride.data.threats[0].scenario =
    'An attacker crosses the trust boundary. '.repeat(150) + ' SCENARIO-END';
  project.artifacts.report.data.executiveSummary =
    'Executive narrative remains readable across page boundaries. '.repeat(100) + ' SUMMARY-END';
  project.artifacts.report.data.roadmap[0].verification =
    'Verify that each independent control fails closed. '.repeat(100) + ' VERIFICATION-END';
  project.artifacts.model.data.components[0].evidence[0].quote =
    'A complete multiline source quotation.\n'.repeat(100) +
    ' `Pool::claim_clock()` **literal** QUOTE-END';
  project.artifacts.model.reviewNotes = [
    { claim: 'Unverified claim', note: 'Keep this visible for review.' },
  ];
  const nodes = project.artifacts.trees.data.trees[0].nodes;
  for (let i = 2; i < 14; i++)
    nodes.push({
      ...nodes[1],
      id: `NODE-${i}`,
      parentId: i === 2 ? nodes[1].id : `NODE-${i - 1}`,
      label: 'A long attack step that still preserves the relationship to its parent. '.repeat(4),
    });
  const parser = new PDFParse({ data: await pdfReport(project) });
  t.after(() => parser.destroy());
  const { text } = await parser.getText();
  for (const marker of [
    'SCOPE-END',
    'SCENARIO-END',
    'SUMMARY-END',
    'VERIFICATION-END',
    'QUOTE-END',
    '`Pool::claim_clock()` **literal**',
    'Unverified claim',
    'Keep this visible for review.',
    'Continued from NODE-12',
  ])
    assert.ok(text.includes(marker), marker);
  await checkLayout(parser);
});

test('PDF omits disabled optional phases and handles an empty threat register', async (t) => {
  const { engine, p } = await setup(t);
  await finish(engine, p.id);
  const project = engine.get(p.id);
  project.config.trees = false;
  project.config.coordination = 'off';
  project.artifacts.stride.data.threats = [];
  const parser = new PDFParse({ data: await pdfReport(project) });
  t.after(() => parser.destroy());
  const doc = await parser.load();
  const outline = await doc.getOutline();
  assert.ok(
    !outline.some((item) => ['Attack trees', 'Collusion & coordination'].includes(item.title)),
  );
  assert.match((await parser.getText()).text, /No threats recorded/);
  await checkLayout(parser);
});

async function checkLayout(parser) {
  const doc = await parser.load();
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const { items } = await page.getTextContent();
    const text = items.filter((item) => item.str?.trim());
    assert.ok(
      text.some((item) => item.transform[5] > 65 && item.transform[5] < 780),
      `Page ${i} contains only a header/footer`,
    );
    for (const item of text) {
      const [, , , , x, y] = item.transform;
      assert.ok(x >= 30 && x + item.width <= 566, `Page ${i}: horizontal overflow: ${item.str}`);
      assert.ok(y >= 24 && y <= 815, `Page ${i}: vertical overflow: ${item.str}`);
    }
    const footer = text.find((item) => item.str === `${i} / ${doc.numPages}`);
    assert.ok(footer && footer.transform[5] < 40, `Page ${i}: missing page count in footer`);
  }
}
