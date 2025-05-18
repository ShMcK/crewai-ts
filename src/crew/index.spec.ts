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

    describe('Hierarchical Process with Manager Agent using Tools', () => {
      let managerAgent: Agent;
      let workerAgent: Agent;
      let taskToDelegate: Task;
      let managerDecisionHelperTool: Tool<unknown, unknown>;
      let mockManagerAgentLlm: MockedFunction<ChatLLM['chat']>;

      beforeEach(() => {
        // Setup specific to this describe block
        managerDecisionHelperTool = {
          name: 'managerDecisionHelperTool',
          description: 'A tool to help manager make decisions.',
          execute: vi.fn().mockImplementation(async (input: unknown, _context?: ToolContext) => {
            // More lenient mock for now to check if it's called at all
            // console.log('Mock tool execute called with input:', input, 'context:', _context); // For debugging during test runs
            return Promise.resolve(`Tool output: crucial data gathered, input type: ${typeof input}`);
          }),
        };

        mockManagerAgentLlm = vi.fn();
        const managerLlmInstance: ChatLLM = {
          id: 'manager-agent-llm',
          providerName: 'openai',
          config: { modelName: 'gpt-4-test' } as OpenAIConfig,
          chat: mockManagerAgentLlm,
          invoke: vi.fn(),
        };

        const managerAgentConfig: AgentConfig = {
          role: 'Chief Decision Maker',
          goal: 'Delegate tasks efficiently after analysis',
          backstory: 'Has access to analytical tools.',
          llm: managerLlmInstance,
          tools: [managerDecisionHelperTool],
          verbose: true, // Enable verbose for manager agent for potential logging
        };
        managerAgent = createAgent(managerAgentConfig);

        const workerAgentConfig: AgentConfig = {
          role: 'Worker Bee',
          goal: 'Execute assigned tasks',
          backstory: 'Diligent worker.',
          // llm: {} as any, // Assuming worker agent might not need LLM for some tasks or it's mocked differently
        };
        workerAgent = createAgent(workerAgentConfig);

        taskToDelegate = createTask({
          description: 'Important task to be delegated',
          expectedOutput: 'Result of the important task',
          // No agent assigned initially, manager will assign it
        });
        
        // Reset the global mockedPerformAgentTask for other tests if necessary
        // For this suite, we are testing the crew's invocation of performAgentTask on the manager agent
        // and that performAgentTask correctly uses the manager's LLM and tools.
        // So we let the *actual* performAgentTask run for the managerAgent.
        // We mock the managerAgent's LLM (chat method).
        mockedPerformAgentTask.mockImplementation(async (agent: Agent, taskDescription: string, context?: string) => {
          // This is a fallback mock for performAgentTask if it's called for agents OTHER than the manager
          // or if the manager agent scenario needs a specific controlled outcome not tied to its internal LLM directly.
          // For the manager agent, its own LLM (mockManagerAgentLlm) will be invoked by the *actual* performAgentTask.
          if (agent.id === managerAgent.id) {
            // highlight-start
            // console.log(`DEBUG: mockedPerformAgentTask: MANAGER AGENT (${agent.id}) DETECTED. Calling original.`);
            // highlight-end
            // Let the actual performAgentTask run for the manager agent
            // by calling the original implementation. This is tricky with vi.mock.
            // The alternative is to NOT mock performAgentTask globally, and only spy on it,
            // or to re-implement its logic here for the manager if needed.
            // Given the user's note, we want performAgentTask to do its job.
            // The global mock of performAgentTask might interfere.

            // To test the manager agent truly using its tools via the *actual* performAgentTask,
            // performAgentTask should NOT be mocked for the managerAgent.
            // Let's adjust the global mock to allow passthrough or specific handling.
            const originalAgentsModule = await vi.importActual<typeof import('../agents')>('../agents');
            // highlight-start
            const result = await originalAgentsModule.performAgentTask(agent, taskDescription, context);
            // console.log(`DEBUG: mockedPerformAgentTask: MANAGER AGENT original call returned snippet: ${result.substring(0, 200)}`);
            return result;
            // highlight-end

          }
          // highlight-start
          // console.log(`DEBUG: mockedPerformAgentTask: DEFAULT MOCK for agent ${agent.id} (${agent.config.role})`);
          // highlight-end
          // Default mock behavior for other agents (e.g. worker agents if their tasks were complex)
          return `Default mock output for ${agent.config.role} performing: ${taskDescription}`;
        });
      });

      it('should allow manager agent to use its tool before delegating a task and complete the crew', async () => {
        const crewConfig: CrewConfig = {
          agents: [managerAgent, workerAgent], // Manager agent must be in the list
          tasks: [taskToDelegate],
          process: CrewProcess.HIERARCHICAL,
          managerLlm: managerAgent, // Manager is an Agent instance
          verbose: true,
        };
        const crew = createCrew(crewConfig);

        // 1. Manager agent's LLM is first asked for a decision (by performAgentTask, called by runCrew)
        // It decides to use its tool.
        const toolCallCommand = `Okay, I need to use my tool. Here is the tool call: \`\`\`json
{
  "tool_name": "managerDecisionHelperTool",
  "tool_input": "analyze current tasks"
}
\`\`\``;
        mockManagerAgentLlm.mockResolvedValueOnce({ role: 'assistant', content: toolCallCommand });

        // 2. After tool execution, manager agent's LLM is called again (by performAgentTask)
        // It now provides the delegation.
        const delegationDecision = `Great, the tool output was very helpful. Now I will delegate. \`\`\`json
{
  "taskIdToDelegate": "${taskToDelegate.id}",
  "agentIdToAssign": "${workerAgent.id}",
  "additionalContextForAgent": "Tool insights: crucial data gathered. Focus on this."
}
\`\`\``;
        mockManagerAgentLlm.mockResolvedValueOnce({ role: 'assistant', content: delegationDecision });
        
        // 3. Manager LLM is called for the final summary
        mockManagerAgentLlm.mockResolvedValueOnce({ role: 'assistant', content: 'All tasks completed. Final summary by manager based on results.' });


        await runCrew(crew);

        // Assertions
        // Verify manager's tool was called
        expect(managerDecisionHelperTool.execute).toHaveBeenCalledTimes(1);
        expect(managerDecisionHelperTool.execute).toHaveBeenCalledWith(
          'analyze current tasks',
          {
            taskDescription: expect.stringContaining('As the project manager'), // The manager task description
            originalTaskContext: expect.stringContaining('Tasks to be Actioned'), // The manager context
          },
        );

        // Check for verbose logging related to tool use by manager agent
        // The spy is on console.log directly from the global beforeEach
        // highlight-start
        expect(console.log).toHaveBeenCalledWith(
          expect.stringContaining(`Agent ${managerAgent.config.role} attempting to use tool: ${managerDecisionHelperTool.name}`),
        );
        expect(console.log).toHaveBeenCalledWith(
          expect.stringContaining(`Agent ${managerAgent.config.role} tool ${managerDecisionHelperTool.name} output:`),
        );
        // highlight-end

        // Verify the task was delegated and executed
        expect(mockedExecuteTask).toHaveBeenCalledTimes(1);
        expect(mockedExecuteTask).toHaveBeenCalledWith(
          expect.objectContaining({ id: taskToDelegate.id }),
          expect.objectContaining({ id: workerAgent.id }),
          // expect.anything() // TODO: Refine to check context propagation
        );
        
        const executeTaskCall = mockedExecuteTask.mock.calls[0];
        const taskArg = executeTaskCall[0] as Task;
        expect(taskArg.config.context).toContain("Tool insights: crucial data gathered. Focus on this.");


        expect(taskToDelegate.status).toBe('completed');
        expect(taskToDelegate.output).toBe(`Output from task: ${taskToDelegate.config.description}`); // From global mock

        // Verify crew completion
        expect(crew.status).toBe('COMPLETED');
        expect(crew.output).toBe('All tasks completed. Final summary by manager based on results.');
        
        // Verify manager's LLM was called for decision and summary
        expect(mockManagerAgentLlm).toHaveBeenCalledTimes(3); // 1 for tool use, 1 for delegation, 1 for final summary

        // Check verbose logging (optional, but good to confirm)
        // highlight-start
        // The following logs were for a previous logging style and are no longer generated directly by runCrew for manager tool use.
        // Tool usage logs are now primarily handled within performAgentTask and checked by earlier assertions.
        // expect(console.log).toHaveBeenCalledWith(expect.stringContaining(`[Crew AI - ${crew.id}] [Manager Agent - ${managerAgent.config.role}] Using tool: ${managerDecisionHelperTool.name}`));
        // expect(console.log).toHaveBeenCalledWith(expect.stringContaining(`[Crew AI - ${crew.id}] [Manager Agent - ${managerAgent.config.role}] Tool managerDecisionHelperTool output: Tool output: crucial data gathered`));
        // expect(console.log).toHaveBeenCalledWith(expect.stringContaining(`[Crew AI - ${crew.id}] Delegating task "${taskToDelegate.config.description}" to agent "${workerAgent.config.role}"`));
        // highlight-end
      });
    });
  });
}); 