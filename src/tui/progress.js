import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { terminalText } from './logo.js';

const h = React.createElement;
const duration = (ms) => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};

export function RunProgress({ project, phases, busy, controls = true }) {
  const run = project?.runs.at(-1);
  const active = run && ['queued', 'running'].includes(run.status);
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    if (!active && !busy) return;
    const timer = setInterval(() => setClock(Date.now()), 250);
    return () => clearInterval(timer);
  }, [active, busy]);
  const spinner = ['|', '/', '-', '\\'][Math.floor(clock / 250) % 4];
  if (busy)
    return h(
      Text,
      { color: '#FFC965', wrap: 'truncate-end' },
      `${spinner} ${terminalText(busy.label)} · ${duration(clock - busy.since)}`,
    );
  if (!run) return null;
  const last = run.events.at(-1);
  const current = phases.find((p) => p.id === run.phase);
  const request = run.events.findLast((e) => e.type === 'request' && e.phase === run.phase);
  const completed = phases.filter((p) => project.artifacts[p.id]).length;
  const reviewCount = phases.reduce(
    (count, phase) => count + (project.artifacts[phase.id]?.reviewNotes?.length || 0),
    0,
  );
  const count = Math.max(1, phases.length);
  const filled = Math.round((12 * completed) / count);
  const elapsed = duration(
    (active ? clock : Date.parse(run.finishedAt || run.createdAt)) -
      Date.parse(run.startedAt || run.createdAt),
  );
  const heading = active
    ? `${spinner} ${current ? `Phase ${phases.indexOf(current) + 1}/${count}: ${current.title}` : 'Preparing pipeline'}`
    : run.status === 'completed'
      ? 'Run complete — results ready for review'
      : run.status === 'awaiting_review'
        ? `Review required: ${current?.title || run.phase} · a Approve, r Continue`
        : run.status === 'failed'
          ? `TRACE paused at ${current?.title || run.phase || 'this step'} · f Continue · l Details`
          : `${run.status.toUpperCase()}: ${run.error || 'Completed artifacts are saved. Press f to resume.'}`;
  let activity = '';
  if (active) {
    activity =
      last?.type === 'progress'
        ? last.characters > 0
          ? `Receiving output · ${last.characters.toLocaleString()} characters`
          : 'Provider connected · waiting for output'
        : last?.type === 'validating'
          ? 'Validating evidence and references'
          : last?.type === 'validation_retry'
            ? 'Checking this step again before continuing'
            : last?.type === 'request'
              ? `Waiting for provider response · attempt ${request?.attempt || last.attempt || 1}/2`
              : last?.message || 'Starting the next phase';
    if (request?.batches > 1) activity += ` · source batch ${request.batch}/${request.batches}`;
    activity += request ? ` · ${request.provider}/${request.model}` : '';
  }
  return h(
    Box,
    { flexDirection: 'column' },
    h(
      Text,
      { color: run.status === 'failed' ? 'red' : '#FFC965', bold: true, wrap: 'truncate-end' },
      terminalText(heading),
    ),
    h(
      Text,
      { wrap: 'truncate-end' },
      `[${'#'.repeat(filled)}${'-'.repeat(12 - filled)}] ${completed}/${count} phases ready · ${elapsed} elapsed${active && run.phaseStartedAt ? ` · phase ${duration(clock - Date.parse(run.phaseStartedAt))}` : ''}${reviewCount ? ` · ${reviewCount} source review note(s)` : ''}`,
    ),
    active ? h(Text, { wrap: 'truncate-end' }, terminalText(activity)) : null,
    active
      ? h(
          Text,
          { dimColor: true, wrap: 'truncate-end' },
          `Last update ${last ? duration(clock - Date.parse(last.at)) : '0s'} ago · ${controls ? 'c Cancel · l Run log · q Save & quit' : 'Esc Return to pipeline controls'}`,
        )
      : null,
  );
}
