import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createOpenAIChatClient,
  type OpenAIConfig,
  type ChatMessage,
  OpenAIError,
} from './index';

// Mock the global fetch function
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('LLM System', () => {
  describe('createOpenAIChatClient', () => {
    const minimalConfig: OpenAIConfig = {
      apiKey: 'test-api-key',
      modelName: 'gpt-test-model',
    };

    beforeEach(() => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
      vi.restoreAllMocks();
      mockFetch.mockClear();
    });

    it('should create an OpenAI client with valid config', () => {
      const client = createOpenAIChatClient(minimalConfig);
      expect(client).toBeDefined();
      expect(client.providerName).toBe('openai');
      expect(client.config).toEqual(minimalConfig);
      expect(client.id).toContain('openai-gpt-test-model');
    });

    it('should throw OpenAIError if modelName is missing', () => {
      const config = { apiKey: 'test-key' } as OpenAIConfig;
      expect(() => createOpenAIChatClient(config)).toThrow(OpenAIError);
      expect(() => createOpenAIChatClient(config)).toThrow(
        'OpenAI modelName is required.',
      );
    });

    it('should warn and prepare for simulation if apiKey is missing', () => {
      const config = { modelName: 'gpt-test-model' } as OpenAIConfig;
      const client = createOpenAIChatClient(config);
      expect(console.warn).toHaveBeenCalledWith(
        'OpenAI API key not provided in config. Using simulated responses.',
      );
      expect(client.config.apiKey).toBeUndefined();
    });

    it('should use custom baseURL if provided', async () => {
      const configWithBaseURL: OpenAIConfig = {
        ...minimalConfig,
        baseURL: 'https://custom.api.openai.com/v1',
      };
      const client = createOpenAIChatClient(configWithBaseURL);
      // Test via a chat call to see if the URL is used (mockFetch will capture it)
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { role: 'assistant', content: 'Hello' } }],
          }),
          { status: 200 },
        ),
      );
      await client.chat([{ role: 'user', content: 'Hi' }]);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://custom.api.openai.com/v1/chat/completions',
        expect.anything(),
      );
    });
  });

  describe('OpenAIChatClient chat method', () => {
    const defaultConfig: OpenAIConfig = {
      apiKey: 'test-api-key',
      modelName: 'gpt-test-model',
      temperature: 0.5,
      maxTokens: 100,
      topP: 0.9,
      presencePenalty: 0.1,
      frequencyPenalty: 0.2,
    };
    const client = createOpenAIChatClient(defaultConfig);
    const testMessages: ChatMessage[] = [{ role: 'user', content: 'Hello OpenAI' }];

    beforeEach(() => {
      mockFetch.mockClear();
      vi.spyOn(console, 'log').mockImplementation(() => {}); // Suppress simulation logs
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should make a successful API call with correct parameters', async () => {
      const mockResponse: ChatMessage = {
        role: 'assistant',
        content: 'Hello from mocked OpenAI!',
      };
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ choices: [{ message: mockResponse }] }), {
          status: 200,
        }),
      );

      const response = await client.chat(testMessages);

      expect(response).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledOnce();
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.openai.com/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${defaultConfig.apiKey}`,
          },
          body: JSON.stringify({
            model: defaultConfig.modelName,
            messages: testMessages,
            temperature: defaultConfig.temperature,
            top_p: defaultConfig.topP,
            max_tokens: defaultConfig.maxTokens,
            presence_penalty: defaultConfig.presencePenalty,
            frequency_penalty: defaultConfig.frequencyPenalty,
          }),
        },
      );
    });

    it('should use simulation if apiKey is not provided in config', async () => {
      const clientWithoutKey = createOpenAIChatClient({
        modelName: 'gpt-sim-model',
      } as OpenAIConfig);
      const response = await clientWithoutKey.chat(testMessages);

      expect(mockFetch).not.toHaveBeenCalled();
      expect(response.role).toBe('assistant');
      expect(response.content).toContain('Mocked OpenAI response');
      expect(response.content).toContain('gpt-sim-model');
      expect(response.content).toContain('Hello OpenAI');
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('SIMULATING OpenAI API call'),
        expect.anything(), // messages
      );
    });

    it('should throw OpenAIError for API error (e.g., 401 Unauthorized)', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'Invalid API key' } }), {
          status: 401,
          statusText: 'Unauthorized',
        }),
      );
      try {
        await client.chat(testMessages);
      } catch (e) {
        expect(e).toBeInstanceOf(OpenAIError);
        expect((e as OpenAIError).message).toBe(
          'OpenAI API error: 401 Unauthorized - Invalid API key',
        );
        expect((e as OpenAIError).statusCode).toBe(401);
      }
    });

    it('should throw OpenAIError for API error with non-JSON body', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('Forbidden. Rate limit exceeded.', {
          status: 403,
          statusText: 'Forbidden',
        }),
      );
      try {
        await client.chat(testMessages);
      } catch (e) {
        expect(e).toBeInstanceOf(OpenAIError);
        expect((e as OpenAIError).message).toBe(
          'OpenAI API error: 403 Forbidden - Forbidden. Rate limit exceeded.',
        );
        expect((e as OpenAIError).statusCode).toBe(403);
      }
    });

    it('should throw OpenAIError for network errors (fetch fails)', async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('Network request failed'));
      try {
        await client.chat(testMessages);
      } catch (e) {
        expect(e).toBeInstanceOf(OpenAIError);
        expect((e as OpenAIError).message).toBe(
          'Network request failed while communicating with OpenAI API: Network request failed'
        );
        expect((e as OpenAIError).statusCode).toBeUndefined();
        expect((e as OpenAIError).errorType).toBe('network_error');
      }
    });

    it('should throw OpenAIError for unexpected response structure', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({}), { status: 200 }), // Empty response
      );
      try {
        await client.chat(testMessages);
      } catch (e) {
        expect(e).toBeInstanceOf(OpenAIError);
        expect((e as OpenAIError).message).toBe(
          'OpenAI API returned an unexpected response structure. No choices found or choices array is empty.'
        );
        expect((e as OpenAIError).statusCode).toBe(200);
      }
    });
  });

  describe('OpenAIChatClient invoke method', () => {
    const defaultConfig: OpenAIConfig = {
      apiKey: 'test-api-key',
      modelName: 'gpt-test-model',
    };
    const client = createOpenAIChatClient(defaultConfig);

    it('should call the chat method with a single user message', async () => {
      const chatSpy = vi.spyOn(client, 'chat');
      const mockResponse: ChatMessage = {
        role: 'assistant',
        content: 'Invoked response',
      };
      chatSpy.mockResolvedValueOnce(mockResponse);

      const prompt = 'Test prompt for invoke';
      const response = await client.invoke(prompt);

      expect(response).toEqual(mockResponse);
      expect(chatSpy).toHaveBeenCalledOnce();
      expect(chatSpy).toHaveBeenCalledWith([{ role: 'user', content: prompt }]);
      chatSpy.mockRestore();
    });
  });

  describe('OpenAIError', () => {
    it('should correctly initialize properties', () => {
      const originalError = new Error('original');
      const error = new OpenAIError('Test message', 400, 'test_type', originalError);
      expect(error.message).toBe('Test message');
      expect(error.name).toBe('OpenAIError');
      expect(error.statusCode).toBe(400);
      expect(error.errorType).toBe('test_type');
      expect(error.originalError).toBe(originalError);
      expect(error).toBeInstanceOf(Error); // Check prototype chain
      expect(error).toBeInstanceOf(OpenAIError);
    });
  });
}); 