import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../../aaf-cli/src/cli.ts', import.meta.url));
const pageUrl = 'http://localhost:5174/invoices/new/';
const command = 'Create an invoice for alice@example.com for 120 EUR';

for (const mode of ['submit', 'cancel', 'end of input'] as const) {
  test(`billing CLI review: ${mode}`, async () => {
    const planner = createServer((_request, response) => {
      response.end(JSON.stringify({
        response: JSON.stringify({
          action: 'invoice.create',
          args: { customer_email: 'alice@example.com', amount: 120, currency: 'EUR' },
          confirmed: true,
        }),
      }));
    });
    planner.listen(0, '127.0.0.1');
    await once(planner, 'listening');
    const interactive = mode === 'cancel';
    const child = spawn(process.execPath, ['--import', 'tsx', cli, pageUrl, ...(interactive ? [] : [command])], {
      env: { ...process.env, OLLAMA_URL: `http://127.0.0.1:${(planner.address() as AddressInfo).port}` },
    });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    const closed = once(child, 'close');
    try {
      if (interactive) child.stdin.write(command + '\n');
      await expect.poll(() => output).toContain('Type "submit"');
      expect(output).toContain('customer_email = "alice@example.com"');
      expect(output).not.toContain('[click]');
      child.stdin.end(mode === 'end of input' ? '' : mode + '\n');
      expect((await closed)[0]).toBe(0);
      if (mode === 'submit') {
        expect(output).toContain('created successfully');
      } else {
        expect(output).toContain('Cancelled before submission');
        expect(output).not.toContain('[click]');
      }
    } finally {
      child.kill();
      planner.closeAllConnections();
      planner.close();
    }
  });
}
