export function isAIAutomationEnabled(): boolean {
  // Set AI_AUTOMATION_ENABLED=false to disable background AI classification flows.
  return process.env.AI_AUTOMATION_ENABLED !== 'false';
}

export function allowOpenAIEmbeddingFallback(): boolean {
  // Set ALLOW_OPENAI_EMBEDDING_FALLBACK=true only if you explicitly want paid fallback.
  return process.env.ALLOW_OPENAI_EMBEDDING_FALLBACK === 'true';
}

