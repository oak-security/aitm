import PDFDocument from 'pdfkit';
import { fileURLToPath } from 'node:url';
import { enabledPhases } from './schema.js';
import { rankedThreats } from './validate.js';
import { insist } from './errors.js';
import { sourceContext } from './ingest.js';

const clean = (text) =>
  String(text ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
const cell = (text) => clean(text).replace(/\|/g, '\\|').replace(/\n/g, '<br>');
const table = (head, rows) =>
  [head, head.map(() => '---'), ...rows]
    .map((row) => `| ${row.map(cell).join(' | ')} |`)
    .join('\n');
const list = (values) =>
  values.length ? values.map((v) => `- ${clean(v)}`).join('\n') : 'None recorded.';
const evidence = (item) =>
  item.evidence.map((e) => `${e.fileId}:${e.startLine}-${e.endLine} — “${e.quote}”`).join('; ') ||
  `Assumption: ${item.assumption}`;

export function markdownReport(project) {
  insist(project.artifacts.report, 'Generate the report phase first.', 409, 'report_missing');
  const enabled = new Set(enabledPhases(project).map((p) => p.id));
  const model = project.artifacts.model.data,
    report = project.artifacts.report.data;
  const reviewed = enabledPhases(project)
    .filter((p) => p.gate)
    .every((p) => project.artifacts[p.id]?.status === 'approved');
  const sections = [
    `# ${clean(project.name)} — TRACE threat model`,
    `**${reviewed ? 'Reviewed' : 'DRAFT — expert review required'}** · ${project.artifacts.report.generatedAt}`,
    'Prepared independently using AiTM by Oak Security. TRACE methodology: Dr. Stefan Beyer, Oak Security (CC BY 4.0).',
    '## Executive summary',
    report.executiveSummary,
    '## Scope',
    project.scope,
    '## Source inventory',
    table(
      ['Source', 'Kind', 'Revision / SHA-256', 'Files'],
      project.sources.map((s) => [s.label, s.kind, s.commit || s.hash, s.files.length]),
    ),
    '### Evidence files',
    table(
      ['File ID', 'Path', 'SHA-256'],
      project.sources.flatMap((s) => s.files.map((f) => [f.id, `${s.label}/${f.path}`, f.hash])),
    ),
    '### Source limitations',
    list([
      ...project.sources.flatMap((s) => s.warnings),
      ...sourceContext(project)
        .filter((f) => f.excerptOnly)
        .map((f) => `${f.source}/${f.path}: only a bounded excerpt was sent to the AI provider.`),
      ...(project.artifacts.ingest?.data.missingEvidence || []),
    ]),
    '## System overview',
    model.overview,
  ];
  for (const [key, title] of [
    ['threatActors', 'Threat actors'],
    ['roles', 'Roles'],
    ['protectedAssets', 'Protected assets'],
    ['invariants', 'Critical invariants'],
    ['components', 'Components'],
  ]) {
    sections.push(
      `## ${title}`,
      table(
        ['ID', 'Name', 'Description', 'Evidence / assumption'],
        model[key].map((i) => [i.id, i.name, i.description, evidence(i)]),
      ),
    );
  }
  sections.push(
    '## Edges & trust boundaries',
    table(
      ['ID', 'From → To', 'Kind / boundary', 'Description', 'Evidence / assumption'],
      model.edges.map((e) => [
        e.id,
        `${e.from} → ${e.to}`,
        `${e.kind}: ${e.boundary}`,
        e.description,
        evidence(e),
      ]),
    ),
  );
  sections.push(
    '## Ranked STRIDE threats',
    table(
      ['ID', 'Threat', 'Category', 'L × I = Risk', 'Targets / assets / invariants'],
      rankedThreats(project).map((t) => [
        t.id,
        t.title,
        t.category,
        `${t.likelihood} × ${t.impact} = ${t.likelihood * t.impact}`,
        [...t.targetIds, ...t.assetIds, ...t.invariantIds].join(', '),
      ]),
    ),
  );
  for (const t of rankedThreats(project))
    sections.push(
      `### ${t.id}: ${t.title}`,
      t.scenario,
      `**Ranking rationale:** ${t.rationale}\n\n**Feasibility:** ${t.feasibility}\n\n**Incentives:** ${t.incentives}\n\n**Blast radius:** ${t.blastRadius}\n\n**Time sensitivity:** ${t.timeSensitivity}\n\n**Confidence:** ${t.confidence}`,
      `**Evidence / assumption:** ${evidence(t)}`,
      '**Existing controls**',
      list(t.existingControls),
      '**Mitigations**',
      list(t.mitigations),
    );
  sections.push(
    '## Coverage',
    table(
      ['Model object', 'Threats', 'Review / rationale'],
      project.artifacts.stride.data.coverage.map((r) => [
        r.objectId,
        r.threatIds.join(', '),
        r.explanation,
      ]),
    ),
  );
  if (enabled.has('trees') && project.artifacts.trees) {
    sections.push('## Attack trees');
    for (const tree of project.artifacts.trees.data.trees) {
      sections.push(`### ${tree.threatId}: ${tree.goal}`);
      const lines = [];
      function walk(parent, depth) {
        for (const n of tree.nodes.filter((n) => n.parentId === parent)) {
          lines.push(
            `${'  '.repeat(depth)}- **${n.id} [${n.operator}]** ${n.label}${n.speculative ? ' (speculative)' : ''}. Prerequisites: ${n.prerequisites.join('; ') || 'none recorded'}. Mitigations: ${n.mitigations.join('; ') || 'see leaves'}. ${evidence(n)}`,
          );
          walk(n.id, depth + 1);
        }
      }
      walk(null, 0);
      sections.push(lines.join('\n'));
    }
    sections.push(
      '### Documented tree omissions',
      list(project.artifacts.trees.data.omitted.map((t) => `${t.threatId}: ${t.reason}`)),
    );
  }
  if (enabled.has('coordination') && project.artifacts.coordination) {
    const c = project.artifacts.coordination.data;
    sections.push('## Collusion & coordination');
    for (const s of c.scenarios)
      sections.push(
        `### ${s.id}: ${s.title}`,
        `Actors / roles: ${s.actorIds.join(', ')}. Assets: ${s.assetIds.join(', ')}. Threshold: ${s.threshold}.`,
        `Incentive: ${s.incentive}\n\nShared dependencies: ${s.sharedDependencies.join('; ')}\n\nConsequence: ${s.consequence}\n\n${evidence(s)}`,
        list(s.mitigations),
      );
    sections.push('### Coordination assumptions', list(c.assumptions));
  }
  sections.push(
    '## Mitigation roadmap',
    table(
      ['ID / Priority', 'Action', 'Owner', 'Links', 'Verification'],
      report.roadmap.map((r) => [
        `${r.id} / ${r.priority}`,
        r.action,
        r.owner,
        r.linkedIds.join(', '),
        r.verification,
      ]),
    ),
    '## Residual risks',
    list(report.residualRisks),
    '## Open assumptions & questions',
    list([
      ...model.openQuestions,
      ...project.artifacts.stride.data.openQuestions,
      ...(enabled.has('coordination')
        ? project.artifacts.coordination?.data.openQuestions || []
        : []),
      ...report.openQuestions,
    ]),
    '## Next steps',
    list(report.nextSteps),
    '## Review record',
    table(
      ['Phase', 'Status', 'Reviewer / date'],
      enabledPhases(project).map((p) => {
        const a = project.artifacts[p.id];
        return [
          p.title,
          a?.status || 'missing',
          a?.review ? `${a.review.reviewer} / ${a.review.at}` : 'Not approved',
        ];
      }),
    ),
    '## Notice',
    'This AI-assisted design-level analysis depends on the supplied evidence and expert review. It is not a code audit, penetration test, certification or warranty of completeness or accuracy. It does not imply that Oak Security authored or endorsed the assessment.',
  );
  return sections.map(clean).join('\n\n') + '\n';
}

export async function pdfReport(project) {
  const markdown = markdownReport(project);
  const doc = new PDFDocument({
    size: 'A4',
    margin: 48,
    bufferPages: true,
    info: {
      Title: `${project.name} — TRACE threat model`,
      Author: 'AiTM — independently prepared using Oak Security tooling',
    },
  });
  const chunks = [],
    completed = new Promise((resolve, reject) => {
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });
  doc.registerFont(
    'Oak',
    fileURLToPath(new URL('../assets/BDOGrotesk-Regular.ttf', import.meta.url)),
  );
  doc.registerFont(
    'Oak-Bold',
    fileURLToPath(new URL('../assets/BDOGrotesk-Bold.ttf', import.meta.url)),
  );
  let tableHeaders = null;
  const pdfText = (text) =>
    text.replace(/\*\*/g, '').replace(/<br>/g, '\n').replace(/\\\|/g, '|').replace(/\t/g, '    ');
  for (const line of markdown.split('\n')) {
    if (!line.trim()) {
      doc.moveDown(0.4);
      tableHeaders = null;
      continue;
    }
    if (/^\|(?:\s*:?-+:?\s*\|)+$/.test(line)) continue;
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      // Keep section headings with the next subsection or record.
      if (doc.y > doc.page.height - (heading[1].length === 2 ? 160 : 110)) doc.addPage();
      doc
        .font('Oak-Bold')
        .fontSize(heading[1].length === 1 ? 21 : heading[1].length === 2 ? 15 : 11)
        .fillColor(heading[1].length === 1 ? '#9C0069' : '#212121')
        .text(heading[2]);
      doc.moveDown(0.4);
    } else {
      // Tables become stacked records, avoiding clipped wide columns in narrow PDF pages.
      let text = line;
      if (line.startsWith('|')) {
        const cells = line
          .slice(1, -1)
          .split(/(?<!\\)\|/)
          .map((v) => v.trim());
        if (!tableHeaders) {
          tableHeaders = cells;
          continue;
        }
        const fields = cells.map((value, i) => `${tableHeaders[i]}: ${value}`);
        text = fields.join('  |  ').length < 190 ? fields.join('  |  ') : fields.join('\n');
        doc.moveDown(0.4);
      }
      doc.font('Oak').fontSize(9).fillColor('#202020');
      const height = doc.heightOfString(pdfText(text), { lineGap: 2 });
      if (height < doc.page.height - 96 && doc.y + height > doc.page.height - 48) doc.addPage();
      doc.text(pdfText(text), { lineGap: 2 });
    }
  }
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc
      .save()
      .strokeColor('#FFC965')
      .moveTo(48, doc.page.height - 36)
      .lineTo(doc.page.width - 48, doc.page.height - 36)
      .stroke()
      .restore();
    doc
      .fontSize(8)
      .fillColor('#666666')
      .text(`AiTM | TRACE | ${i + 1} / ${range.count}`, 48, doc.page.height - 29, {
        lineBreak: false,
      });
  }
  doc.end();
  return completed;
}
