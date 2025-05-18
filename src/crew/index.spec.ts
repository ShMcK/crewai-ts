import { beforeEach, describe, expect, it, vi, type Mock, type MockedFunction } from 'vitest';
import { CrewProcess } from '../core';
import { createCrew, runCrew } from './index'; // Assuming named exports
import type { Crew, CrewConfig, TaskOutputDetail } from './index';
import type { Agent, AgentConfig } from '../agents';
import { createAgent } from '../agents'; // Assuming factory function
import { createTask, executeTask as originalExecuteTask, TaskStatus } from '../tasks'; // Assuming factory and executeTask
import type { Task, TaskConfig } from '../tasks'; // Keep type imports separate if preferred or if other items are types only
import type { ChatLLM, OpenAIConfig } from '../llms'; // Import ChatLLM
import { performAgentTask as originalPerformAgentTask } from '../agents';
import type { Tool, ToolContext } from '../tools'; // Added ToolContext
import { z } from 'zod'; // Import Zod for schema definitions in tests

// Mock the executeTask function from src/tasks
vi.mock('../tasks', async (importOriginal) => {
  const originalModule = await importOriginal<typeof import('../tasks')>();
  return {
    ...originalModule,
    executeTask: vi.fn().mockImplementation(async (task: Task, agent: Agent) => {
      // Simulate getting raw output from an agent/LLM first
      // This part would normally be from performAgentTask, but executeTask calls it.
      // For crew tests, performAgentTask is often separately mocked for manager, 
      // but worker agents rely on executeTask's behavior.
      // Let's assume a simple scenario where the raw output can be predefined or derived for testing.
      let rawOutput: unknown = `Raw output for ${task.config.description}`;
      if (task.config.description.includes('structured')) {
        rawOutput = { data: 'some structured data', value: 123 };
      }
      if (task.config.description.includes('mismatched')) {
        rawOutput = { wrong: 'mismatched data', num: 456 };
      }
      if (task.config.description.includes('valid_user')) {
        rawOutput = { name: 'Test User', age: 30 };
      }
       if (task.config.description.includes('invalid_user')) {
        rawOutput = { name: 'Test User', age: 'thirty' }; // age should be number
      }

      task.output = rawOutput;

      if (task.config.outputSchema) {
        const parseResult = task.config.outputSchema.safeParse(rawOutput);
        if (parseResult.success) {
          task.parsedOutput = parseResult.data;
          task.validationError = null;
        } else {
          task.parsedOutput = null;
          task.validationError = parseResult.error;
        }
      }
      task.status = TaskStatus.COMPLETED;
      task.logs.push(`Mock execution log for ${task.config.description}. Parsed: ${!!task.parsedOutput}`);
      task.completedAt = new Date();
    }),
  };
});

// After vi.mock, executeTask is now the mocked version
const mockedExecuteTask = originalExecuteTask as MockedFunction<typeof originalExecuteTask>;

// Mock performAgentTask
vi.mock('../agents', async (importOriginal) => {
  const original = await importOriginal<typeof import('../agents')>();
  return {
    ...original,
    performAgentTask: vi.fn(), // Default mock
  };
});
const mockedPerformAgentTask = originalPerformAgentTask as MockedFunction<typeof originalPerformAgentTask>;

// Mock the sendTelemetry function (if it were exported and you wanted to spy on it)
// For now, it's an internal function, so we test its effects via console logs if verbose or by assuming it's called.

