/**
 * Embedding generation utilities
 * Supports multiple embedding APIs (Hugging Face free API, OpenAI, etc.)
 */
import { allowOpenAIEmbeddingFallback } from './ai-config';

interface EmbeddingResponse {
  embedding: number[];
}

/**
 * Generate embedding for a text using available API
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const openAiKey = process.env.OPENAI_API_KEY;
  const embeddingEnvKey = process.env.EMBEDDING_API_KEY;
  const provider = (process.env.EMBEDDING_PROVIDER || 'local').toLowerCase();

  // Windows local ONNX bindings are the fragile path in this repo.
  // If the provider resolves to local on Windows, prefer a remote provider
  // so the app keeps running even when native binaries are unavailable.
  const shouldAvoidLocalOnWindows = provider === 'local' && process.platform === 'win32';
  const canUseOpenAIFallback = allowOpenAIEmbeddingFallback();

  if (provider === 'openai') {
    const key = openAiKey || embeddingEnvKey;
    if (!key) {
      throw new Error('OPENAI_API_KEY or EMBEDDING_API_KEY must be set to use OpenAI embeddings.');
    }
    return generateEmbeddingOpenAI(text, key);
  }

  if (provider === 'huggingface') {
    return generateEmbeddingHuggingFace(text, embeddingEnvKey);
  }

  if (shouldAvoidLocalOnWindows) {
    if (embeddingEnvKey) {
      try {
        return await generateEmbeddingHuggingFace(text, embeddingEnvKey);
      } catch (huggingFaceError) {
        console.warn('[Embeddings] Hugging Face fallback failed on Windows:', huggingFaceError);
      }
    }

    if (canUseOpenAIFallback && (openAiKey || embeddingEnvKey)) {
      const fallbackKey = openAiKey || embeddingEnvKey;
      if (fallbackKey) {
        try {
          return await generateEmbeddingOpenAI(text, fallbackKey);
        } catch (openAiError) {
          console.warn('[Embeddings] OpenAI fallback failed on Windows, returning empty embedding:', openAiError);
        }
      }
    }

    console.warn('[Embeddings] Local ONNX disabled on Windows, returning empty embedding vector');
    return [];
  }

  try {
    return await generateEmbeddingLocal(text);
  } catch (error) {
    console.warn('[Embeddings] Local embedding backend unavailable, falling back:', error);

    if (canUseOpenAIFallback && (openAiKey || embeddingEnvKey)) {
      const fallbackKey = openAiKey || embeddingEnvKey;
      if (fallbackKey) {
        try {
          return await generateEmbeddingOpenAI(text, fallbackKey);
        } catch (openAiError) {
          console.warn('[Embeddings] OpenAI fallback failed, returning empty embedding:', openAiError);
        }
      }
    }

    console.warn('[Embeddings] No fallback embedding provider configured, returning empty embedding vector');
    return [];
  }
}

/**
 * Generate embeddings for multiple texts in batch (much faster than individual calls)
 */
export async function generateEmbeddingsBatchHF(
  texts: string[],
  apiKey: string
): Promise<number[][]> {
  const model = 'BAAI/bge-small-en-v1.5';
  const url = `https://router.huggingface.co/hf-inference/models/${model}`;
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
  };

  // Truncate and prepare texts
  const truncatedTexts = texts.map(t => t.slice(0, 512));
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s for batch
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        inputs: truncatedTexts, // Send array of texts for batch processing
        options: {
          wait_for_model: true,
        },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`Hugging Face API error: ${response.status} ${response.statusText} - ${errorText.slice(0, 200)}`);
    }

    const embeddings = await response.json();
    
    // Handle batch response - should be array of arrays
    if (Array.isArray(embeddings)) {
      if (Array.isArray(embeddings[0]) && typeof embeddings[0][0] === 'number') {
        return embeddings as number[][];
      }
      // If single array returned, wrap it
      if (typeof embeddings[0] === 'number') {
        return [embeddings as number[]];
      }
    }
    
    throw new Error(`Unexpected batch response format`);
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('Batch request timeout');
    }
    throw error;
  }
}

/**
 * Generate embedding using Hugging Face Inference API (free tier)
 * For single embeddings, use this. For multiple, use generateEmbeddingsBatchHF
 */
