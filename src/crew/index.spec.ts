import { beforeEach, describe, expect, it, vi, type Mock, type MockedFunction } from 'vitest';
import { CrewProcess } from '../core';
import { createCrew, runCrew } from './index'; // Assuming named exports
import type { Crew, CrewConfig } from './index';
import type { Agent, AgentConfig } from '../agents';
import { createAgent } from '../agents'; // Assuming factory function
import type { Task, TaskConfig } from '../tasks';
import { createTask, executeTask as originalExecuteTask } from '../tasks'; // Assuming factory and executeTask

// Mock the executeTask function from src/tasks
vi.mock('../tasks', async (importOriginal) => {
  const original = await importOriginal<typeof import('../tasks')>();
  return {
    ...original,
    executeTask: vi.fn().mockImplementation(async (task: Task, _agent: Agent) => {
      // Simulate task execution: set output and status
      task.output = `Output from task: ${task.config.description}`;
      task.status = 'completed';
      task.logs.push(`Mock execution log for ${task.config.description}`);
      task.completedAt = new Date();
    }),
    // Ensure createTask is still available if not mocked
    createTask: original.createTask,
  };
});

// After vi.mock, executeTask is now the mocked version
const mockedExecuteTask = originalExecuteTask as MockedFunction<typeof originalExecuteTask>;

// Mock the sendTelemetry function (if it were exported and you wanted to spy on it)
// For now, it's an internal function, so we test its effects via console logs if verbose or by assuming it's called.

