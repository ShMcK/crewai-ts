import { describe, it, expect, vi, beforeEach, type MockedFunction, type Mock } from 'vitest';
import {
  createTask,
  executeTask,
  type Task,
  type TaskConfig,
  isTaskCompleted,
  TaskStatus,
  // Import other status helpers if needed: hasTaskFailed, isTaskPending, isTaskInProgress
} from './index';
import {
  createAgent,
  type Agent,
  type AgentConfig,
  performAgentTask, // We will mock this
} from '../agents';
import { z } from 'zod'; // Import Zod
import * as fs from 'node:fs'; // Import fs for mocking
import * as path from 'node:path'; // Import path for mocking (though less direct mocking needed)

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

// Mock fs module
vi.mock('node:fs');

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
      task.status = TaskStatus.COMPLETED; // Manually set as completed
      task.output = 'Already done';

      await executeTask(task, testAgent);

      expect(mockedPerformAgentTask).not.toHaveBeenCalled();
      expect(task.output).toBe('Already done'); // Should remain unchanged
      expect(task.logs.some(log => log.includes('Task execution skipped'))).toBe(true);
    });

    it('should skip execution if task is in_progress and not async', async () => {
      const taskConfig: TaskConfig = { description: 'Test', expectedOutput: 'Test', asyncExecution: false }; // Not async
      const task = createTask(taskConfig);
      task.status = TaskStatus.IN_PROGRESS; // Manually set as in_progress
      
      await executeTask(task, testAgent);

      expect(mockedPerformAgentTask).not.toHaveBeenCalled();
      expect(task.logs.some(log => log.includes('Task execution skipped'))).toBe(true);
    });

    it('should re-execute if task is in_progress and async', async () => {
      const taskConfig: TaskConfig = { description: 'Test Async', expectedOutput: 'Test', asyncExecution: true }; // Async
      const task = createTask(taskConfig);
      task.status = TaskStatus.IN_PROGRESS; // Manually set as in_progress
      
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

      expect(task.status).toBe(TaskStatus.COMPLETED);
      expect(task.output).toEqual(mockLLMOutput);
      expect(task.parsedOutput).toEqual(mockLLMOutput); // Successfully parsed
      expect(task.validationError).toBeNull();
      expect(task.logs.some(log => log.includes('Output successfully parsed and validated against schema'))).toBe(true);
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

      expect(task.status).toBe(TaskStatus.COMPLETED); // Task execution is complete, even if validation fails
      expect(task.output).toEqual(mockLLMOutput);    // Raw output
      expect(task.parsedOutput).toBeNull();
      expect(task.validationError).toBeInstanceOf(z.ZodError);
      expect(task.validationError?.errors[0]?.message).toBe('Required'); // Example check for Zod error content
      expect(task.logs.some(log => log.includes('Output parsing/validation failed'))).toBe(true);
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

      expect(task.status).toBe(TaskStatus.COMPLETED);
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

      expect(task.status).toBe(TaskStatus.FAILED);
      expect(task.output).toBeNull();
      expect(task.parsedOutput).toBeNull();
      expect(task.validationError).toBeNull();
    });
  });

  describe('executeTask - outputFile functionality', () => {
    const mockOutputDir = './test_outputs';
    const baseOutputFilePath = `${mockOutputDir}/output.json`;

    beforeEach(() => {
      // Reset mocks for fs before each test in this block
      vi.resetAllMocks(); // This will also reset performAgentTask, so re-mock it if general tests need it.
                          // For this specific block, we might re-mock performAgentTask for clarity.

      // Default mock implementation for performAgentTask needed again due to vi.resetAllMocks()
      mockedPerformAgentTask.mockImplementation(async (agent, taskDescription) => {
        return `Mocked LLM response for: ${taskDescription} by ${agent.config.role}`;
      });

      // Setup fs mocks
      (fs.writeFileSync as Mock).mockClear();
      (fs.existsSync as Mock).mockClear().mockReturnValue(true); // Assume dir exists by default
      (fs.mkdirSync as Mock).mockClear();
    });

    it('should write parsedOutput to outputFile if schema matches and outputFile is set', async () => {
      const schema = z.object({ data: z.string(), count: z.number() });
      const taskConfig: TaskConfig = {
        description: 'Save parsed output',
        expectedOutput: 'Parsed data saved',
        outputSchema: schema,
        outputFile: baseOutputFilePath,
      };
      const task = createTask(taskConfig);
      const mockLLMOutput = { data: "parsed success", count: 101 };
      mockedPerformAgentTask.mockResolvedValueOnce(mockLLMOutput);

      await executeTask(task, testAgent);

      expect(fs.writeFileSync).toHaveBeenCalledOnce();
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        path.resolve(baseOutputFilePath),
        JSON.stringify(mockLLMOutput, null, 2)
      );
      expect(task.logs.some(log => log.includes(`Task output saved to ${path.resolve(baseOutputFilePath)}`))).toBe(true);
    });

    it('should write raw output to outputFile if schema mismatches and outputFile is set', async () => {
      const schema = z.object({ message: z.string() });
      const taskConfig: TaskConfig = {
        description: 'Save raw output on schema mismatch',
        expectedOutput: 'Raw data saved',
        outputSchema: schema,
        outputFile: baseOutputFilePath,
      };
      const task = createTask(taskConfig);
      const mockLLMOutput = { unexpected: "mismatch data", value: 999 }; // Mismatched output
      mockedPerformAgentTask.mockResolvedValueOnce(mockLLMOutput);

      await executeTask(task, testAgent);

      expect(fs.writeFileSync).toHaveBeenCalledOnce();
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        path.resolve(baseOutputFilePath),
        JSON.stringify(mockLLMOutput, null, 2) // Should save the raw output
      );
      expect(task.logs.some(log => log.includes(`Task output saved to ${path.resolve(baseOutputFilePath)}`))).toBe(true);
    });

    it('should write raw output to outputFile if no schema is provided and outputFile is set', async () => {
      const taskConfig: TaskConfig = {
        description: 'Save raw output no schema',
        expectedOutput: 'Raw data saved',
        outputFile: baseOutputFilePath,
      };
      const task = createTask(taskConfig);
      const mockLLMOutput = "Simple string output for file";
      mockedPerformAgentTask.mockResolvedValueOnce(mockLLMOutput);

      await executeTask(task, testAgent);

      expect(fs.writeFileSync).toHaveBeenCalledOnce();
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        path.resolve(baseOutputFilePath),
        JSON.stringify(mockLLMOutput, null, 2)
      );
    });

    it('should not write to file if outputFile is not set', async () => {
      const taskConfig: TaskConfig = {
        description: 'No file output',
        expectedOutput: 'Just console',
        // No outputFile
      };
      const task = createTask(taskConfig);
      mockedPerformAgentTask.mockResolvedValueOnce("Some output");

      await executeTask(task, testAgent);

      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it('should create directory if it does not exist', async () => {
      (fs.existsSync as Mock).mockReturnValue(false); // Simulate directory does not exist
      const taskConfig: TaskConfig = {
        description: 'Create dir then save',
        expectedOutput: 'Saved after dir creation',
        outputFile: baseOutputFilePath,
      };
      const task = createTask(taskConfig);
      mockedPerformAgentTask.mockResolvedValueOnce("data to save");

      await executeTask(task, testAgent);

      expect(fs.mkdirSync).toHaveBeenCalledOnce();
      expect(fs.mkdirSync).toHaveBeenCalledWith(path.dirname(path.resolve(baseOutputFilePath)), { recursive: true });
      expect(fs.writeFileSync).toHaveBeenCalledOnce(); // Still should write the file
    });

    it('should log warning and not fail task if file writing fails', async () => {
      const fileErrorMessage = "Disk full simulation";
      (fs.writeFileSync as Mock).mockImplementation(() => {
        throw new Error(fileErrorMessage);
      });
      const taskConfig: TaskConfig = {
        description: 'File write failure test',
        expectedOutput: 'Task completes, file fails',
        outputFile: baseOutputFilePath,
      };
      const task = createTask(taskConfig);
      mockedPerformAgentTask.mockResolvedValueOnce("some crucial output");

      // Spy on console.warn for this test
      const consoleWarnSpy = vi.spyOn(console, 'warn');

      await executeTask(task, testAgent);

      expect(task.status).toBe(TaskStatus.COMPLETED); // Task itself should complete
      expect(task.output).toBe("some crucial output");
      expect(task.logs.some(log => log.includes(`Failed to save task output to ${baseOutputFilePath}. Error: ${fileErrorMessage}`))).toBe(true);
      expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining(`Failed to save task output for "${taskConfig.description}"`));
      expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining(fileErrorMessage));

      consoleWarnSpy.mockRestore(); // Clean up spy
    });
  });
}); 