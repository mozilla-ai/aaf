import type { Page } from '@playwright/test';
import type { AccessibilityNodeSummary } from './inference-prompt.js';

function parseSnapshotLine(line: string): AccessibilityNodeSummary | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('- ')) return null;

  const content = trimmed.slice(2).trim();

  const textMatch = content.match(/^text\s+"([^"]+)"$/);
  if (textMatch) {
    return { role: 'text', value: textMatch[1] };
  }

  const roleMatch = content.match(/^([a-zA-Z_][\w-]*)(?:\s+"([^"]+)")?(?::)?$/);
  if (!roleMatch) return null;

  const [, role, name] = roleMatch;
  return {
    role,
    ...(name ? { name } : {}),
  };
}

export async function extractAccessibilitySummary(page: Page): Promise<AccessibilityNodeSummary[]> {
  const snapshot = await page.locator('body').ariaSnapshot();
  return snapshot
    .split('\n')
    .map((line) => parseSnapshotLine(line))
    .filter((entry): entry is AccessibilityNodeSummary => Boolean(entry))
    .slice(0, 200);
}
