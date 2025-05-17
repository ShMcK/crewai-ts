import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Crew, type CrewConfig } from './index';
import { Agent, type AgentConfig } from '../agents';
import { Task, type TaskConfig } from '../tasks';
import { CrewProcess } from '../core';

// --- Mocks ---
const mockAgentExecuteTask = vi.fn();
class MockAgent extends Agent {
  override async executeTask(taskDescription: string, context?: string): Promise<string> {
    mockAgentExecuteTask(taskDescription, context);
    return `Agent ${this.role} result for: ${taskDescription}`;
  }
}

const mockTaskExecute = vi.fn();
class MockTask extends Task {
  override async execute(agentOverride?: Agent): Promise<string | object> {
    const agentToUse = agentOverride ?? this.agent;
    mockTaskExecute(this.description, agentToUse?.role);
    if (agentToUse instanceof MockAgent) {
      return agentToUse.executeTask(this.description, this.context);
    }
    return `Task '${this.description}' executed (mocked)`;
  }
}
// --- End Mocks ---

describe('Crew', () => {
  let agent1: MockAgent;
  let agent2: MockAgent;
  let task1: MockTask;
  let task2: MockTask;

  beforeEach(() => {
    mockAgentExecuteTask.mockClear();
    mockTaskExecute.mockClear();

    agent1 = new MockAgent({ role: 'Agent 1', goal: 'G1', backstory: 'B1' });
    agent2 = new MockAgent({ role: 'Agent 2', goal: 'G2', backstory: 'B2' });

    task1 = new MockTask({
      description: 'Task 1',
      expectedOutput: 'EO1',
      agent: agent1,
    });
    task2 = new MockTask({
      description: 'Task 2',
      expectedOutput: 'EO2',
      agent: agent2,
    });
  });

  it('should create a crew with agents and tasks', () => {
    const crewConfig: CrewConfig = {
      agents: [agent1, agent2],
      tasks: [task1, task2],
    };
    const crew = new Crew(crewConfig);
    expect(crew.agents).toEqual([agent1, agent2]);
    expect(crew.tasks).toEqual([task1, task2]);
    expect(crew.process).toBe(CrewProcess.SEQUENTIAL); // Default
  });

  it('should throw an error if no agents are provided', () => {
    expect(() => new Crew({ agents: [], tasks: [task1] })).toThrow(
      'A crew must have at least one agent.',
    );
  });

  it('should throw an error if no tasks are provided', () => {
    expect(() => new Crew({ agents: [agent1], tasks: [] })).toThrow(
      'A crew must have at least one task.',
    );
  });

  it('should throw an error if a task agent is not in the crew', () => {
    const outsiderAgent = new MockAgent({ role: 'Outsider', goal: 'G', backstory: 'B' });
    const taskWithOutsider: TaskConfig = {
      description: 'Task with outsider',
      expectedOutput: 'EO',
      agent: outsiderAgent,
    };
    expect(
      () =>
        new Crew({
          agents: [agent1],
          tasks: [new MockTask(taskWithOutsider)],
        }),
    ).toThrow(
      "Task 'Task with outsider' is assigned to an agent 'Outsider' not in this crew.",
    );
  });

  describe('kickoff - Sequential Process', () => {
    it('should execute tasks sequentially using their assigned agents', async () => {
      const crew = new Crew({ agents: [agent1, agent2], tasks: [task1, task2] });
      const results = await crew.kickoff();

      expect(results.length).toBe(2);
      expect(results[0]).toBe('Agent Agent 1 result for: Task 1');
      expect(results[1]).toBe('Agent Agent 2 result for: Task 2');

      expect(mockTaskExecute).toHaveBeenCalledTimes(2);
      expect(mockTaskExecute).toHaveBeenNthCalledWith(1, 'Task 1', 'Agent 1');
      expect(mockTaskExecute).toHaveBeenNthCalledWith(2, 'Task 2', 'Agent 2');
    });

    it('should use the first crew agent if a task has no assigned agent', async () => {
      const task3 = new MockTask({ description: 'Task 3', expectedOutput: 'EO3' });
      const crew = new Crew({ agents: [agent1, agent2], tasks: [task3] });
      const results = await crew.kickoff();

      expect(results[0]).toBe('Agent Agent 1 result for: Task 3');
      expect(mockTaskExecute).toHaveBeenCalledWith('Task 3', 'Agent 1');
    });

    it('should execute tasks and collect their outputs', async () => {
      const crew = new Crew({ agents: [agent1, agent2], tasks: [task1, task2] });
      const output = await crew.kickoff();

      expect(output).toEqual([
        'Agent Agent 1 result for: Task 1',
        'Agent Agent 2 result for: Task 2',
      ]);
      expect(crew.output).toEqual(output);
    });
  });

  describe('kickoff - Hierarchical Process (Fallback)', () => {
    it('should execute tasks sequentially (fallback) when process is hierarchical', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const crew = new Crew({
        agents: [agent1, agent2],
        tasks: [task1, task2],
        process: CrewProcess.HIERARCHICAL,
      });
      const results = await crew.kickoff();

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Hierarchical process is not yet implemented. Running tasks sequentially as a fallback.',
      );
      expect(results.length).toBe(2);
      expect(results[0]).toBe('Agent Agent 1 result for: Task 1');
      expect(results[1]).toBe('Agent Agent 2 result for: Task 2');
      consoleWarnSpy.mockRestore();
    });
  });

  describe('Telemetry', () => {
    it('should call sendTelemetry if shareCrew is true', async () => {
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const crewConfig: CrewConfig = {
        agents: [agent1],
        tasks: [task1],
        shareCrew: true,
      };
      const crew = new Crew(crewConfig);
      // biome-ignore lint/suspicious/noExplicitAny: Accessing private method for test spy
      const sendTelemetrySpy = vi.spyOn(crew as any, 'sendTelemetry');

      await crew.kickoff();

      expect(sendTelemetrySpy).toHaveBeenCalledOnce();
      expect(consoleLogSpy).toHaveBeenCalledWith(
        'Telemetry Data (simulated):',
        expect.objectContaining({
          agentsCount: 1,
          tasksCount: 1,
          process: CrewProcess.SEQUENTIAL,
        }),
      );
      sendTelemetrySpy.mockRestore();
      consoleLogSpy.mockRestore();
    });

    it('should not call sendTelemetry if shareCrew is false or undefined', async () => {
      const crewConfig: CrewConfig = {
        agents: [agent1],
        tasks: [task1],
        shareCrew: false,
      };
      const crew = new Crew(crewConfig);
      // biome-ignore lint/suspicious/noExplicitAny: Accessing private method for test spy
      const sendTelemetrySpy = vi.spyOn(crew as any, 'sendTelemetry');
      await crew.kickoff();
      expect(sendTelemetrySpy).not.toHaveBeenCalled();

      const crewConfigUndefined = {
        agents: [agent1],
        tasks: [task1],
      };
      const crew2 = new Crew(crewConfigUndefined);
      // biome-ignore lint/suspicious/noExplicitAny: Accessing private method for test spy
      const sendTelemetrySpy2 = vi.spyOn(crew2 as any, 'sendTelemetry');
      await crew2.kickoff();
      expect(sendTelemetrySpy2).not.toHaveBeenCalled();

      sendTelemetrySpy.mockRestore();
      sendTelemetrySpy2.mockRestore();
    });
  });
}); 