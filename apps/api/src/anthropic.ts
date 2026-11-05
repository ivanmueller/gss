import Anthropic from '@anthropic-ai/sdk';

// Claude (Anthropic), called only from the Worker (the owner's decisions of 2026-11-05,
// docs/DECISIONS.md): the API key is a Worker secret the owner adds in Cloudflare; it never
// reaches the browser or Git. Each call's transcript is read once, in one request with no
// tools: Claude answers in a fixed JSON shape (structured outputs) that the Worker checks
// before keeping anything (readings.ts in @grain/domain). Official SDK: @anthropic-ai/sdk.

export interface AnthropicBindings {
  /** Anthropic API key (Worker secret). */
  ANTHROPIC_API_KEY?: string;
}

/** The model that reads calls: the owner's choice of 2026-11-05. */
export const READING_MODEL = 'claude-opus-5-5';

/** How long the request may take. */
export const READING_TIMEOUT_MS = 150_000;
/**
 * The SDK never tries again by itself (Codex's review of 1485b23, finding 4): a retry could
 * hide that an earlier try timed out after Anthropic had it, and the call's attempt would be
 * given back as if nothing had been charged. The job's next run, 2 minutes later, is the retry.
 */
const READING_RETRIES = 0;
/**
 * How long reading one call may take in all, the answer's body included, well within the
 * 10-minute claim on a recording (Codex's review of c9222d3, finding 4).
 */
export const READING_DEADLINE_MS = 5 * 60_000;

/** Reading a call took longer than READING_DEADLINE_MS; it was abandoned. */
export class ReadingDeadlineError extends Error {
  override name = 'ReadingDeadlineError';
}
/** Enough for the notes and drafts of a long call, with Claude's thinking. */
const READING_MAX_TOKENS = 16_000;

export interface ReadingRequest {
  /** The fixed instructions, the same for every call (cached by Anthropic). */
  system: string;
  /** The call: who, when, the company's contacts, and the numbered transcript. */
  user: string;
  /** The JSON schema of the answer. */
  schema: Record<string, unknown>;
}

export type ReadingAnswer =
  | {
      status: 'read';
      /** The answer as parsed JSON, not yet checked. */
      json: unknown;
      /** The model that answered: the one asked for, or the one Anthropic fell back to. */
      model: string;
      inputTokens: number;
      outputTokens: number;
    }
  | {
      /** Declined (after any fallback), cut off at the token limit, or not JSON. */
      status: 'refused' | 'cut_off' | 'not_json';
      model: string;
    };

export interface ClaudeClient {
  readCall: (request: ReadingRequest) => Promise<ReadingAnswer>;
}

export type ClaudeFactory = (env: AnthropicBindings) => ClaudeClient | null;

/** Runs a request with an abort signal, abandoning it (and aborting it) after `ms`. */
async function withDeadline<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new ReadingDeadlineError('Reading the call took too long.'));
    }, ms);
  });
  try {
    return await Promise.race([run(controller.signal), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/** Claude over Anthropic's API, or null when the key is not set. */
export const claudeClient = (
  env: AnthropicBindings,
  {
    deadlineMs = READING_DEADLINE_MS,
    timeoutMs = READING_TIMEOUT_MS,
  }: { deadlineMs?: number; timeoutMs?: number } = {},
): ClaudeClient | null => {
  const apiKey = env.ANTHROPIC_API_KEY?.trim() ?? '';
  if (apiKey === '') return null;
  const client = new Anthropic({
    apiKey,
    // Always Anthropic's own API, whatever the environment says.
    baseURL: 'https://api.anthropic.com',
    timeout: timeoutMs,
    maxRetries: READING_RETRIES,
  });
  return {
    async readCall(request) {
      const response = await withDeadline(deadlineMs, (signal) =>
        client.beta.messages.create(
          {
            model: READING_MODEL,
            max_tokens: READING_MAX_TOKENS,
            // A declined request is tried again on the model Anthropic recommends for it.
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default',
            output_config: {
              effort: 'medium',
              format: { type: 'json_schema', schema: request.schema },
            },
            system: [{ type: 'text', text: request.system, cache_control: { type: 'ephemeral' } }],
            messages: [{ role: 'user', content: request.user }],
          },
          { signal },
        ),
      );
      const model = response.model;
      if (response.stop_reason === 'refusal') return { status: 'refused', model };
      if (response.stop_reason === 'max_tokens') return { status: 'cut_off', model };
      const text = response.content
        .flatMap((block) => (block.type === 'text' ? [block.text] : []))
        .join('');
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        return { status: 'not_json', model };
      }
      const usage = response.usage;
      return {
        status: 'read',
        json,
        model,
        inputTokens:
          usage.input_tokens +
          (usage.cache_creation_input_tokens ?? 0) +
          (usage.cache_read_input_tokens ?? 0),
        outputTokens: usage.output_tokens,
      };
    },
  };
};

/**
 * Whether Anthropic answered a request with an error, or it never reached Anthropic: nothing
 * was read, so nothing was charged, and the call's attempt is given back. A timeout or the
 * deadline is not: Anthropic may have read the call, so the attempt counts.
 */
export function notTakenByAnthropic(error: unknown): boolean {
  if (error instanceof ReadingDeadlineError) return false;
  if (error instanceof Anthropic.APIConnectionTimeoutError) return false;
  if (error instanceof Anthropic.APIConnectionError) return true;
  return error instanceof Anthropic.APIError && error.status !== undefined;
}

/**
 * Anthropic's own explanation of a refused request ("Schema is too complex for compilation."),
 * made safe to log: anything quoted is removed, and so are runs of digits, so no word or number
 * from a call can reach the log; one line, at most 160 characters.
 */
function safeMessage(text: string): string {
  return text
    .replace(/"[^"]*"|'[^']*'|`[^`]*`|“[^”]*”/g, '…')
    .replace(/\d{3,}/g, '#')
    .replace(/[^\x20-\x7e…#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

/**
 * A secret-free summary of a failed request: the API's status and error type, and its message
 * with anything quoted and any digits taken out (safeMessage); never the request's text.
 */
export function claudeFailure(error: unknown): string {
  if (error instanceof ReadingDeadlineError) return 'deadline';
  if (error instanceof Anthropic.APIConnectionTimeoutError) return 'timeout';
  if (error instanceof Anthropic.APIConnectionError) return 'connection';
  if (error instanceof Anthropic.APIError) {
    const body: unknown = error.error;
    const details =
      typeof body === 'object' && body !== null && 'error' in body
        ? (body as { error?: { type?: unknown; message?: unknown } }).error
        : undefined;
    const type = details?.type;
    const message = typeof details?.message === 'string' ? safeMessage(details.message) : '';
    return `status=${String(error.status)}${typeof type === 'string' && /^[a-z_]{1,60}$/.test(type) ? ` type=${type}` : ''}${message === '' ? '' : ` message=${message}`}`;
  }
  return error instanceof Error ? error.name : 'unknown';
}
