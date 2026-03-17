import type { LlmBackend, ToolDefinition, ToolCallResult } from './types.js';

export interface OpenAiBackendOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/**
 * LlmBackend for any OpenAI-compatible /v1/chat/completions endpoint.
 * Works with OpenAI, Claude compat, Groq, Together, vLLM, LM Studio, etc.
 */
export class OpenAiCompatibleBackend implements LlmBackend {
  private baseUrl: string;
  private apiKey: string;
  private model: string;

  constructor(opts: OpenAiBackendOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.apiKey = opts.apiKey;
    this.model = opts.model;
  }

  async generate(userPrompt: string, systemPrompt: string, opts?: { json?: boolean }): Promise<string> {
    const json = opts?.json ?? true;

    const body: Record<string, unknown> = {
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.1,
    };
    if (json) body.response_format = { type: 'json_object' };

    const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`OpenAI API error: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? '';
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/v1/models`, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(3000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  name(): string {
    return 'OpenAI';
  }

  setModel(model: string): void {
    this.model = model;
  }

  currentModel(): string {
    return this.model;
  }

  /** Generate using native tool-use via the OpenAI-compatible tools parameter. */
  async generateWithTools(
    userPrompt: string,
    systemPrompt: string,
    tools: ToolDefinition[],
  ): Promise<ToolCallResult> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      tools,
      temperature: 0.1,
    };

    const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`OpenAI API error: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    const message = data.choices?.[0]?.message;

    if (message?.tool_calls?.length > 0) {
      const call = message.tool_calls[0];
      const args = typeof call.function.arguments === 'string'
        ? JSON.parse(call.function.arguments)
        : call.function.arguments;
      return {
        toolCall: {
          name: call.function.name,
          arguments: args,
        },
      };
    }

    return { textResponse: message?.content ?? '' };
  }
}