describe('Crew', () => {
  let mockAgent1: Agent;
  let mockAgent2: Agent;
  let task1Config: TaskConfig;
  let task2Config: TaskConfig;

  beforeEach(() => {
    vi.clearAllMocks(); // Clear mocks before each test
    mockedExecuteTask.mockClear(); // Clear the specific mock

    // Create mock agents using the factory
    const agentConfig1: AgentConfig = {
      role: 'Test Agent 1',
      goal: 'Goal 1',
      backstory: 'Backstory 1',
      // llm: {} as any, // Add a placeholder or mock LLM if createAgent requires it
    };
    mockAgent1 = createAgent(agentConfig1);

    const agentConfig2: AgentConfig = {
      role: 'Test Agent 2',
      goal: 'Goal 2',
      backstory: 'Backstory 2',
      // llm: {} as any,
    };
    mockAgent2 = createAgent(agentConfig2);

    // Define task configurations
    task1Config = {
      description: 'Test Task 1',
      expectedOutput: 'Output 1',
      agent: mockAgent1, // Assign agent directly
    };
    task2Config = {
      description: 'Test Task 2',
      expectedOutput: 'Output 2',
      agent: mockAgent2,
    };

    // Spy on console methods if verbose mode is tested
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  describe('createCrew', () => {
    it('should create a crew with default sequential process', () => {
      const task1 = createTask(task1Config);
      const crewConfig: CrewConfig = {
        agents: [mockAgent1],
        tasks: [task1],
      };
      const crew = createCrew(crewConfig);

      expect(crew.id).toBeTypeOf('string');
      expect(crew.config.agents).toEqual([mockAgent1]);
      expect(crew.config.tasks).toEqual([task1]);
      expect(crew.config.process).toBe(CrewProcess.SEQUENTIAL);
      expect(crew.config.verbose).toBe(false);
      expect(crew.status).toBe('PENDING');
      expect(crew.output).toBeNull();
      expect(crew.tasksOutput).toBeInstanceOf(Map);
      expect(crew.tasksOutput.size).toBe(0);
      expect(crew.createdAt).toBeInstanceOf(Date);
      expect(crew.updatedAt).toBeInstanceOf(Date);
    });

    it('should create a crew with specified hierarchical process and verbosity', () => {
      const task1 = createTask(task1Config);
      const crewConfig: CrewConfig = {
        agents: [mockAgent1],
        tasks: [task1],
        process: CrewProcess.HIERARCHICAL,
        verbose: true,
      };
      const crew = createCrew(crewConfig);

      expect(crew.config.process).toBe(CrewProcess.HIERARCHICAL);
      expect(crew.config.verbose).toBe(true);
    });

    it('should throw an error if no agents are provided', () => {
      const task1 = createTask(task1Config);
      const crewConfig: CrewConfig = {
        agents: [],
        tasks: [task1],
      };
      expect(() => createCrew(crewConfig)).toThrow(
        'Crew creation failed: No agents provided.',
      );
    });

    it('should throw an error if no tasks are provided', () => {
      const crewConfig: CrewConfig = {
        agents: [mockAgent1],
        tasks: [],
      };
      expect(() => createCrew(crewConfig)).toThrow(
        'Crew creation failed: No tasks provided.',
      );
    });

    it('should throw error if task agent is not in crew agents list', () => {
      const independentAgent = createAgent({ role: 'Independent', goal: 'g', backstory: 'b' });
      const taskWithOtherAgent = createTask({
        description: 'Task with other agent',
        expectedOutput: 'any',
        agent: independentAgent,
      });
      const crewConfig: CrewConfig = {
        agents: [mockAgent1], // mockAgent1 is different from independentAgent
        tasks: [taskWithOtherAgent],
      };
      expect(() => createCrew(crewConfig)).toThrow(
        `Task "Task with other agent" is configured with an agent (ID: ${independentAgent.id}, Role: Independent) that is not part of the provided crew agents list.`
      );
    });
     it('should allow tasks without pre-assigned agents if crew has agents', () => {
      const taskWithoutAgent = createTask({
        description: 'Task without agent',
        expectedOutput: 'any',
      }); // No agent assigned here
      const crewConfig: CrewConfig = {
        agents: [mockAgent1],
        tasks: [taskWithoutAgent],
      };
      // Expect no error during creation
      expect(() => createCrew(crewConfig)).not.toThrow();
      const crew = createCrew(crewConfig);
      expect(crew.config.tasks[0].config.agent).toBeUndefined();
    });
  });

  describe('runCrew', () => {
    it('should execute tasks sequentially and update crew status', async () => {
      const task1 = createTask(task1Config);
      const task2 = createTask(task2Config);
      const crewConfig: CrewConfig = {
        agents: [mockAgent1, mockAgent2],
        tasks: [task1, task2],
      };
      const crew = createCrew(crewConfig);

      await runCrew(crew);

      expect(mockedExecuteTask).toHaveBeenCalledTimes(2);
      expect(mockedExecuteTask).toHaveBeenCalledWith(task1, mockAgent1);
      expect(mockedExecuteTask).toHaveBeenCalledWith(task2, mockAgent2);

      expect(crew.status).toBe('COMPLETED');
      expect(crew.output).toBe(`Output from task: ${task2.config.description}`); // Last task output
      expect(crew.tasksOutput.get(task1.id)?.output).toBe(
        `Output from task: ${task1.config.description}`,
      );
      expect(crew.tasksOutput.get(task2.id)?.output).toBe(
        `Output from task: ${task2.config.description}`,
      );
      expect(crew.startedAt).toBeInstanceOf(Date);
      expect(crew.completedAt).toBeInstanceOf(Date);
      expect(crew.updatedAt).greaterThanOrEqual(crew.createdAt);
    });

    it('should use first crew agent if task has no agent (sequential)', async () => {
      const taskNoAgent = createTask({ description: 'Task with no agent', expectedOutput: 'exp' });
      const crewConfig: CrewConfig = {
        agents: [mockAgent1, mockAgent2],
        tasks: [taskNoAgent],
      };
      const crew = createCrew(crewConfig);
      await runCrew(crew);
      expect(mockedExecuteTask).toHaveBeenCalledWith(taskNoAgent, mockAgent1); // Should use mockAgent1
      expect(crew.status).toBe('COMPLETED');
    });
    
    it('should execute tasks using hierarchical fallback (sequential) and update crew status', async () => {
      const task1 = createTask(task1Config); // Agent is mockAgent1
      const task2 = createTask(task2Config); // Agent is mockAgent2
      const crewConfig: CrewConfig = {
        agents: [mockAgent1, mockAgent2],
        tasks: [task1, task2],
        process: CrewProcess.HIERARCHICAL, // Set to hierarchical
        verbose: true,
      };
      const crew = createCrew(crewConfig);

      await runCrew(crew);

      expect(mockedExecuteTask).toHaveBeenCalledTimes(2);
      expect(mockedExecuteTask).toHaveBeenCalledWith(task1, mockAgent1);
      expect(mockedExecuteTask).toHaveBeenCalledWith(task2, mockAgent2);
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('[Crew AI] Hierarchical process is not yet implemented'));
      expect(crew.status).toBe('COMPLETED');
    });

    it('should use first crew agent if task has no agent (hierarchical fallback)', async () => {
      const taskNoAgent = createTask({ description: 'Task with no agent hierarchical', expectedOutput: 'exp' });
      const crewConfig: CrewConfig = {
        agents: [mockAgent1, mockAgent2],
        tasks: [taskNoAgent],
        process: CrewProcess.HIERARCHICAL,
      };
      const crew = createCrew(crewConfig);
      await runCrew(crew);
      expect(mockedExecuteTask).toHaveBeenCalledWith(taskNoAgent, mockAgent1); // Should use mockAgent1
      expect(crew.status).toBe('COMPLETED');
    });

    it('should handle task execution failure and set crew status to FAILED', async () => {
      mockedExecuteTask.mockImplementationOnce(async (task: Task) => {
         task.output = `Output from task: ${task.config.description}`;
         task.status = 'completed';
      });
      mockedExecuteTask.mockImplementationOnce(async (task: Task) => {
        task.status = 'failed';
        task.error = 'Simulated task error';
        task.completedAt = new Date();
        throw new Error('Simulated task error');
      });

      const task1 = createTask(task1Config);
      const task2 = createTask(task2Config);
      const crewConfig: CrewConfig = {
        agents: [mockAgent1, mockAgent2],
        tasks: [task1, task2],
      };
      const crew = createCrew(crewConfig);

      await runCrew(crew);

      expect(crew.status).toBe('FAILED');
      expect(crew.output).toEqual({ error: 'Simulated task error' });
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining(`Crew ${crew.id} failed:`), expect.any(Error));
      expect(crew.completedAt).toBeInstanceOf(Date);
    });

    it('should not run if crew is already RUNNING', async () => {
      const task1 = createTask(task1Config);
      const crewConfig: CrewConfig = { agents: [mockAgent1], tasks: [task1] };
      const crew = createCrew(crewConfig);
      crew.status = 'RUNNING'; // Manually set status

      await runCrew(crew);
      expect(mockedExecuteTask).not.toHaveBeenCalled();
      expect(console.warn).toHaveBeenCalledWith(`Crew ${crew.id} is already running.`);
    });

    it('should not run if crew is already COMPLETED', async () => {
      const task1 = createTask(task1Config);
      const crewConfig: CrewConfig = { agents: [mockAgent1], tasks: [task1] };
      const crew = createCrew(crewConfig);
      crew.status = 'COMPLETED'; // Manually set status

      await runCrew(crew);
      expect(mockedExecuteTask).not.toHaveBeenCalled();
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('has already finished'));
    });
    
    it('should log verbose output if verbose is true', async () => {
      const task1 = createTask(task1Config);
      const crewConfig: CrewConfig = {
        agents: [mockAgent1],
        tasks: [task1],
        verbose: true,
      };
      const crew = createCrew(crewConfig);

      await runCrew(crew);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('[Crew AI] Working Agent Assistants'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Agents:'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining(`  - ${mockAgent1.config.role}`));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Tasks:'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining(`  - ${task1.config.description}`));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('[Crew AI] Beginning Sequential Process...'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining(`Executing task: ${task1.config.description}`));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining(`Task Output: Output from task: ${task1.config.description}`));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('[Crew AI] Crew Execution Complete.'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Final Output:'));
    });

     it('should throw error from createCrew if crew has no agents when task has no agent', () => {
      const taskWithoutAgent = createTask({ description: 'Task without agent', expectedOutput: 'exp' });
      const crewConfig: CrewConfig = {
        agents: [], // NO AGENTS IN CREW
        tasks: [taskWithoutAgent],
      };
      // This scenario is caught by createCrew
       expect(() => createCrew(crewConfig)).toThrow('Crew creation failed: No agents provided.');
    });
  });
}); 