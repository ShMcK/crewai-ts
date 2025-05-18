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

// --- Anthropic Specific Types ---
interface AnthropicAPIErrorDetail {
  type: string; // e.g., 'invalid_request_error'
  message: string;
}

interface AnthropicRequestMessage { // For the messages array sent to Anthropic
  role: 'user' | 'assistant';
  content: string; 
  // Anthropic can also take a list of content blocks, e.g., for images, 
  // but for now, we are focusing on text.
  // content: string | Array<{ type: 'text'; text: string } | { type: 'image'; source: { type: 'base64'; media_type: string; data: string }}>;
}

interface AnthropicTextBlock {
  type: 'text';
  text: string;
}

interface AnthropicMessageResponse {
  id: string;
  type: 'message';
  role: 'assistant'; // Anthropic API always responds with assistant role for messages
  content: AnthropicTextBlock[]; // Expecting an array of content blocks, primarily text for now
  model: string;
  stop_reason: string | null; // e.g., 'end_turn', 'max_tokens', 'stop_sequence'
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

// --- Anthropic Specific ---

export interface AnthropicConfig extends LLMConfig {
  modelName: string; // e.g., 'claude-3-opus-20240229', 'claude-2.1'
  apiKey: string;
  maxTokens?: number; // Anthropic calls this max_tokens_to_sample, maps to 'max_tokens' in their API v1
  temperature?: number; // Range: 0.0 to 1.0, default is 1.0
  topP?: number; // top_p sampling
  // topK?: number; // top_k sampling
  // stopSequences?: string[];
  // stream?: boolean; // For future streaming support
  // anthropicVersion?: string; // e.g., "2023-06-01"
}

// --- General LLM Provider Configuration Union ---
export type LLMProviderConfig = OpenAIConfig | AnthropicConfig; // Add other configs here later

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

// Custom Error for Anthropic API issues
export class AnthropicError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public errorType?: string, // e.g., 'authentication_error', 'invalid_request_error', 'api_error'
    public originalError?: unknown,
  ) {
    super(message);
    this.name = 'AnthropicError';
    Object.setPrototypeOf(this, AnthropicError.prototype);
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

        const data = await response.json() as { choices?: { message: ChatMessage }[] };
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

// Factory function for creating an Anthropic ChatLLM client object
export function createAnthropicChatClient(config: AnthropicConfig): ChatLLM<AnthropicConfig> {
  if (!config.apiKey) {
    console.warn(
      'Anthropic API key not provided in config. Using simulated responses.'
    );
  }
  if (!config.modelName) {
    throw new AnthropicError('Anthropic modelName is required.');
  }

  const ANTHROPIC_API_VERSION = '2023-06-01'; // Common version, can be updated/made configurable
  const effectiveBaseURL = 'https://api.anthropic.com/v1'; // Anthropic API base URL

  return {
    id: `anthropic-${config.modelName}-${config.temperature ?? 'default'}-${config.maxTokens ?? 'default'}`,
    providerName: 'anthropic',
    config,
    async invoke(prompt: string): Promise<ChatMessage> {
      return this.chat([{ role: 'user', content: prompt }]);
    },
    async chat(messages: ChatMessage[]): Promise<ChatMessage> {
      if (!config.apiKey) { // Fallback to simulation if no API key
        console.log(
          `SIMULATING Anthropic API call to model '${config.modelName}'. Messages:`, messages
        );
        const lastUserMessage = messages.filter(m => m.role === 'user').pop();
        return {
          role: 'assistant',
          content: `Mocked Anthropic response for model '${config.modelName}' to: ${lastUserMessage?.content ?? 'last user message'}`,
        };
      }

      // Prepare messages and system prompt for Anthropic format
      let systemPrompt: string | undefined;
      const anthropicMessages: AnthropicRequestMessage[] = [];

      messages.forEach((msg, index) => {
        if (msg.role === 'system') {
          if (index === 0) { // Anthropic only supports a single system prompt before messages
            systemPrompt = msg.content;
          } else {
            console.warn('Anthropic API only supports a single system message at the beginning. Subsequent system messages will be ignored or might cause errors.');
            // Or convert to user/assistant message if appropriate, for now, ignoring subsequent ones.
          }
        } else if (msg.role === 'user' || msg.role === 'assistant') {
          anthropicMessages.push({ role: msg.role, content: msg.content });
        } else {
          // For tool/function roles, Anthropic might have specific ways or they might be converted.
          // For now, let's log a warning and convert to a user message with a note.
          console.warn(`Anthropic client converting message role '${msg.role}' to 'user' with role information in content.`);
          anthropicMessages.push({ 
            role: 'user', 
            content: `(Original role: ${msg.role}${msg.name ? `, name: ${msg.name}` : ''}) ${msg.content}` 
          });
        }
      });

      if (anthropicMessages.length === 0 && systemPrompt) {
        // Anthropic requires at least one message if a system prompt is provided.
        // This scenario (system prompt only) might not be directly useful in typical chat, but handling it.
        anthropicMessages.push({role: 'user', content: 'Please proceed based on the system instructions.'});
      }
      if (anthropicMessages.length === 0 && !systemPrompt) {
        throw new AnthropicError('No messages provided to Anthropic chat method.');
      }

      const body: Record<string, unknown> = {
        model: config.modelName,
        messages: anthropicMessages,
        max_tokens: config.maxTokens ?? 2048, // Anthropic requires max_tokens
      };

      if (systemPrompt) {
        body.system = systemPrompt;
      }
      if (config.temperature !== undefined) body.temperature = config.temperature;
      if (config.topP !== undefined) body.top_p = config.topP;
      // Add other Anthropic-specific parameters like top_k, stop_sequences as needed from config

      try {
        const response = await fetch(`${effectiveBaseURL}/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': config.apiKey,
            'anthropic-version': ANTHROPIC_API_VERSION,
          },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          let errorData: { error?: AnthropicAPIErrorDetail } | undefined;
          let errorText = `HTTP error ${response.status} ${response.statusText || ''}`.trim();
          try {
            const clonedResponse = response.clone();
            errorData = await clonedResponse.json() as { error?: AnthropicAPIErrorDetail };
            if (errorData?.error?.message) {
              errorText = errorData.error.message;
            }
          } catch (jsonError) {
            try {
              const rawErrorBody = await response.text();
              errorText = rawErrorBody || errorText;
            } catch (textError) { /* ignore */ }
          }
          throw new AnthropicError(
            `Anthropic API error: ${response.status} ${response.statusText || ''} - ${errorText}`.trim(),
            response.status,
            errorData?.error?.type || 'api_error',
          );
        }

        const data = await response.json() as AnthropicMessageResponse;

        if (data && data.content && Array.isArray(data.content) && data.content.length > 0 && data.content[0]?.type === 'text') {
          return {
            role: 'assistant', // Anthropic responses are always 'assistant' role
            content: data.content[0].text,
          };
        } else { 
          throw new AnthropicError(
            'Anthropic API returned an unexpected response structure. No valid text content found.',
            response.status,
            'api_structure_error'
          );
        }
      } catch (e) {
        if (e instanceof AnthropicError) {
          throw e;
        }
        const networkError = e instanceof Error ? e : new Error(String(e));
        throw new AnthropicError(`Network request failed while communicating with Anthropic API: ${networkError.message}`, undefined, 'network_error', networkError);
      }
    },
  };
}

// --- Type Guards for LLM Provider Configs ---
export function isOpenAIConfig(config: LLMProviderConfig): config is OpenAIConfig {
  // OpenAI models often start with 'gpt-' and they might have unique fields like 'presencePenalty'
  // A more robust check might involve looking for specific fields not present in AnthropicConfig
  // or relying on a 'provider' field if added to configs.
  return 'apiKey' in config && 'modelName' in config && 
         (config.modelName.startsWith('gpt-') || typeof (config as OpenAIConfig).presencePenalty !== 'undefined' || typeof (config as OpenAIConfig).frequencyPenalty !== 'undefined');
}

export function isAnthropicConfig(config: LLMProviderConfig): config is AnthropicConfig {
  // Anthropic models often start with 'claude-' and they have an apiKey.
  // We also ensure it's not identifiable as OpenAIConfig by checking for absence of OpenAI-specific fields
  // if modelName alone isn't definitive (though it usually is).
  return 'apiKey' in config && 'modelName' in config && 
         config.modelName.startsWith('claude-') && 
         typeof (config as OpenAIConfig).presencePenalty === 'undefined' && 
         typeof (config as OpenAIConfig).frequencyPenalty === 'undefined';
}

// Placeholder for a generic LLM creator (e.g., for local models via Ollama)
// export interface OllamaConfig extends LLMConfig { endpoint: string; modelName: string; }
// export function createOllamaClient(config: OllamaConfig): ChatLLM<OllamaConfig> { ... }
