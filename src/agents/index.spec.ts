import { describe, it, expect } from 'vitest';
import { createAgent, type AgentConfig, type Agent } from './index';

describe('Agent', () => {
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
    expect(agent.tools).toEqual([]);
    expect(agent.allowDelegation).toBe(false);
    expect(agent.verbose).toBe(false);
    expect(agent.maxIter).toBe(25);
    expect(agent.llm).toBeUndefined();
  });

  it('should create an agent with provided values', () => {
    const tool = {
      name: 'Test Tool',
      description: 'A tool for testing',
      // biome-ignore lint/suspicious/noExplicitAny: Placeholder for tool input type in test
      execute: async (input: any) => `Tool output for ${input}`,
    };
    const llmConfig = { modelName: 'test-llm', apiKey: 'test-key' };
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
    expect(agent.tools).toEqual([tool]);
    expect(agent.allowDelegation).toBe(true);
    expect(agent.verbose).toBe(true);
    expect(agent.maxIter).toBe(100);
  });
}); 