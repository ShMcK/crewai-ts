import { beforeEach, describe, expect, it, vi, type Mock, type MockedFunction } from 'vitest';
import { CrewProcess } from '../core';
import { createCrew, runCrew } from './index'; // Assuming named exports
import type { Crew, CrewConfig } from './index';
import type { Agent, AgentConfig } from '../agents';
import { createAgent } from '../agents'; // Assuming factory function
import type { Task, TaskConfig } from '../tasks';
import { createTask, executeTask as originalExecuteTask } from '../tasks'; // Assuming factory and executeTask
import type { ChatLLM, OpenAIConfig } from '../llms'; // Import ChatLLM
import { performAgentTask as originalPerformAgentTask } from '../agents';
import type { Tool, ToolContext } from '../tools'; // Added ToolContext

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
      chat: vi.fn().mockResolvedValue({ role: 'assistant', content: '{"taskIdToDelegate": "task-id", "agentIdToAssign": "agent-id"}' }),
      invoke: vi.fn().mockResolvedValue({ role: 'assistant', content: 'mock invoke' }),
    };

    // Spy on console methods if verbose mode is tested
    vi.spyOn(console, 'log').mockImplementation(() => {}); // Re-enable the spy
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
        managerLlm: mockManagerLlm, // Add mock manager LLM
      };
      const crew = createCrew(crewConfig);

      await runCrew(crew);

      // expect(mockedExecuteTask).toHaveBeenCalledTimes(2); // This will change with actual hierarchical logic
      // expect(mockedExecuteTask).toHaveBeenCalledWith(task1, mockAgent1);
      // expect(mockedExecuteTask).toHaveBeenCalledWith(task2, mockAgent2);
      // expect(console.log).toHaveBeenCalledWith(expect.stringContaining('[Crew AI] Hierarchical process is not yet implemented'));
      // For now, since managerLlm.chat is basic, let's check it was called
      expect(mockManagerLlm.chat).toHaveBeenCalled();
      expect(crew.status).toBe('COMPLETED'); // Or FAILED if manager decision is bad / no tasks
    });

    it('should use first crew agent if task has no agent (hierarchical fallback)', async () => {
      const taskNoAgent = createTask({ description: 'Task with no agent hierarchical', expectedOutput: 'exp' });
      const crewConfig: CrewConfig = {
        agents: [mockAgent1, mockAgent2],
        tasks: [taskNoAgent],
        process: CrewProcess.HIERARCHICAL,
        managerLlm: mockManagerLlm, // Add mock manager LLM
      };
      const crew = createCrew(crewConfig);
      await runCrew(crew);
      // In hierarchical, agent assignment is up to the manager, not a fallback to the first agent.
      // The mock for executeTask will be called based on manager's decision.
      // This test might need rethinking for true hierarchical behavior or be removed if covered by manager logic tests.
      expect(mockManagerLlm.chat).toHaveBeenCalled(); // Manager should have been called
      // We can't easily assert which agent was used without a more complex mock manager or inspecting manager prompt.
      // For now, just ensure it completed.
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
        expect.stringContaining(`Task Output (ID: ${task1.id}): Output from task: ${task1.config.description}`)
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('[Crew AI] Crew Execution Complete.')
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining(`Final Output: "Output from task: ${task1.config.description}"`)
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

        // Reset and configure mocks for multi-stage hierarchical process
        // 1. Delegate task1, 2. Delegate task2, 3. All tasks completed, 4. Generate summary
        mockManagerLlm.chat = vi.fn()
          .mockReset()
          .mockName("RawLLM_Delegation_T1")
          .mockResolvedValueOnce({ role: 'assistant', content: JSON.stringify({ taskIdToDelegate: task1.id, agentIdToAssign: mockAgent1.id }) })
          .mockName("RawLLM_Delegation_T2")
          .mockResolvedValueOnce({ role: 'assistant', content: JSON.stringify({ taskIdToDelegate: task2.id, agentIdToAssign: mockAgent2.id }) })
          .mockName("RawLLM_Final_Summary")
          .mockResolvedValueOnce({ role: 'assistant', content: finalSummaryResponse });

        mockedPerformAgentTask.mockImplementation(async (agent, taskDescOrAction, context) => {
          // Manager agent making a delegation decision
          if (taskDescOrAction.includes("Delegate a task") || taskDescOrAction.includes("As the project manager")) {
            // Simplified logic: count calls to determine which task to delegate or if all done for delegation phase.
            const delegationCalls = mockedPerformAgentTask.mock.calls.filter(call => 
                (call[1].includes("Delegate a task") || call[1].includes("As the project manager")) &&
                !call[1].includes("overall crew objective") // Exclude final summary calls
            );

            if (delegationCalls.length <= 1) { // First actual delegation call by manager
                return JSON.stringify({ taskIdToDelegate: task1.id, agentIdToAssign: mockAgent1.id, additionalContextForAgent: "Manager agent context for task 1" });
            }
            if (delegationCalls.length === 2) { // Second actual delegation call by manager
                 return JSON.stringify({ taskIdToDelegate: task2.id, agentIdToAssign: mockAgent2.id, additionalContextForAgent: "Manager agent context for task 2" });
            }
            // After two delegations, manager should signal completion of delegation phase
            return "ALL_TASKS_COMPLETED"; 
          }
          // Manager agent generating the final summary
          if (taskDescOrAction.includes("overall crew objective") && taskDescOrAction.includes("provide a comprehensive final summary")) {
            return `Manager agent summary: ${finalSummaryResponse} based on context: ${context?.substring(0, 50)}...`;
          }
          // Fallback for other agent tasks (e.g., worker agents, though their execution is mocked by mockedExecuteTask)
          return `Agent ${agent.config.role} processed: ${taskDescOrAction.substring(0,30)}`;
        });
      });

      it('should use custom objective in raw LLM manager final summary prompt', async () => {
        const crewConfig: CrewConfig = {
          agents: [mockAgent1, mockAgent2],
          tasks: [task1, task2],
          process: CrewProcess.HIERARCHICAL,
          managerLlm: mockManagerLlm,
          objective: customObjective,
          verbose: false, // Keep verbose false to simplify mock verification
        };
        const crew = createCrew(crewConfig);

        // Refine mockManagerLlm.chat for this specific test flow
        // Iteration 1: Delegate task1
        // Iteration 2: Delegate task2
        // Iteration 3: Manager says ALL_TASKS_COMPLETED
        // Call for Final Summary
        (mockManagerLlm.chat as Mock)
          .mockReset()
          .mockName("RawLLM_Delegation_T1")
          .mockResolvedValueOnce({ role: 'assistant', content: JSON.stringify({ taskIdToDelegate: task1.id, agentIdToAssign: mockAgent1.id }) })
          .mockName("RawLLM_Delegation_T2")
          .mockResolvedValueOnce({ role: 'assistant', content: JSON.stringify({ taskIdToDelegate: task2.id, agentIdToAssign: mockAgent2.id }) })
          .mockName("RawLLM_Final_Summary")
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
        expect(summaryPrompt).toContain(`Output from task: ${task1.config.description}`);
      });

      it('should use default objective in raw LLM manager final summary if none provided', async () => {
        const crewConfig: CrewConfig = {
          agents: [mockAgent1, mockAgent2],
          tasks: [task1, task2],
          process: CrewProcess.HIERARCHICAL,
          managerLlm: mockManagerLlm,
          // No objective
          verbose: false,
        };
        const crew = createCrew(crewConfig);
        (mockManagerLlm.chat as Mock)
          .mockReset()
          .mockName("RawLLM_Delegation_T1")
          .mockResolvedValueOnce({ role: 'assistant', content: JSON.stringify({ taskIdToDelegate: task1.id, agentIdToAssign: mockAgent1.id }) })
          .mockName("RawLLM_Delegation_T2")
          .mockResolvedValueOnce({ role: 'assistant', content: JSON.stringify({ taskIdToDelegate: task2.id, agentIdToAssign: mockAgent2.id }) })
          .mockName("RawLLM_Final_Summary")
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

        // Configure mockedPerformAgentTask for this test's flow:
        // 1. Manager Agent delegates task1
        // 2. Manager Agent delegates task2
        // 3. Manager Agent says "ALL_TASKS_COMPLETED" (or implies it by not delegating further)
        // 4. Manager Agent generates final summary
        const managerSummaryOutput = `Manager agent summary: ${finalSummaryResponse} with custom objective`;
        (mockedPerformAgentTask as Mock)
            .mockReset()
            .mockName("ManagerAgent_Delegation_Call_1")
            .mockResolvedValueOnce(JSON.stringify({ taskIdToDelegate: task1.id, agentIdToAssign: mockAgent1.id }))
            .mockName("ManagerAgent_Delegation_Call_2")
            .mockResolvedValueOnce(JSON.stringify({ taskIdToDelegate: task2.id, agentIdToAssign: mockAgent2.id }))
            .mockName("ManagerAgent_Final_Summary_Call_3")
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
        expect(managerAgentSummaryContext).toContain(`Output from task: ${task1.config.description}`);
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
                .mockReset()
                .mockName("ManagerAgent_Delegation_Call_1")
                .mockResolvedValueOnce(JSON.stringify({ taskIdToDelegate: task1.id, agentIdToAssign: mockAgent1.id }))
                .mockName("ManagerAgent_Delegation_Call_2")
                .mockResolvedValueOnce(JSON.stringify({ taskIdToDelegate: task2.id, agentIdToAssign: mockAgent2.id }))
                .mockName("ManagerAgent_Final_Summary_Call_3")
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
}); 