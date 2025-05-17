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
  config: TConfig;
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
  // other OpenAI specific params
}

// Placeholder - actual implementation would involve API calls
export class OpenAIChatModel implements ChatLLM<OpenAIConfig> {
  config: OpenAIConfig;

  constructor(config: OpenAIConfig) {
    if (!config.apiKey) throw new Error('OpenAI API key is required.');
    this.config = config;
  }

  async invoke(prompt: string): Promise<ChatMessage> {
    // This would typically wrap a call to the chat method for OpenAI
    return this.chat([{ role: 'user', content: prompt }]);
  }

  async chat(messages: ChatMessage[]): Promise<ChatMessage> {
    console.log(`Simulating OpenAI API call with model ${this.config.modelName} and messages:`, messages);
    const lastUserMessage = messages.filter(m => m.role === 'user').pop();
    return {
      role: 'assistant',
      content: `Mocked response for: ${lastUserMessage?.content ?? 'last user message'}`,
    };
  }
}