describe('Crew', () => {
  let mockAgent1: Agent;
  let mockAgent2: Agent;
  let task1Config: TaskConfig;
  let task2Config: TaskConfig;
  let mockManagerLlm: ChatLLM;

  beforeEach(() => {
    vi.clearAllMocks(); // Clear mocks before each test
    mockedExecuteTask.mockClear(); // Clear the specific mock
    mockedPerformAgentTask.mockClear();

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

    mockManagerLlm = {
      id: 'mock-manager-llm',
      providerName: 'mock-provider',
      config: { modelName: 'mock-manager-model' } as OpenAIConfig, // or a generic LLMConfig
      chat: vi.fn(), // Default to a plain vi.fn(). Tests MUST provide specific implementations or mockResolvedValue sequences.
      invoke: vi.fn().mockResolvedValue({ role: 'assistant', content: 'mock invoke' }),
    };

    // Spy on console methods if verbose mode is tested
    vi.spyOn(console, 'log').mockImplementation(() => {}); // Re-enable the spy
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    mockedPerformAgentTask.mockClear(); // Clear this too
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
        managerLlm: mockManagerLlm, // Add mock manager LLM
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

    it('should create a crew with a specified objective', () => {
      const task1 = createTask(task1Config);
      const myObjective = "Achieve test greatness";
      const crewConfig: CrewConfig = {
        agents: [mockAgent1],
        tasks: [task1],
        objective: myObjective,
      };
      const crew = createCrew(crewConfig);
      expect(crew.config.objective).toBe(myObjective);
    });

    it('should create a crew without an objective (it is optional)', () => {
      const task1 = createTask(task1Config);
      const crewConfig: CrewConfig = {
        agents: [mockAgent1],
        tasks: [task1],
        // No objective here
      };
      const crew = createCrew(crewConfig);
      expect(crew.config.objective).toBeUndefined();
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
      expect(crew.output).toBe(`Raw output for ${task2.config.description}`);
      expect(crew.tasksOutput.get(task1.id)?.output).toBe(
        `Raw output for ${task1.config.description}`
      );
      expect(crew.tasksOutput.get(task2.id)?.output).toBe(
        `Raw output for ${task2.config.description}`
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
    
    it('should execute tasks using hierarchical process and update crew status', async () => {
      const task1 = createTask(task1Config); // Agent is mockAgent1
      const task2 = createTask(task2Config); // Agent is mockAgent2
      const crewConfig: CrewConfig = {
        agents: [mockAgent1, mockAgent2],
        tasks: [task1, task2],
        process: CrewProcess.HIERARCHICAL, 
        verbose: false, 
        managerLlm: mockManagerLlm, 
      };
      const crew = createCrew(crewConfig);
      const genericSummary = "Default summary for tests without specific summary content.";

      // Mock sequence for 2 tasks: Delegate T1, Delegate T2, then Summary Call
      (mockManagerLlm.chat as Mock)
        .mockReset()
        .mockResolvedValueOnce({ role: 'assistant', content: JSON.stringify({ taskIdToDelegate: task1.id, agentIdToAssign: mockAgent1.id }) })
        .mockResolvedValueOnce({ role: 'assistant', content: JSON.stringify({ taskIdToDelegate: task2.id, agentIdToAssign: mockAgent2.id }) })
        .mockResolvedValueOnce({ role: 'assistant', content: genericSummary }); // Summary call

      await runCrew(crew);

      expect(mockedExecuteTask).toHaveBeenCalledTimes(2);
      expect(mockedExecuteTask).toHaveBeenCalledWith(task1, mockAgent1);
      expect(mockedExecuteTask).toHaveBeenCalledWith(task2, mockAgent2);
      
      expect(mockManagerLlm.chat).toHaveBeenCalledTimes(3); // T1, T2, Summary
      expect(crew.status).toBe('COMPLETED'); 
      expect(crew.output).toBe(genericSummary);
    });

    it('should correctly delegate task without pre-assigned agent in hierarchical process', async () => {
      const taskNoAgent = createTask({ description: 'Task with no agent hierarchical', expectedOutput: 'exp' });
      const crewConfig: CrewConfig = {
        agents: [mockAgent1, mockAgent2],
        tasks: [taskNoAgent],
        process: CrewProcess.HIERARCHICAL,
        managerLlm: mockManagerLlm, 
        verbose: false,
      };
      const crew = createCrew(crewConfig);
      const genericSummary = "Default summary for single task test.";

      // Mock sequence for 1 task: Delegate Task, then Summary Call
      (mockManagerLlm.chat as Mock)
        .mockReset()
        .mockResolvedValueOnce({ role: 'assistant', content: JSON.stringify({ taskIdToDelegate: taskNoAgent.id, agentIdToAssign: mockAgent1.id }) }) // Manager chooses mockAgent1
        .mockResolvedValueOnce({ role: 'assistant', content: genericSummary }); // Summary call
      
      await runCrew(crew);
      
      expect(mockManagerLlm.chat).toHaveBeenCalledTimes(2); // Delegate, Summary
      expect(mockedExecuteTask).toHaveBeenCalledTimes(1);
      expect(mockedExecuteTask).toHaveBeenCalledWith(taskNoAgent, mockAgent1); 
      expect(crew.status).toBe('COMPLETED');
      expect(crew.output).toBe(genericSummary);
    });

    it('should handle task execution failure and set crew status to FAILED', async () => {
      mockedExecuteTask.mockImplementationOnce(async (task: Task) => {
         task.output = `Raw output for ${task.config.description}`;
         task.status = TaskStatus.COMPLETED;
         task.completedAt = new Date();
         if (task.config.outputSchema) { /* basic Zod handling if needed, or assume no schema */ }
      });
      mockedExecuteTask.mockImplementationOnce(async (task: Task) => {
        task.status = TaskStatus.FAILED;
        task.error = 'Simulated task error';
        task.completedAt = new Date();
        task.logs.push('Simulated failure log');
        throw new Error('Simulated task error'); // This error is caught by runCrew
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
      expect(crew.output).toEqual({ 
        error: `Critical error during sequential execution of task ${task2.id}: Simulated task error` 
      });
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

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('[Crew AI] Working Agent Assistants')
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining(`Process: ${CrewProcess.SEQUENTIAL}`)
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining(`Agents:\n  - ${mockAgent1.config.role}`)
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining(`Tasks:\n  - ${task1.config.description}`)
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('[Crew AI] Beginning Sequential Process...')
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining(`Executing task: ${task1.config.description}`)
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining(`Task Output (ID: ${task1.id}): Raw output for ${task1.config.description}`)
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('[Crew AI] Crew Execution Complete.')
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining(`Final Output: "Raw output for ${task1.config.description}"`)
      );
      // Ensure it was called a specific number of times if the logs are predictable
      // For example, for a single task sequential crew:
      // Intro, Process, Agents, Tasks, Begin Sequential, Executing, Output, Complete, Final Output = 9 calls
      // The exact number can be fragile, so stringContaining is often better.
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

    describe('Hierarchical Process with Manager Summary', () => {
      let task1: Task;
      let task2: Task;
      const customObjective = "Custom crew objective for testing summary.";
      const defaultObjective = "Synthesize a cohesive final answer based on the outputs of the completed tasks.";
      const finalSummaryResponse = "This is the manager's final summary.";

      beforeEach(() => {
        task1 = createTask(task1Config); // agent mockAgent1
        task2 = createTask(task2Config); // agent mockAgent2

        // Reset mocks for this specific suite. Tests will set their own sequences.
        (mockManagerLlm.chat as Mock).mockReset();
        (mockedPerformAgentTask as Mock).mockReset();
      });

      it('should use custom objective in raw LLM manager final summary prompt', async () => {
        const crewConfig: CrewConfig = {
          agents: [mockAgent1, mockAgent2],
          tasks: [task1, task2],
          process: CrewProcess.HIERARCHICAL,
          managerLlm: mockManagerLlm,
          objective: customObjective,
          verbose: false, 
        };
        const crew = createCrew(crewConfig);

        (mockManagerLlm.chat as Mock)
          .mockName("RawLLM_Delegation_T1_CustomObj")
          .mockResolvedValueOnce({ role: 'assistant', content: JSON.stringify({ taskIdToDelegate: task1.id, agentIdToAssign: mockAgent1.id }) })
          .mockName("RawLLM_Delegation_T2_CustomObj")
          .mockResolvedValueOnce({ role: 'assistant', content: JSON.stringify({ taskIdToDelegate: task2.id, agentIdToAssign: mockAgent2.id }) })
          .mockName("RawLLM_Final_Summary_CustomObj")
          .mockResolvedValueOnce({ role: 'assistant', content: finalSummaryResponse });

        await runCrew(crew);
        expect(crew.status).toBe('COMPLETED');
        expect(crew.output).toBe(finalSummaryResponse);

        // The last call to managerLlm.chat should be for the summary
        const lastCallArgs = (mockManagerLlm.chat as Mock).mock.calls;
        expect(lastCallArgs.length).toBeGreaterThanOrEqual(3); // 2 delegations, 1 ALL_TASKS_COMPLETED, 1 summary
        
        const summaryCallIndex = (mockManagerLlm.chat as Mock).mock.calls.findIndex(call => call[0][0].content.includes("overall crew objective was"));
        expect(summaryCallIndex).not.toBe(-1); // Ensure summary call happened
        const summaryPrompt = (mockManagerLlm.chat as Mock).mock.calls[summaryCallIndex][0][0].content;

        expect(summaryPrompt).toContain(customObjective);
        expect(summaryPrompt).not.toContain(defaultObjective);
        expect(summaryPrompt).toContain(task1.config.description); // Check task outputs are in summary context
        expect(summaryPrompt).toContain(`Raw output for ${task1.config.description}`);
      });

      it('should use default objective in raw LLM manager final summary if none provided', async () => {
        const crewConfig: CrewConfig = {
          agents: [mockAgent1, mockAgent2],
          tasks: [task1, task2],
          process: CrewProcess.HIERARCHICAL,
          managerLlm: mockManagerLlm,
          verbose: false,
        };
        const crew = createCrew(crewConfig);
        (mockManagerLlm.chat as Mock)
          .mockName("RawLLM_Delegation_T1_DefaultObj")
          .mockResolvedValueOnce({ role: 'assistant', content: JSON.stringify({ taskIdToDelegate: task1.id, agentIdToAssign: mockAgent1.id }) })
          .mockName("RawLLM_Delegation_T2_DefaultObj")
          .mockResolvedValueOnce({ role: 'assistant', content: JSON.stringify({ taskIdToDelegate: task2.id, agentIdToAssign: mockAgent2.id }) })
          .mockName("RawLLM_Final_Summary_DefaultObj")
          .mockResolvedValueOnce({ role: 'assistant', content: finalSummaryResponse });

        await runCrew(crew);
        expect(crew.status).toBe('COMPLETED');
        expect(crew.output).toBe(finalSummaryResponse);
        
        const summaryCallIndex = (mockManagerLlm.chat as Mock).mock.calls.findIndex(call => call[0][0].content.includes("overall crew objective was"));
        expect(summaryCallIndex).not.toBe(-1);
        const summaryPrompt = (mockManagerLlm.chat as Mock).mock.calls[summaryCallIndex][0][0].content;
        
        expect(summaryPrompt).toContain(defaultObjective);
      });

      it('should use custom objective in Manager Agent final summary task', async () => {
        const managerAgentConfig: AgentConfig = { role: "TestManager", goal: "Manage", backstory: "Born to manage", llm: mockManagerLlm }; // Manager agent uses an LLM
        const managerAgent = createAgent(managerAgentConfig);
        
        const crewConfig: CrewConfig = {
          agents: [mockAgent1, mockAgent2], // Worker agents
          tasks: [task1, task2],
          process: CrewProcess.HIERARCHICAL,
          managerLlm: managerAgent, // Assign manager AGENT
          objective: customObjective,
          verbose: false,
        };
        const crew = createCrew(crewConfig);

        const managerSummaryOutput = `Manager agent summary: ${finalSummaryResponse} with custom objective`;
        (mockedPerformAgentTask as Mock)
            .mockName("ManagerAgent_Delegation_T1_CustomObj")
            .mockResolvedValueOnce(JSON.stringify({ taskIdToDelegate: task1.id, agentIdToAssign: mockAgent1.id }))
            .mockName("ManagerAgent_Delegation_T2_CustomObj")
            .mockResolvedValueOnce(JSON.stringify({ taskIdToDelegate: task2.id, agentIdToAssign: mockAgent2.id }))
            .mockName("ManagerAgent_Final_Summary_CustomObj")
            .mockResolvedValueOnce(managerSummaryOutput);

        await runCrew(crew);
        expect(crew.status).toBe('COMPLETED');
        expect(crew.output).toBe(managerSummaryOutput);

        // Find the call to performAgentTask for the summary
        const summaryCall = (mockedPerformAgentTask as Mock).mock.calls.find(
            (call) => call[0].id === managerAgent.id && call[1].includes("overall crew objective is")
        );
        expect(summaryCall).toBeDefined();
        const managerAgentSummaryTaskDesc = summaryCall?.[1]; // Second argument is taskDescription
        expect(managerAgentSummaryTaskDesc).toContain(customObjective);
        expect(managerAgentSummaryTaskDesc).not.toContain(defaultObjective);

        // Check that the context passed to manager for summary includes task outputs
        const managerAgentSummaryContext = summaryCall?.[2]; // Third argument is context
        expect(managerAgentSummaryContext).toContain(task1.config.description);
        expect(managerAgentSummaryContext).toContain(`Raw output for ${task1.config.description}`);
      });

      it('should use default objective in Manager Agent final summary task if none provided', async () => {
        const originalConsoleError = console.error; 
        console.error = (...args: unknown[]) => { 
            originalConsoleError(...args); 
        }; 

        try {
            const managerAgentConfig: AgentConfig = { role: "TestManagerDef", goal: "Manage Def", backstory: "Born for default", llm: mockManagerLlm };
            const managerAgent = createAgent(managerAgentConfig);
    
            const crewConfig: CrewConfig = {
              agents: [mockAgent1, mockAgent2],
              tasks: [task1, task2],
              process: CrewProcess.HIERARCHICAL,
              managerLlm: managerAgent,
              verbose: false, 
            };
            const crew = createCrew(crewConfig);
            const managerSummaryOutputDef = `Manager agent summary: ${finalSummaryResponse} with default objective`;
            
            (mockedPerformAgentTask as Mock)
                .mockName("ManagerAgent_Delegation_T1_DefaultObj")
                .mockResolvedValueOnce(JSON.stringify({ taskIdToDelegate: task1.id, agentIdToAssign: mockAgent1.id }))
                .mockName("ManagerAgent_Delegation_T2_DefaultObj")
                .mockResolvedValueOnce(JSON.stringify({ taskIdToDelegate: task2.id, agentIdToAssign: mockAgent2.id }))
                .mockName("ManagerAgent_Final_Summary_DefaultObj")
                .mockResolvedValueOnce(managerSummaryOutputDef);
    
            await runCrew(crew);
            
            expect(crew.status).toBe('COMPLETED');
            expect(crew.output).toBe(managerSummaryOutputDef);
    
            const summaryCall = (mockedPerformAgentTask as Mock).mock.calls.find(
                (call) => call[0].id === managerAgent.id && call[1].includes("overall crew objective is")
            );
            expect(summaryCall).toBeDefined();
            const managerAgentSummaryTaskDesc = summaryCall?.[1];
            expect(managerAgentSummaryTaskDesc).toContain(defaultObjective);
        } finally {
            console.error = originalConsoleError; 
        }
      });
    });
  });

  describe('runCrew - with Task Output Parsing', () => {
    let userSchema: z.ZodObject<{ name: z.ZodString; age: z.ZodNumber }>;
    let taskWithSchema: Task;
    let taskWithBadData: Task;
    let taskValidForMixed: Task;
    let taskInvalidForMixed: Task;
    let taskNoSchemaForMixed: Task;

    beforeEach(() => {
      userSchema = z.object({
        name: z.string(),
        age: z.number(),
      });

      // These tasks are created fresh for each test in this suite
      // Descriptions are key for the executeTask mock
      taskWithSchema = createTask({
        description: 'Process valid_user data', // executeTask mock looks for 'valid_user'
        expectedOutput: 'User processed',
        outputSchema: userSchema,
        agent: mockAgent1,
      });
      taskWithBadData = createTask({
        description: 'Process invalid_user data', // executeTask mock looks for 'invalid_user'
        expectedOutput: 'User processed with issues',
        outputSchema: userSchema,
        agent: mockAgent1,
      });
      taskValidForMixed = createTask({
        description: 'Process valid_user data for mixed', // Re-use 'valid_user' for simplicity
        expectedOutput: 'Valid mixed output',
        outputSchema: userSchema,
        agent: mockAgent1,
      });
      taskInvalidForMixed = createTask({
        description: 'Process invalid_user data for mixed', // Re-use 'invalid_user'
        expectedOutput: 'Invalid mixed output',
        outputSchema: userSchema,
        agent: mockAgent1,
      });
      taskNoSchemaForMixed = createTask({
        description: 'Process raw data for mixed', // Generic, no special handling in executeTask mock beyond default
        expectedOutput: 'Raw mixed output',
        agent: mockAgent2,
      });

      // Default for manager agent summarization if used by a test (though these tests use raw LLM manager)
      mockedPerformAgentTask.mockImplementation(async (agent, taskDescOrAction) => {
        if (taskDescOrAction.includes('overall crew objective')) {
          return 'Manager Agent summarized the outputs.';
        }
        // Default for manager delegation if needed (should not be for these specific tests if mockManagerLlm.chat is well-defined)
        return JSON.stringify({ taskIdToDelegate: 'fallback-task-id', agentIdToAssign: 'fallback-agent-id' });
      });
    });

    it('should store parsedOutput in tasksOutput and use it in manager summary', async () => {
      const crewConfig: CrewConfig = {
        agents: [mockAgent1],
        tasks: [taskWithSchema], 
        process: CrewProcess.HIERARCHICAL,
        managerLlm: mockManagerLlm,
        verbose: false,
      };
      // Specific mockManagerLlm.chat for THIS TEST (1 task)
      (mockManagerLlm.chat as Mock)
        .mockReset()
        .mockName("Zod_Test1_Delegate")
        .mockResolvedValueOnce({ role: 'assistant', content: JSON.stringify({ taskIdToDelegate: taskWithSchema.id, agentIdToAssign: mockAgent1.id }) })
        .mockName("Zod_Test1_Summary")
        .mockResolvedValueOnce({ role: 'assistant', content: 'Manager summarized [valid user data].' });

      const crew = createCrew(crewConfig);
      await runCrew(crew);

      expect(crew.status).toBe('COMPLETED');
      const taskOutputDetail = crew.tasksOutput.get(taskWithSchema.id);
      expect(taskOutputDetail).toBeDefined();
      if (taskOutputDetail) {
        expect(taskOutputDetail.output).toEqual({ name: 'Test User', age: 30 });
        expect(taskOutputDetail.parsedOutput).toEqual({ name: 'Test User', age: 30 });
        expect(taskOutputDetail.validationError).toBeNull();
      }
      const managerChatCalls = (mockManagerLlm.chat as Mock).mock.calls;
      const summaryPromptCall = managerChatCalls.find(call => call[0][0].content.includes('Summary of Successfully Completed Task Outputs'));
      expect(summaryPromptCall).toBeDefined();
      if (summaryPromptCall) {
        const summaryPromptContent = summaryPromptCall[0][0].content;
        expect(summaryPromptContent).toContain(JSON.stringify({ name: 'Test User', age: 30 }));
        expect(summaryPromptContent).not.toContain('Validation Status: FAILED');
      }
      expect(crew.output).toBe('Manager summarized [valid user data].');
    });

    it('should store validationError and use raw output in manager summary if parsing fails', async () => {
      const crewConfig: CrewConfig = {
        agents: [mockAgent1],
        tasks: [taskWithBadData], 
        process: CrewProcess.HIERARCHICAL,
        managerLlm: mockManagerLlm,
        verbose: false,
      };
      // Specific mockManagerLlm.chat for THIS TEST (1 task)
      (mockManagerLlm.chat as Mock)
        .mockReset()
        .mockName("Zod_Test2_Delegate")
        .mockResolvedValueOnce({ role: 'assistant', content: JSON.stringify({ taskIdToDelegate: taskWithBadData.id, agentIdToAssign: mockAgent1.id }) })
        .mockName("Zod_Test2_Summary")
        .mockResolvedValueOnce({ role: 'assistant', content: 'Manager summarized [invalid user data].' });

      const crew = createCrew(crewConfig);
      await runCrew(crew);

      expect(crew.status).toBe('COMPLETED');
      const taskOutputDetail = crew.tasksOutput.get(taskWithBadData.id);
      expect(taskOutputDetail).toBeDefined();
      if (taskOutputDetail) {
        expect(taskOutputDetail.output).toEqual({ name: 'Test User', age: 'thirty' });
        expect(taskOutputDetail.parsedOutput).toBeNull();
        expect(taskOutputDetail.validationError).toBeInstanceOf(z.ZodError);
      }
      const managerChatCalls = (mockManagerLlm.chat as Mock).mock.calls;
      const summaryPromptCall = managerChatCalls.find(call => call[0][0].content.includes('Summary of Successfully Completed Task Outputs'));
      expect(summaryPromptCall).toBeDefined();
      if (summaryPromptCall) {
        const summaryPromptContent = summaryPromptCall[0][0].content;
        expect(summaryPromptContent).toContain(JSON.stringify({ name: 'Test User', age: 'thirty' }));
        expect(summaryPromptContent).toContain('Validation Status: FAILED');
        expect(summaryPromptContent).toContain('age: Expected number, received string');
      }
      expect(crew.output).toBe('Manager summarized [invalid user data].');
    });

    it('should handle mixed tasks (parsed, raw, failed validation) in manager summary', async () => {
      const crewConfig: CrewConfig = {
        agents: [mockAgent1, mockAgent2],
        tasks: [taskValidForMixed, taskInvalidForMixed, taskNoSchemaForMixed], 
        process: CrewProcess.HIERARCHICAL,
        managerLlm: mockManagerLlm,
      };
       // Specific mockManagerLlm.chat for THIS TEST (3 tasks)
      (mockManagerLlm.chat as Mock)
        .mockReset()
        .mockName("Zod_Test3_Delegate1")
        .mockResolvedValueOnce({ role: 'assistant', content: JSON.stringify({ taskIdToDelegate: taskValidForMixed.id, agentIdToAssign: mockAgent1.id }) })
        .mockName("Zod_Test3_Delegate2")
        .mockResolvedValueOnce({ role: 'assistant', content: JSON.stringify({ taskIdToDelegate: taskInvalidForMixed.id, agentIdToAssign: mockAgent1.id }) })
        .mockName("Zod_Test3_Delegate3")
        .mockResolvedValueOnce({ role: 'assistant', content: JSON.stringify({ taskIdToDelegate: taskNoSchemaForMixed.id, agentIdToAssign: mockAgent2.id }) })
        .mockName("Zod_Test3_Summary")
        .mockResolvedValueOnce({ role: 'assistant', content: 'Manager summarized all mixed outputs.' });

      const crew = createCrew(crewConfig);
      await runCrew(crew);

      expect(crew.status).toBe('COMPLETED');
      const validDetail = crew.tasksOutput.get(taskValidForMixed.id);
      const invalidDetail = crew.tasksOutput.get(taskInvalidForMixed.id);
      const rawDetail = crew.tasksOutput.get(taskNoSchemaForMixed.id);

      expect(validDetail?.parsedOutput).toEqual({ name: 'Test User', age: 30 });
      expect(invalidDetail?.validationError).toBeInstanceOf(z.ZodError);
      // The executeTask mock sets parsedOutput to null if no schema or if schema fails.
      // If no schema, rawOutput is `Raw output for ${description}`, parsedOutput is null.
      expect(rawDetail?.parsedOutput).toBeNull(); 
      expect(rawDetail?.output).toBe(`Raw output for ${taskNoSchemaForMixed.config.description}`);

      const managerChatCalls = (mockManagerLlm.chat as Mock).mock.calls;
      const summaryPromptCall = managerChatCalls.find(call => call[0][0].content.includes('Summary of Successfully Completed Task Outputs'));
      expect(summaryPromptCall).toBeDefined();
      if (summaryPromptCall) {
        const summaryPromptContent = summaryPromptCall[0][0].content;
        expect(summaryPromptContent).toContain(JSON.stringify({ name: 'Test User', age: 30 }));
        expect(summaryPromptContent).toContain(JSON.stringify({ name: 'Test User', age: 'thirty' }));
        expect(summaryPromptContent).toContain('Validation Status: FAILED');
        expect(summaryPromptContent).toContain(`Raw output for ${taskNoSchemaForMixed.config.description}`);
        expect(summaryPromptContent.match(/Validation Status: FAILED/g)?.length).toBe(1);
      }
      expect(crew.output).toBe('Manager summarized all mixed outputs.');
    });
  });
}); 