interface OpenAiEmbeddingResponse {
  data?: Array<{
    embedding?: number[];
    index?: number;
  }>;
}

export interface EmbeddingClient {
  generateEmbeddings(input: string[]): Promise<number[][]>;
}

export interface OpenAiEmbeddingClientOptions {
  apiKey: string;
  model: string;
  dimensions: number;
  timeoutMs?: number;
}

export class OpenAiEmbeddingClient implements EmbeddingClient {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly dimensions: number;
  private readonly timeoutMs: number;

  constructor(options: OpenAiEmbeddingClientOptions) {
    this.apiKey = options.apiKey.trim();
    this.model = options.model;
    this.dimensions = options.dimensions;
    this.timeoutMs =
      Number.isInteger(options.timeoutMs) && (options.timeoutMs as number) > 0
        ? (options.timeoutMs as number)
        : 15_000;
  }

  async generateEmbeddings(input: string[]): Promise<number[][]> {
    if (input.length === 0) {
      return [];
    }

    if (!this.apiKey) {
      throw new Error('OPENAI_API_KEY is required for semantic recommendations.');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, this.timeoutMs);
    let response: Response;

    try {
      response = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          input,
          dimensions: this.dimensions,
        }),
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`OpenAI embeddings request timed out after ${String(this.timeoutMs)}ms.`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const body = await safeReadResponseText(response);
      throw new Error(`OpenAI embeddings request failed (${String(response.status)}): ${body}`);
    }

    const payload = (await response.json()) as OpenAiEmbeddingResponse;

    if (!Array.isArray(payload.data) || payload.data.length !== input.length) {
      throw new Error('OpenAI embeddings response did not include the expected number of vectors.');
    }

    return payload.data
      .slice()
      .sort((left, right) => (left.index ?? 0) - (right.index ?? 0))
      .map((entry) => {
        if (!Array.isArray(entry.embedding)) {
          throw new Error('OpenAI embeddings response entry is missing embedding data.');
        }
        if (entry.embedding.length !== this.dimensions) {
          throw new Error(
            `OpenAI embeddings response entry has incorrect dimension: expected ${String(this.dimensions)}, received ${String(entry.embedding.length)}.`
          );
        }
        if (!entry.embedding.every((value) => Number.isFinite(value))) {
          throw new Error('OpenAI embeddings response entry contains non-finite embedding values.');
        }

        return entry.embedding;
      });
  }
}

async function safeReadResponseText(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.slice(0, 400);
  } catch {
    return 'Unable to read response body.';
  }
}
