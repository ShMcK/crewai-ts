// LLM integrations for crew-ai-ts

/**
 * Represents a generic message in a chat conversation.
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'function' | 'tool'; // 'function' is from OpenAI, 'tool' is more general
  content: string;
  name?: string; // Optional: for function/tool calls and responses
  // toolCallId?: string; // Optional: for linking tool calls to responses
}

/**
 * Basic configuration for any LLM.
 */
export interface LLMConfig {
  modelName?: string; // Should be made mandatory by specific configs like OpenAIConfig
  apiKey?: string; // Common, but some LLMs might have other auth methods
  // biome-ignore lint/suspicious/noExplicitAny: Allows for provider-specific untyped options not yet formalized
  [key: string]: any;
}

/**
 * Basic interface for a generic Language Model.
 */
export interface LLM<TConfig extends LLMConfig = LLMConfig, TResponse = string> {
  readonly id: string; // Unique ID for this LLM instance/configuration
  readonly config: TConfig;
  readonly providerName: string; // e.g., "openai", "ollama", "custom"
  invoke: (prompt: string) => Promise<TResponse>;
}

/**
 * Interface for a Language Model that supports chat-based interactions.
 */
export interface ChatLLM<TConfig extends LLMConfig = LLMConfig, TResponse = ChatMessage>
  extends LLM<TConfig, TResponse> {
  chat: (messages: ChatMessage[]) => Promise<TResponse>;
}

// --- OpenAI Specific --- 

export interface OpenAIConfig extends LLMConfig {
  modelName: string; // e.g., 'gpt-3.5-turbo', 'gpt-4'
  apiKey: string;
  temperature?: number; // Defaults to 1, Range: 0 to 2
  topP?: number; // Defaults to 1, Range: 0 to 1 (nucleus sampling)
  maxTokens?: number; // Max tokens to generate
  presencePenalty?: number; // Range: -2.0 to 2.0
  frequencyPenalty?: number; // Range: -2.0 to 2.0
  baseURL?: string; // For OpenAI compatible APIs or proxies
  // stream?: boolean; // For future streaming support
  // user?: string; // A unique identifier representing your end-user
  // response_format?: { type: "text" | "json_object" }; // For JSON mode
}

// Custom Error for OpenAI API issues
export class OpenAIError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public errorType?: string,
    public originalError?: unknown,
  ) {
    super(message);
    this.name = 'OpenAIError';
    // Set the prototype explicitly for V8 environments (like Node.js)
    Object.setPrototypeOf(this, OpenAIError.prototype);
  }
}

// Factory function for creating an OpenAI ChatLLM client object
export function createOpenAIChatClient(config: OpenAIConfig): ChatLLM<OpenAIConfig> {
  if (!config.apiKey) {
    // In a real app, you might fetch this from process.env.OPENAI_API_KEY
    // For now, if no key, we will use simulation but warn.
    console.warn(
      'OpenAI API key not provided in config. Using simulated responses.'
    );
  }
  if (!config.modelName) {
    throw new OpenAIError('OpenAI modelName is required.');
  }

  const effectiveBaseURL = config.baseURL || 'https://api.openai.com/v1';

  return {
    id: `openai-${config.modelName}-${config.temperature ?? 0.7}-${config.maxTokens ?? 'default'}`,
    providerName: 'openai',
    config,
    async invoke(prompt: string): Promise<ChatMessage> {
      return this.chat([{ role: 'user', content: prompt }]);
    },
    async chat(messages: ChatMessage[]): Promise<ChatMessage> {
      if (!config.apiKey) { // Fallback to simulation if no API key
        console.log(
          `SIMULATING OpenAI API call to model '${config.modelName}' at ${effectiveBaseURL}. Messages:`, messages
        );
        const lastUserMessage = messages.filter(m => m.role === 'user').pop();
        return {
          role: 'assistant',
          content: `Mocked OpenAI response for model '${config.modelName}' to: ${lastUserMessage?.content ?? 'last user message'}`,
        };
      }

      const body: Record<string, unknown> = {
        model: config.modelName,
        messages,
      };
      if (config.temperature !== undefined) body.temperature = config.temperature;
      if (config.topP !== undefined) body.top_p = config.topP; // Note: API uses top_p
      if (config.maxTokens !== undefined) body.max_tokens = config.maxTokens; // API uses max_tokens
      if (config.presencePenalty !== undefined) body.presence_penalty = config.presencePenalty;
      if (config.frequencyPenalty !== undefined) body.frequency_penalty = config.frequencyPenalty;
      // if (config.stream) body.stream = true;
      // if (config.user) body.user = config.user;
      // if (config.response_format) body.response_format = config.response_format;

      try {
        const response = await fetch(`${effectiveBaseURL}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          let errorData: unknown;
          let errorText = `HTTP error ${response.status} ${response.statusText || ''}`.trim();
          try {
            // Try to parse as JSON, but clone first in case it's not JSON
            // so that response.text() can be used on the original if JSON parsing fails.
            const clonedResponse = response.clone();
            errorData = await clonedResponse.json();
            // Using type assertion here after JSON.parse, assuming a common error structure for OpenAI
            const openAIErrorPayload = errorData as { error?: { message?: string; type?: string }; message?: string }; 

            if (openAIErrorPayload?.error?.message) {
              errorText = openAIErrorPayload.error.message;
            } else if (openAIErrorPayload?.message) {
               errorText = openAIErrorPayload.message; // Some errors might have a direct message property
            }
          } catch (jsonError) {
            // If JSON parsing fails, try to get the raw text body
            try {
              const rawErrorBody = await response.text(); // Use original response here
              errorText = rawErrorBody || errorText; // Prefer raw body if available, else stick to statusText
            } catch (textError) {
              // If reading text body also fails, log it and use the initial errorText
              console.error('Failed to read error body as text:', textError);
            }
          }
          throw new OpenAIError(
            `OpenAI API error: ${response.status} ${response.statusText || ''} - ${errorText}`.trim(),
            response.status,
            // Safely access type from the parsed errorData
            ((errorData as { error?: { type?: string } })?.error?.type) || 'api_error',
          );
        }

        const data = await response.json() as { choices?: [{ message: ChatMessage }] };
        if (
          !data.choices ||
          !Array.isArray(data.choices) ||
          data.choices.length === 0 ||
          !data.choices[0].message
        ) {
          throw new OpenAIError('OpenAI API returned an unexpected response structure. No choices found or choices array is empty.', response.status, 'api_structure_error');
        }
        return data.choices[0].message;
      } catch (e) {
        if (e instanceof OpenAIError) {
          throw e; // Re-throw if it's already our custom error
        }
        const networkError = e instanceof Error ? e : new Error(String(e));
        throw new OpenAIError(`Network request failed while communicating with OpenAI API: ${networkError.message}`, undefined, 'network_error', networkError);
      }
    },
  };
}

// Placeholder for a generic LLM creator (e.g., for local models via Ollama)
// export interface OllamaConfig extends LLMConfig { endpoint: string; modelName: string; }
// export function createOllamaClient(config: OllamaConfig): ChatLLM<OllamaConfig> { ... }