async function generateEmbeddingHuggingFace(
  text: string,
  apiKey?: string
): Promise<number[]> {
  // Use BAAI/bge-small-en-v1.5 - works reliably with router API
  const model = 'BAAI/bge-small-en-v1.5';
  
  if (!apiKey) {
    throw new Error('EMBEDDING_API_KEY must be set to use Hugging Face embeddings');
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
  };

  // Use the router models endpoint
  const url = `https://router.huggingface.co/hf-inference/models/${model}`;
  
  // Truncate text to reasonable length (Hugging Face has limits)
  const truncatedText = text.slice(0, 512);

  let lastError: Error | null = null;
  const maxRetries = 1; // Single retry for speed (fail fast if API is down)
  const REQUEST_TIMEOUT = 8000; // 8 seconds timeout (faster failure detection)
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Create AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
      
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            inputs: truncatedText,
            options: {
              wait_for_model: true,
            },
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorText = await response.text().catch(() => '');
          let errorMessage = `Hugging Face API error: ${response.status} ${response.statusText}`;
          
          try {
            const errorJson = JSON.parse(errorText);
            errorMessage = errorJson.error || errorJson.message || errorMessage;
          } catch {
            if (errorText) {
              errorMessage = `${errorMessage} - ${errorText.slice(0, 200)}`;
            }
          }
          
          // Handle rate limiting (429) or model loading (503) with retry
          if (response.status === 429 || response.status === 503) {
            const waitTime = Math.min(attempt * 1000, 3000); // 1s, 2s (max 3s) - faster retry
            if (attempt < maxRetries) {
              await new Promise(resolve => setTimeout(resolve, waitTime));
              continue; // Retry
            }
          }
          
          throw new Error(errorMessage);
        }

        const embedding = await response.json();
        
        // Handle different response formats
        if (Array.isArray(embedding)) {
          if (Array.isArray(embedding[0])) {
            return embedding[0] as number[];
          }
          if (typeof embedding[0] === 'number') {
            return embedding as number[];
          }
        }
        
        if (embedding && Array.isArray(embedding.embedding)) {
          return embedding.embedding as number[];
        }
        
        throw new Error(`Unexpected response format`);
      } catch (fetchError: any) {
        clearTimeout(timeoutId);
        if (fetchError.name === 'AbortError') {
          throw new Error('Request timeout after 15 seconds');
        }
        throw fetchError;
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      // Don't retry on certain errors (auth, bad request, timeout on last attempt)
      if (error instanceof Error && (
        error.message.includes('401') || 
        error.message.includes('403') ||
        error.message.includes('400') ||
        (error.message.includes('timeout') && attempt === maxRetries)
      )) {
        throw lastError;
      }
      
      // Faster retry with minimal delay
      if (attempt < maxRetries) {
        const waitTime = attempt * 500; // 500ms, 1000ms - faster retries
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }
  
  // All retries failed
  throw lastError || new Error('Failed to generate embedding with Hugging Face');
}

/**
 * Generate embedding using OpenAI API
 */
async function generateEmbeddingOpenAI(
  text: string,
  apiKey: string
): Promise<number[]> {
  try {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small', // Cost-effective option
        input: text,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`OpenAI API error: ${error.error?.message || response.statusText}`);
    }

    const data = await response.json();
    return data.data[0].embedding;
  } catch (error) {
    console.error('Error generating embedding with OpenAI:', error);
    throw error;
  }
}

let localPipelinePromise: Promise<any> | null = null;

async function generateEmbeddingLocal(text: string): Promise<number[]> {
  const extractor = await getLocalPipeline();
  const output = await extractor(text, {
    pooling: 'mean',
    normalize: true,
  });
  return Array.from(output.data);
}

async function getLocalPipeline() {
  if (!localPipelinePromise) {
    localPipelinePromise = (async () => {
      try {
        const { pipeline } = await import('@xenova/transformers');
        return pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
          quantized: true,
        });
      } catch (error) {
        localPipelinePromise = null;
        throw error;
      }
    })();
  }
  return localPipelinePromise;
}

/**
 * Generate embeddings for multiple texts in batch
 * Optimized for speed with parallel processing and rate limiting
 */
export async function generateEmbeddingsBatch(
  texts: string[],
  batchSize: number = 10,
  delayMs: number = 100
): Promise<number[][]> {
  const results: number[][] = [];
  
  // Process in batches to avoid rate limits
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    
    // Process batch in parallel
    const batchResults = await Promise.all(
      batch.map(text => generateEmbedding(text).catch(err => {
        console.error('Error generating embedding:', err);
        return []; // Return empty array on error
      }))
    );
    
    results.push(...batchResults);
    
    // Add delay between batches to respect rate limits (except for last batch)
    if (i + batchSize < texts.length) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  
  return results;
}

