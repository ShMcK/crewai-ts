import { describe, it, expect } from 'vitest';
import { Agent, type AgentConfig } from './index';

describe('Agent', () => {
  it('should create an agent with default values', () => {
    const config: AgentConfig = {
      role: 'Test Role',
      goal: 'Test Goal',
      backstory: 'Test Backstory',
    };
    const agent = new Agent(config);

    expect(agent.role).toBe('Test Role');
    expect(agent.goal).toBe('Test Goal');
    expect(agent.backstory).toBe('Test Backstory');
    expect(agent.memory).toBe(false);
    expect(agent.tools).toEqual([]);
    expect(agent.allowDelegation).toBe(false);
    expect(agent.verbose).toBe(false);
    expect(agent.maxIter).toBe(25);
  });

  it('should create an agent with provided values', () => {
    const tool = {
      name: 'Test Tool',
      description: 'A tool for testing',
      // biome-ignore lint/suspicious/noExplicitAny: Placeholder for tool input type in test
      run: async (input: any) => `Tool output for ${input}`,
    };
    const config: AgentConfig = {
      role: 'Advanced Tester',
      goal: 'Thoroughly test everything',
      backstory: 'Born from a test case',
      llm: { provider: 'test-llm' }, // Placeholder LLM config
      memory: true,
      tools: [tool],
      allowDelegation: true,
      verbose: true,
      maxIter: 100,
    };
    const agent = new Agent(config);

    expect(agent.role).toBe('Advanced Tester');
    expect(agent.goal).toBe('Thoroughly test everything');
    expect(agent.backstory).toBe('Born from a test case');
    expect(agent.llm).toEqual({ provider: 'test-llm' });
    expect(agent.memory).toBe(true);
    expect(agent.tools).toEqual([tool]);
    expect(agent.allowDelegation).toBe(true);
    expect(agent.verbose).toBe(true);
    expect(agent.maxIter).toBe(100);
  });
}); 