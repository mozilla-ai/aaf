import { OllamaBackend, OpenAiCompatibleBackend, type LlmBackend } from '@agent-accessibility-framework/planner-local';

export interface CliEnv {
  AAF_LLM_PROVIDER?: string;
  AAF_LLM_BASE_URL?: string;
  AAF_LLM_MODEL?: string;
  AAF_LLM_API_KEY?: string;
  OLLAMA_URL?: string;
  OLLAMA_MODEL?: string;
}

export function createBackendCandidate(env: CliEnv): LlmBackend | null {
  const provider = env.AAF_LLM_PROVIDER || 'ollama';
  if (provider === 'openai') {
    if (!env.AAF_LLM_BASE_URL || !env.AAF_LLM_API_KEY || !env.AAF_LLM_MODEL) return null;
    return new OpenAiCompatibleBackend({
      baseUrl: env.AAF_LLM_BASE_URL,
      apiKey: env.AAF_LLM_API_KEY,
      model: env.AAF_LLM_MODEL,
    });
  }

  return new OllamaBackend(
    env.AAF_LLM_BASE_URL || env.OLLAMA_URL || 'http://localhost:11434',
    env.AAF_LLM_MODEL || env.OLLAMA_MODEL || 'llama3.2',
  );
}

