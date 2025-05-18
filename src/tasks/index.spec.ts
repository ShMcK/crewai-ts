import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';
import {
  createTask,
  executeTask,
  type Task,
  type TaskConfig,
  isTaskCompleted,
  // Import other status helpers if needed: hasTaskFailed, isTaskPending, isTaskInProgress
} from './index';
import {
  createAgent,
  type Agent,
  type AgentConfig,
  performAgentTask, // We will mock this
} from '../agents';
import { z } from 'zod'; // Import Zod

// Mock performAgentTask from src/agents
vi.mock('../agents', async (importOriginal) => {
  const originalAgents = await importOriginal<typeof import('../agents')>();
  return {
    ...originalAgents,
    performAgentTask: vi.fn(), // Mock the specific function
  };
});

// Cast the mocked function for type safety and easier mockImplementation access
const mockedPerformAgentTask = performAgentTask as MockedFunction<
  (agent: Agent, taskDescription: string, context?: string | undefined) => Promise<unknown>
>;

describe('Task System', () => {
  let testAgent: Agent;
  const testAgentConfig: AgentConfig = {
    role: 'Test Agent',
    goal: 'Test Goal',
    backstory: 'Test Backstory',
  };

  beforeEach(() => {
    mockedPerformAgentTask.mockClear();
    // Default mock implementation for performAgentTask
    mockedPerformAgentTask.mockImplementation(async (agent, taskDescription) => {
      return `Mocked LLM response for: ${taskDescription} by ${agent.config.role}`;
    });
    testAgent = createAgent(testAgentConfig); // Create a fresh agent for each test
  });

  describe('createTask', () => {
    it('should create a task with provided values and default status', () => {
      const taskConfig: TaskConfig = {
        description: 'Test task description',
        expectedOutput: 'Test expected output',
        agent: testAgent,
        context: 'Test context',
        asyncExecution: true,
      };
      const task = createTask(taskConfig);

      expect(task.id).toBeTypeOf('string');
      expect(task.config).toEqual(taskConfig);
      expect(task.status).toBe('pending');
      expect(task.output).toBeNull();
      expect(task.error).toBeNull();
      expect(task.logs).toEqual([]);
      expect(task.startedAt).toBeUndefined();
      expect(task.completedAt).toBeUndefined();
      expect(task.parsedOutput).toBeNull();
      expect(task.validationError).toBeNull();
    });

    it('should create a task with default values for optional config fields', () => {
      const taskConfig: TaskConfig = {
        description: 'Simple task',
        expectedOutput: 'Simple output',
      };
      const task = createTask(taskConfig);

      expect(task.config.agent).toBeUndefined();
      expect(task.config.context).toBeUndefined();
      expect(task.config.asyncExecution).toBeUndefined(); // Or false, depending on createTasks defaulting
                                                          // Current createTask doesn't default it in the object itself, relies on consumer.
                                                          // executeTask handles its own async logic based on this not being set.
    });

    it('should create a task with an outputSchema if provided', () => {
      const schema = z.object({ name: z.string(), value: z.number() });
      const taskConfig: TaskConfig = {
        description: 'Schema task',
        expectedOutput: 'Structured output',
        outputSchema: schema,
      };
      const task = createTask(taskConfig);
      expect(task.config.outputSchema).toBe(schema);
      expect(task.parsedOutput).toBeNull(); // Initialized to null
      expect(task.validationError).toBeNull(); // Initialized to null
    });
  });

  describe('executeTask', () => {
    it('should execute the task, update status, output, logs, and timestamps', async () => {
      const taskConfig: TaskConfig = {
        description: 'Perform an action',
        expectedOutput: 'Action performed successfully',
        context: 'Initial data for action',
      };
      const task = createTask(taskConfig);

      await executeTask(task, testAgent);

      expect(mockedPerformAgentTask).toHaveBeenCalledOnce();
      expect(mockedPerformAgentTask).toHaveBeenCalledWith(
        testAgent,
        'Perform an action',
        'Initial data for action',
      );

      expect(task.status).toBe('completed');
      expect(task.output).toBe(
        'Mocked LLM response for: Perform an action by Test Agent',
      );
      expect(isTaskCompleted(task)).toBe(true);
      expect(task.logs.length).toBeGreaterThanOrEqual(2); // Start and end logs
      expect(task.logs[0]).toContain('Task starting');
      expect(task.logs[task.logs.length -1]).toContain('Task completed');
      expect(task.startedAt).toBeInstanceOf(Date);
      expect(task.completedAt).toBeInstanceOf(Date);
      expect(task.error).toBeNull();
    });

    it('should use the provided agent for execution', async () => {
      const taskConfig: TaskConfig = {
        description: 'Another action',
        expectedOutput: 'Another successful action',
      };
      const task = createTask(taskConfig);
      const overrideAgent = createAgent({role: "Override", goal: "g", backstory: "b"});

      mockedPerformAgentTask.mockImplementationOnce(async (agent, taskDesc) => 
        `Response from ${agent.config.role} for ${taskDesc}`
      );

      await executeTask(task, overrideAgent);

      expect(mockedPerformAgentTask).toHaveBeenCalledWith(
        overrideAgent,
        'Another action',
        undefined, // context
      );
      expect(task.output).toBe('Response from Override for Another action');
      expect(task.status).toBe('completed');
    });

    it('should handle errors from performAgentTask and update task status', async () => {
      const taskConfig: TaskConfig = {
        description: 'Problematic task',
        expectedOutput: 'Should not see this',
      };
      const task = createTask(taskConfig);

      const errorMessage = 'LLM simulation failed!';
      mockedPerformAgentTask.mockRejectedValueOnce(new Error(errorMessage));

      await expect(executeTask(task, testAgent)).rejects.toThrow(errorMessage);

      expect(task.status).toBe('failed');
      expect(task.error).toBe(errorMessage);
      expect(task.output).toBeNull();
      expect(task.logs.length).toBeGreaterThanOrEqual(2);
      expect(task.logs[task.logs.length -1]).toContain('Task failed');
      expect(task.completedAt).toBeInstanceOf(Date);
    });

    it('should skip execution if task is already completed', async () => {
      const taskConfig: TaskConfig = { description: 'Test', expectedOutput: 'Test' };
      const task = createTask(taskConfig);
      task.status = 'completed'; // Manually set as completed
      task.output = 'Already done';

      await executeTask(task, testAgent);

      expect(mockedPerformAgentTask).not.toHaveBeenCalled();
      expect(task.output).toBe('Already done'); // Should remain unchanged
      expect(task.logs.some(log => log.includes('Task execution skipped'))).toBe(true);
    });

    it('should skip execution if task is in_progress and not async', async () => {
      const taskConfig: TaskConfig = { description: 'Test', expectedOutput: 'Test', asyncExecution: false }; // Not async
      const task = createTask(taskConfig);
      task.status = 'in_progress'; // Manually set as in_progress
      
      await executeTask(task, testAgent);

      expect(mockedPerformAgentTask).not.toHaveBeenCalled();
      expect(task.logs.some(log => log.includes('Task execution skipped'))).toBe(true);
    });

    it('should re-execute if task is in_progress and async', async () => {
      const taskConfig: TaskConfig = { description: 'Test Async', expectedOutput: 'Test', asyncExecution: true }; // Async
      const task = createTask(taskConfig);
      task.status = 'in_progress'; // Manually set as in_progress
      
      await executeTask(task, testAgent);
      expect(mockedPerformAgentTask).toHaveBeenCalledOnce(); // Should execute
      expect(task.status).toBe('completed');
    });

    it('should successfully parse output if schema matches and store in parsedOutput', async () => {
      const schema = z.object({ detail: z.string(), count: z.number() });
      const taskConfig: TaskConfig = {
        description: 'Parseable task',
        expectedOutput: 'Parsed data',
        outputSchema: schema,
      };
      const task = createTask(taskConfig);
      const mockLLMOutput = { detail: "Valid data", count: 123 };
      mockedPerformAgentTask.mockResolvedValueOnce(mockLLMOutput);

      await executeTask(task, testAgent);

      expect(task.status).toBe('completed');
      expect(task.output).toEqual(mockLLMOutput);
      expect(task.parsedOutput).toEqual(mockLLMOutput); // Successfully parsed
      expect(task.validationError).toBeNull();
      expect(task.logs.some(log => log.includes('Task output successfully validated'))).toBe(true);
    });

    it('should store validationError and keep raw output if schema mismatches', async () => {
      const schema = z.object({ message: z.string() });
      const taskConfig: TaskConfig = {
        description: 'Mismatch task',
        expectedOutput: 'Raw data despite error',
        outputSchema: schema,
      };
      const task = createTask(taskConfig);
      const mockLLMOutput = { wrongField: "Invalid data", numberValue: 456 }; // Mismatched output
      mockedPerformAgentTask.mockResolvedValueOnce(mockLLMOutput);

      await executeTask(task, testAgent);

      expect(task.status).toBe('completed'); // Still completed as per current design
      expect(task.output).toEqual(mockLLMOutput);
      expect(task.parsedOutput).toBeNull(); // Parsing failed
      expect(task.validationError).toBeInstanceOf(z.ZodError);
      expect(task.validationError?.errors[0]?.message).toBe('Required'); // Example check for Zod error details
      expect(task.logs.some(log => log.includes('Task output validation failed'))).toBe(true);
    });

    it('should not attempt parsing and parsedOutput should be null if no schema is provided', async () => {
      const taskConfig: TaskConfig = {
        description: 'No schema task',
        expectedOutput: 'Raw output only',
        // No outputSchema
      };
      const task = createTask(taskConfig);
      const mockLLMOutput = "Simple string output";
      mockedPerformAgentTask.mockResolvedValueOnce(mockLLMOutput);

      await executeTask(task, testAgent);

      expect(task.status).toBe('completed');
      expect(task.output).toBe(mockLLMOutput);
      expect(task.parsedOutput).toBeNull();
      expect(task.validationError).toBeNull();
      expect(task.logs.some(log => log.includes('Task output successfully validated'))).toBe(false);
      expect(task.logs.some(log => log.includes('Task output validation failed'))).toBe(false);
    });

    it('should correctly set parsedOutput and validationError to null on execution error', async () => {
      const schema = z.object({ data: z.string() });
      const taskConfig: TaskConfig = {
        description: 'Task that fails execution',
        expectedOutput: 'N/A',
        outputSchema: schema,
      };
      const task = createTask(taskConfig);
      expect(task.parsedOutput).toBeNull();
      expect(task.validationError).toBeNull();

      mockedPerformAgentTask.mockRejectedValueOnce(new Error('Execution error'));

      await expect(executeTask(task, testAgent)).rejects.toThrow('Execution error');

      expect(task.status).toBe('failed');
      expect(task.output).toBeNull();
      expect(task.parsedOutput).toBeNull();
      expect(task.validationError).toBeNull();
    });
  });
}); 