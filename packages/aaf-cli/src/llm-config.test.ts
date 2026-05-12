import { describe, expect, it } from 'vitest';
import { createBackendCandidate } from './llm-config.js';

describe('createBackendCandidate', () => {
  it('defaults to legacy Ollama env vars', () => {
    const backend = createBackendCandidate({
      OLLAMA_URL: 'http://localhost:11434',
      OLLAMA_MODEL: 'llama3.2',
    });

    expect(backend?.name()).toBe('Ollama');
    expect(backend?.currentModel?.()).toBe('llama3.2');
  });

  it('builds an OpenAI-compatible backend when configured', () => {
    const backend = createBackendCandidate({
      AAF_LLM_PROVIDER: 'openai',
      AAF_LLM_BASE_URL: 'https://api.example.com',
      AAF_LLM_API_KEY: 'secret',
      AAF_LLM_MODEL: 'gpt-test',
    });

    expect(backend?.name()).toBe('OpenAI');
    expect(backend?.currentModel?.()).toBe('gpt-test');
  });

  it('returns null when required OpenAI config is missing', () => {
    expect(createBackendCandidate({ AAF_LLM_PROVIDER: 'openai' })).toBeNull();
  });
});

