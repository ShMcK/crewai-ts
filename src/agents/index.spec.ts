import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createAgent, performAgentTask, type AgentConfig, type Agent } from './index';
import type { ChatLLM, ChatMessage, OpenAIConfig } from '../llms';
import type { Tool, ToolContext } from '../tools';

describe('Agent Creation', () => {
  it('should create an agent with default values', () => {
    const config: AgentConfig = {
      role: 'Test Role',
      goal: 'Test Goal',
      backstory: 'Test Backstory',
    };
    const agent: Agent = createAgent(config);

    expect(agent.id).toBeTypeOf('string');
    expect(agent.config.role).toBe('Test Role');
    expect(agent.config.goal).toBe('Test Goal');
    expect(agent.config.backstory).toBe('Test Backstory');
    expect(agent.memory).toBe(false);
    expect(agent.history).toBeUndefined(); // Check history for default (memory false)
    expect(agent.tools).toEqual([]);
    expect(agent.allowDelegation).toBe(false);
    expect(agent.verbose).toBe(false);
    expect(agent.maxIter).toBe(25);
    expect(agent.llm).toBeUndefined();
  });

  it('should create an agent with provided values, including memory and history', () => {
    const tool: Tool<unknown, unknown> = {
      name: 'Test Tool',
      description: 'A tool for testing',
      execute: async (input: unknown, _context?: ToolContext) => `Tool output for ${String(input)}`,
    };
    const llmConfig = { modelName: 'test-llm', apiKey: 'test-key' } as OpenAIConfig;
    const config: AgentConfig = {
      role: 'Advanced Tester',
      goal: 'Thoroughly test everything',
      backstory: 'Born from a test case',
      llm: llmConfig,
      memory: true,
      tools: [tool],
      allowDelegation: true,
      verbose: true,
      maxIter: 100,
    };
    const agent: Agent = createAgent(config);

    expect(agent.id).toBeTypeOf('string');
    expect(agent.config.role).toBe('Advanced Tester');
    expect(agent.config.goal).toBe('Thoroughly test everything');
    expect(agent.config.backstory).toBe('Born from a test case');
    
    expect(agent.llm).toBeDefined();
    expect(agent.llm?.providerName).toBe('openai');
    if (agent.llm) {
      expect(agent.llm.config.modelName).toBe('test-llm');
    }

    expect(agent.memory).toBe(true);
    expect(agent.history).toBeDefined(); // Check history is initialized for memory:true
    expect(agent.history).toEqual([]);   // Should be an empty array
    expect(agent.tools).toEqual([tool]);
    expect(agent.allowDelegation).toBe(true);
    expect(agent.verbose).toBe(true);
    expect(agent.maxIter).toBe(100);
  });
});

describe('performAgentTask with Memory', () => {
  let mockLLM: ChatLLM;
  let agentConfigWithMemory: AgentConfig;

  beforeEach(() => {
    mockLLM = {
      id: 'mock-memory-llm',
      providerName: 'mock-provider',
      config: { modelName: 'test-memory-model' } as OpenAIConfig,
      chat: vi.fn(async (messages: ChatMessage[]) => {
        const lastMessage = messages[messages.length - 1];
        return { role: 'assistant', content: `LLM processed: ${lastMessage.content.slice(-50)}` } as ChatMessage;
      }),
      invoke: vi.fn(async (prompt: string) => {
        return { role: 'assistant', content: `LLM processed: ${prompt.slice(-50)}` } as ChatMessage;
      }),
    };

    agentConfigWithMemory = {
      role: 'Memory Tester',
      goal: 'Test memory functionality',
      backstory: 'Remembers everything told.',
      llm: mockLLM,
      memory: true,
      verbose: false,
    };
  });

  it('should initialize history for an agent with memory: true', () => {
    const agent = createAgent(agentConfigWithMemory);
    expect(agent.memory).toBe(true);
    expect(agent.history).toBeDefined();
    expect(agent.history).toEqual([]);
  });

  it('should not initialize history for an agent with memory: false', () => {
    const agentNoMemoryConfig = { ...agentConfigWithMemory, memory: false };
    const agentNoMemory = createAgent(agentNoMemoryConfig);
    expect(agentNoMemory.memory).toBe(false);
    expect(agentNoMemory.history).toBeUndefined();
  });

  it('should add interaction to history and use history in subsequent prompts', async () => {
    const agent = createAgent(agentConfigWithMemory);

    const task1Desc = 'What is the capital of France?';
    const task1Context = 'Geography question.';
    const response1 = await performAgentTask(agent, task1Desc, task1Context);

    expect(agent.history).toHaveLength(2);
    expect(agent.history?.[0]).toEqual({ role: 'user', content: `Task: ${task1Desc}\nContext for task: ${task1Context}` });
    expect(agent.history?.[1]).toEqual({ role: 'assistant', content: response1 });

    // Verify LLM call for task 1 (no prior history in prompt text itself, but mockLLM.chat receives full prompt)
    const firstCallChatMock = mockLLM.chat as vi.Mock;
    expect(firstCallChatMock).toHaveBeenCalledTimes(1);
    const firstCallMessages = firstCallChatMock.mock.calls[0][0] as ChatMessage[];
    const firstPromptContent = firstCallMessages[0].content;
    // The constructed prompt in performAgentTask won't have "user: ..." for the first message if history is empty.
    expect(firstPromptContent).not.toMatch(/^user:/); // Check it doesn't start with "user:" from history formatting
    expect(firstPromptContent).toContain(task1Desc);


    const task2Desc = 'And its population?';
    const response2 = await performAgentTask(agent, task2Desc);

    expect(agent.history).toHaveLength(4);
    expect(agent.history?.[2]).toEqual({ role: 'user', content: `Task: ${task2Desc}` });
    expect(agent.history?.[3]).toEqual({ role: 'assistant', content: response2 });

    // Verify LLM call for task 2 (should include history)
    const secondCallChatMock = mockLLM.chat as vi.Mock;
    expect(secondCallChatMock).toHaveBeenCalledTimes(2);
    const secondCallMessages = secondCallChatMock.mock.calls[1][0] as ChatMessage[];
    const secondPromptContent = secondCallMessages[0].content;

    // Check that the history string was prepended
    expect(secondPromptContent).toContain(`user: Task: ${task1Desc}\nContext for task: ${task1Context}`);
    expect(secondPromptContent).toContain(`assistant: ${response1}`);
    expect(secondPromptContent).toContain(`Task: ${task2Desc}`); // Current task
  });

  it('should not use or update history if memory is false', async () => {
    const agentNoMemoryConfig = { ...agentConfigWithMemory, memory: false, llm: mockLLM }; // Ensure LLM is passed
    const agentNoMemory = createAgent(agentNoMemoryConfig);

    expect(agentNoMemory.history).toBeUndefined();

    const taskDesc = 'Test task for no memory agent';
    await performAgentTask(agentNoMemory, taskDesc);

    expect(agentNoMemory.history).toBeUndefined(); // Still undefined

    const chatMock = mockLLM.chat as vi.Mock;
    expect(chatMock).toHaveBeenCalledTimes(1); // Called once for this agent
    const promptContent = (chatMock.mock.calls[0][0] as ChatMessage[])[0].content;
    expect(promptContent).not.toMatch(/^user:/); // Should not start with history formatting
    expect(promptContent).toContain(taskDesc);
  });
}); 