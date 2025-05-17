import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Task, type TaskConfig } from './index';
import { Agent, type AgentConfig } from '../agents';

// Minimal mock for Agent to be used in Task tests
const mockAgentExecuteTask = vi.fn();
class MockAgent extends Agent {
  override async executeTask(taskDescription: string, context?: string): Promise<string> {
    mockAgentExecuteTask(taskDescription, context);
    return `Mock result for: ${taskDescription}`;
  }
}

describe('Task', () => {
  const testAgentConfig: AgentConfig = {
    role: 'Test Agent',
    goal: 'Test Goal',
    backstory: 'Test Backstory',
  };
  const testAgent = new MockAgent(testAgentConfig);

  beforeEach(() => {
    mockAgentExecuteTask.mockClear();
  });

  it('should create a task with provided values', () => {
    const taskConfig: TaskConfig = {
      description: 'Test task description',
      expectedOutput: 'Test expected output',
      agent: testAgent,
      context: 'Test context',
      asyncExecution: true,
    };
    const task = new Task(taskConfig);

    expect(task.description).toBe('Test task description');
    expect(task.expectedOutput).toBe('Test expected output');
    expect(task.agent).toBe(testAgent);
    expect(task.context).toBe('Test context');
    expect(task.asyncExecution).toBe(true);
    expect(task.isCompleted()).toBe(false);
    expect(task.output).toBeUndefined();
  });

  it('should create a task with default values for optional fields', () => {
    const taskConfig: TaskConfig = {
      description: 'Simple task',
      expectedOutput: 'Simple output',
    };
    const task = new Task(taskConfig);

    expect(task.agent).toBeUndefined();
    expect(task.context).toBeUndefined();
    expect(task.asyncExecution).toBe(false);
  });

  it('should execute the task using the assigned agent', async () => {
    const taskConfig: TaskConfig = {
      description: 'Perform an action',
      expectedOutput: 'Action performed successfully',
      agent: testAgent,
      context: 'Initial data for action',
    };
    const task = new Task(taskConfig);

    const result = await task.execute();

    expect(result).toBe('Mock result for: Perform an action');
    expect(task.isCompleted()).toBe(true);
    expect(task.output).toBe('Mock result for: Perform an action');
    expect(mockAgentExecuteTask).toHaveBeenCalledOnce();
    expect(mockAgentExecuteTask).toHaveBeenCalledWith(
      'Perform an action',
      'Initial data for action',
    );
  });

  it('should execute the task using an overridden agent if provided', async () => {
    const taskConfig: TaskConfig = {
      description: 'Another action',
      expectedOutput: 'Another successful action',
      // No agent assigned initially
    };
    const task = new Task(taskConfig);

    const overrideAgentConfig: AgentConfig = {
      role: 'Override Agent',
      goal: 'Override Goal',
      backstory: 'Override Backstory',
    };
    const overrideAgent = new MockAgent(overrideAgentConfig);

    const result = await task.execute(overrideAgent);

    expect(result).toBe('Mock result for: Another action');
    expect(task.isCompleted()).toBe(true);
    expect(task.output).toBe('Mock result for: Another action');
    expect(mockAgentExecuteTask).toHaveBeenCalledOnce();
    expect(mockAgentExecuteTask).toHaveBeenCalledWith('Another action', undefined);
  });

  it('should throw an error if no agent is assigned and no override is provided during execution', async () => {
    const taskConfig: TaskConfig = {
      description: 'Task requiring agent',
      expectedOutput: 'Some output',
    };
    const task = new Task(taskConfig);

    await expect(task.execute()).rejects.toThrow(
      "Task 'Task requiring agent' has no agent assigned and no agent was provided for execution.",
    );
    expect(task.isCompleted()).toBe(false);
  });
}); 