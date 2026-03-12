#!/usr/bin/env bun
/**
 * Granola Background Worker
 * Does the actual extraction, summarization, and action processing
 * Spawned by granola-hook.ts to run in background
 */

import { extractGranolaCalls } from './extract-granola';
import { summarizeCalls } from './summarize-calls';
import { processSummaryActions } from './process-summary-actions';
import { logEvent, logError } from './logging';
import { notifyFailure } from './notify';

async function main() {
  try {
    // Step 1: Extract new calls from Granola API
    const extractResult = await extractGranolaCalls({ silent: true });

    if (extractResult.newCalls > 0) {
      // Step 2: Summarize new calls via claude CLI (uses CC subscription, not API key)
      try {
        await summarizeCalls({ silent: true, throwOnError: true });

        // Step 3: Process actions (tasks + CRM) from new summaries
        await processSummaryActions({ silent: true });
      } catch (err: any) {
        logError('granola-worker', 'Summarization or action processing failed', err, 'summarize');
        await notifyFailure(`Granola worker error during summarization/actions: ${err.message || err}`);
      }
    }
  } catch (err: any) {
    logError('granola-worker', 'Granola worker failed', err, 'extract');
    await notifyFailure(`Granola worker error during extraction: ${err.message || err}`);
  }

  process.exit(0);
}

main();
