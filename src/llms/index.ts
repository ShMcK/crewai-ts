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
  modelName?: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  apiKey?: string; // Common, but some LLMs might have other auth methods
  // biome-ignore lint/suspicious/noExplicitAny: Allows for provider-specific untyped options
  [key: string]: any; // Allow provider-specific options
}

/**
 * Basic interface for a generic Language Model.
 */
export interface LLM<TConfig extends LLMConfig = LLMConfig, TResponse = string> {
  readonly id: string; // Unique ID for this LLM instance/configuration
  readonly config: TConfig;
  readonly providerName: string; // e.g., "openai", "ollama", "custom"
  invoke: (prompt: string) => Promise<TResponse>;
  // Potentially a method to get model information or capabilities
  // getModelInfo?: () => Promise<object>;
}

/**
 * Interface for a Language Model that supports chat-based interactions.
 */
export interface ChatLLM<TConfig extends LLMConfig = LLMConfig, TResponse = ChatMessage> extends LLM<TConfig, TResponse> {
  chat: (messages: ChatMessage[]) => Promise<TResponse>; // TResponse typically a ChatMessage from assistant
  // Override invoke if its behavior differs significantly for chat models or remove if chat is the only mode
  // invoke: (prompt: string | ChatMessage[]) => Promise<TResponse>;
}

// Example: Placeholder for a specific LLM client (e.g., OpenAI)
// We won't implement this fully now, just define the structure.

export interface OpenAIConfig extends LLMConfig {
  modelName: string; // e.g., 'gpt-3.5-turbo', 'gpt-4'
  apiKey: string;
  // other OpenAI specific params like organization, baseURL, etc.
}

// Factory function for creating an OpenAI ChatLLM client object
export function createOpenAIChatClient(config: OpenAIConfig): ChatLLM<OpenAIConfig> {
  if (!config.apiKey) {
    throw new Error('OpenAI API key is required for createOpenAIChatClient.');
  }
  if (!config.modelName) {
    throw new Error('OpenAI modelName is required for createOpenAIChatClient.');
  }

  // In a real implementation, you might initialize the OpenAI SDK here
  // const openai = new OpenAI({ apiKey: config.apiKey, ... });

  return {
    id: `openai-${config.modelName}-${config.temperature ?? 0.7}-${config.maxTokens ?? 2048}`,
    providerName: 'openai',
    config,
    async invoke(prompt: string): Promise<ChatMessage> {
      // This would typically wrap a call to the chat method for OpenAI
      return this.chat([{ role: 'user', content: prompt }]);
    },
    async chat(messages: ChatMessage[]): Promise<ChatMessage> {
      console.log(
        `Simulating OpenAI API call to model '${config.modelName}'. Messages:`, messages
      );
      // --- Actual fetch/API call to OpenAI would go here ---
      // Example structure (requires an async HTTP client like fetch):
      /*
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({ model: config.modelName, messages, temperature: config.temperature, max_tokens: config.maxTokens }),
      });
      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`OpenAI API error: ${response.status} ${response.statusText} - ${errorBody}`);
      }
      const data = await response.json();
      if (!data.choices || data.choices.length === 0 || !data.choices[0].message) {
        throw new Error('OpenAI API returned an unexpected response structure.');
      }
      return data.choices[0].message as ChatMessage;
      */
      // --- End of actual API call block ---

      // Placeholder response for simulation
      const lastUserMessage = messages.filter(m => m.role === 'user').pop();
      return {
        role: 'assistant',
        content: `Mocked OpenAI response for model '${config.modelName}' to: ${lastUserMessage?.content ?? 'last user message'}`,
      };
    },
  };
}

// Placeholder for a generic LLM creator (e.g., for local models via Ollama)
// export interface OllamaConfig extends LLMConfig { endpoint: string; modelName: string; }
// export function createOllamaClient(config: OllamaConfig): ChatLLM<OllamaConfig> { ... }
