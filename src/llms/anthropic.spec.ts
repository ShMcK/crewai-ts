import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createAnthropicChatClient,
  type AnthropicConfig,
  type ChatMessage,
  AnthropicError,
  isAnthropicConfig, // For testing the type guard itself, if desired
  isOpenAIConfig,    // For completeness in testing type guards
  type LLMProviderConfig // Added LLMProviderConfig import
} from './index';

// Mock the global fetch function
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('Anthropic LLM Client', () => {
  describe('AnthropicError Class', () => {
    it('should correctly initialize properties', () => {
      const originalError = new Error('original anthropic issue');
      const error = new AnthropicError('Test Anthropic message', 400, 'test_type', originalError);
      expect(error.message).toBe('Test Anthropic message');
      expect(error.name).toBe('AnthropicError');
      expect(error.statusCode).toBe(400);
      expect(error.errorType).toBe('test_type');
      expect(error.originalError).toBe(originalError);
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(AnthropicError);
    });
  });

  describe('createAnthropicChatClient Factory', () => {
    const minimalConfig: AnthropicConfig = {
      apiKey: 'test-anthropic-api-key',
      modelName: 'claude-test-model',
    };

    beforeEach(() => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(console, 'log').mockImplementation(() => {}); // For simulation logs
    });

    afterEach(() => {
      vi.restoreAllMocks(); // Restores console spies
      mockFetch.mockClear();
    });

    it('should create an Anthropic client with valid config', () => {
      const client = createAnthropicChatClient(minimalConfig);
      expect(client).toBeDefined();
      expect(client.providerName).toBe('anthropic');
      expect(client.config).toEqual(minimalConfig);
      expect(client.id).toContain('anthropic-claude-test-model');
    });

    it('should throw AnthropicError if modelName is missing', () => {
      const config = { apiKey: 'test-key' } as AnthropicConfig;
      expect(() => createAnthropicChatClient(config)).toThrow(AnthropicError);
      expect(() => createAnthropicChatClient(config)).toThrow(
        'Anthropic modelName is required.',
      );
    });

    it('should warn and prepare for simulation if apiKey is missing', () => {
      const config = { modelName: 'claude-sim-model' } as AnthropicConfig;
      const client = createAnthropicChatClient(config); // apiKey is undefined
      expect(console.warn).toHaveBeenCalledWith(
        'Anthropic API key not provided in config. Using simulated responses.',
      );
      expect(client.config.apiKey).toBeUndefined();
      // Further tests for simulation behavior will be in 'chat method' tests
    });

    // Basic tests for invoke and chat method existence. Detailed tests will follow.
    it('should have an invoke method', () => {
      const client = createAnthropicChatClient(minimalConfig);
      expect(client.invoke).toBeTypeOf('function');
    });

    it('should have a chat method', () => {
      const client = createAnthropicChatClient(minimalConfig);
      expect(client.chat).toBeTypeOf('function');
    });
  });

  // Placeholder for type guard tests if needed, though their primary testing is implicit
  // via createAgent/createCrew and the LLM client factory tests.
  describe('LLM Config Type Guards (Informational)', () => {
    it('isAnthropicConfig should identify Anthropic config', () => {
      const anthropicConf: AnthropicConfig = { apiKey: 'key', modelName: 'claude-1' };
      expect(isAnthropicConfig(anthropicConf)).toBe(true);
      expect(isOpenAIConfig(anthropicConf)).toBe(false);
    });

    it('isOpenAIConfig should identify OpenAI config', () => {
      // Construct an object that would be identified as OpenAIConfig by our type guard
      const openaiConf: { apiKey: string; modelName: string; presencePenalty?: number; frequencyPenalty?: number } = { 
        apiKey: 'key', 
        modelName: 'gpt-4', 
        presencePenalty: 0 
      };
      expect(isOpenAIConfig(openaiConf as LLMProviderConfig)).toBe(true); 
      expect(isAnthropicConfig(openaiConf as LLMProviderConfig)).toBe(false);
    });
  });

  describe('AnthropicChatClient chat method', () => {
    const defaultAnthropicConfig: AnthropicConfig = {
      apiKey: 'test-anthropic-api-key',
      modelName: 'claude-test-model',
      temperature: 0.6,
      maxTokens: 150,
      topP: 0.8,
    };
    const client = createAnthropicChatClient(defaultAnthropicConfig);
    const testMessages: ChatMessage[] = [{ role: 'user', content: 'Hello Anthropic' }];
    const ANTHROPIC_API_VERSION = '2023-06-01'; // Matching the one in client

    beforeEach(() => {
      mockFetch.mockClear();
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
      // This will restore all mocks, including console spies set in beforeEach
      vi.restoreAllMocks(); 
    });

    it('should make a successful API call with correct parameters', async () => {
      const mockApiResponseText = 'Hello from mocked Anthropic!';
      const mockApiResponse = {
        id: 'msg_test123',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: mockApiResponseText }],
        model: defaultAnthropicConfig.modelName,
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 20 },
      };

      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify(mockApiResponse), { status: 200 })
      );

      const response = await client.chat(testMessages);

      expect(response).toEqual({ role: 'assistant', content: mockApiResponseText });
      expect(mockFetch).toHaveBeenCalledOnce();
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.anthropic.com/v1/messages',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': defaultAnthropicConfig.apiKey,
            'anthropic-version': ANTHROPIC_API_VERSION,
          },
          body: JSON.stringify({
            model: defaultAnthropicConfig.modelName,
            messages: testMessages.map(m => ({role: m.role, content: m.content})), // Basic mapping for this test
            max_tokens: defaultAnthropicConfig.maxTokens,
            temperature: defaultAnthropicConfig.temperature,
            top_p: defaultAnthropicConfig.topP,
          }),
        }
      );
    });

    it('should handle system prompt correctly', async () => {
      const systemMessage: ChatMessage = { role: 'system', content: 'You are a helpful AI.' };
      const userMessage: ChatMessage = { role: 'user', content: 'What is AI?' };
      const messagesWithSystem: ChatMessage[] = [systemMessage, userMessage];
      
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({
          id: 'msg_sys_test', type: 'message', role: 'assistant', 
          content: [{ type: 'text', text: 'AI is complex.' }],
          model: defaultAnthropicConfig.modelName, stop_reason: 'end_turn', stop_sequence: null,
          usage: { input_tokens: 15, output_tokens: 5 }
        }), { status: 200 })
      );

      await client.chat(messagesWithSystem);

      expect(mockFetch).toHaveBeenCalledOnce();
      const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body as string);
      expect(fetchBody.system).toBe(systemMessage.content);
      expect(fetchBody.messages).toEqual([{ role: userMessage.role, content: userMessage.content }]);
    });

    it('should convert and warn for non-user/assistant/system message roles', async () => {
      const toolMessage: ChatMessage = { role: 'tool', content: 'Tool output here', name: 'calculator' };
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({
          id: 'msg_tool_test', type: 'message', role: 'assistant', 
          content: [{ type: 'text', text: 'Understood tool output.' }],
          model: defaultAnthropicConfig.modelName, stop_reason: 'end_turn', stop_sequence: null,
          usage: { input_tokens: 20, output_tokens: 8 }
        }), { status: 200 })
      );
      
      await client.chat([toolMessage]);

      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("Anthropic client converting message role 'tool' to 'user'"));
      const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body as string);
      expect(fetchBody.messages[0].role).toBe('user');
      expect(fetchBody.messages[0].content).toContain('(Original role: tool, name: calculator)');
      expect(fetchBody.messages[0].content).toContain('Tool output here');
    });

    it('should use simulation if apiKey is not provided in config', async () => {
      const clientWithoutKey = createAnthropicChatClient({
        modelName: 'claude-sim-only-model',
      } as AnthropicConfig);
      const response = await clientWithoutKey.chat(testMessages);

      expect(mockFetch).not.toHaveBeenCalled();
      expect(response.role).toBe('assistant');
      expect(response.content).toContain('Mocked Anthropic response');
      expect(response.content).toContain('claude-sim-only-model');
      expect(response.content).toContain(testMessages[0].content);
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('SIMULATING Anthropic API call'),
        expect.anything(), // messages
      );
    });

    it('should throw AnthropicError for API error (e.g., 401 Unauthorized)', async () => {
      const errorDetail = { type: 'authentication_error', message: 'Invalid API key' };
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: errorDetail }), {
          status: 401,
          statusText: 'Unauthorized',
        }),
      );
      try {
        await client.chat(testMessages);
        throw new Error('Test failed: Expected client.chat to throw an error');
      } catch (e) {
        const err = e as AnthropicError;
        expect(err).toBeInstanceOf(AnthropicError);
        expect(err.message).toBe(
          `Anthropic API error: 401 Unauthorized - ${errorDetail.message}`,
        );
        expect(err.statusCode).toBe(401);
        expect(err.errorType).toBe(errorDetail.type);
      }
    });

    it('should throw AnthropicError for API error with non-JSON body', async () => {
      const rawErrorText = 'Forbidden by policy.';
      mockFetch.mockResolvedValueOnce(
        new Response(rawErrorText, {
          status: 403,
          statusText: 'Forbidden',
        }),
      );
      try {
        await client.chat(testMessages);
        throw new Error('Test failed: Expected client.chat to throw an error');
      } catch (e) {
        const err = e as AnthropicError;
        expect(err).toBeInstanceOf(AnthropicError);
        expect(err.message).toBe(
          `Anthropic API error: 403 Forbidden - ${rawErrorText}`,
        );
        expect(err.statusCode).toBe(403);
      }
    });

    it('should throw AnthropicError for network errors (fetch fails)', async () => {
      const networkErrorMessage = 'Network connection failed';
      mockFetch.mockRejectedValueOnce(new TypeError(networkErrorMessage));
      try {
        await client.chat(testMessages);
        throw new Error('Test failed: Expected client.chat to throw an error');
      } catch (e) {
        const err = e as AnthropicError;
        expect(err).toBeInstanceOf(AnthropicError);
        expect(err.message).toBe(
          `Network request failed while communicating with Anthropic API: ${networkErrorMessage}`
        );
        expect(err.statusCode).toBeUndefined();
        expect(err.errorType).toBe('network_error');
      }
    });

    it('should throw AnthropicError for unexpected response structure', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'msg_bad', content: [{type: 'image_proxy'}] }), { status: 200 }), // No text content
      );
      try {
        await client.chat(testMessages);
        throw new Error('Test failed: Expected client.chat to throw an error');
      } catch (e) {
        const err = e as AnthropicError;
        expect(err).toBeInstanceOf(AnthropicError);
        expect(err.message).toBe(
          'Anthropic API returned an unexpected response structure. No valid text content found.'
        );
        expect(err.statusCode).toBe(200);
        expect(err.errorType).toBe('api_structure_error');
      }
    });

    it('should throw AnthropicError if no messages are provided', async () => {
      await expect(client.chat([])).rejects.toThrow(AnthropicError);
      await expect(client.chat([])).rejects.toThrow('No messages provided to Anthropic chat method.');
    });
  });

  // More describe blocks will be added here for:
  // - AnthropicChatClient invoke method
}); 