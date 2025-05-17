// Crew definitions for crew-ai-ts
import type { Agent } from '../agents';
import type { Task } from '../tasks';
import { CrewProcess } from '../core';
import { v4 as uuidv4 } from 'uuid';
import { executeTask } from '../tasks'; // Assuming executeTask is exported and handles its own agent interaction

// biome-ignore lint/suspicious/noExplicitAny: <explanation>
type LLM = any; // Placeholder, replace with actual LLM type from src/llms
// biome-ignore lint/suspicious/noExplicitAny: <explanation>
type Output = any; // Placeholder

export interface CrewConfig {
  agents: Agent[];
  tasks: Task[];
  process?: CrewProcess;
  verbose?: boolean | number; // number for log level, boolean for on/off
  managerLlm?: LLM; // Used for hierarchical process
  shareCrew?: boolean; // For telemetry, as seen in Python crewAI
  // memory?: boolean; // Assuming memory management will be handled differently or added later
  // cache?: boolean; // Assuming caching will be handled differently or added later
  // maxRpm?: number; // Assuming rate limiting will be handled differently or added later
  // language?: string; // Assuming localization will be handled differently or added later
  // outputLogFile?: string | boolean; // Assuming logging will be handled differently or added later
  // managerCallbacks?: unknown[]; // Assuming callbacks will be handled differently or added later
  // taskCallbacks?: unknown[]; // Assuming callbacks will be handled differently or added later
  // stepCallbacks?: unknown[]; // Assuming callbacks will be handled differently or added later
}

export interface Crew {
  id: string;
  config: CrewConfig;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  // biome-ignore lint/suspicious/noExplicitAny: <explanation>
  output: any; // Final output of the crew's work
  tasksOutput: Map<string, { output: string | object; logs?: string[] }>; // Output from each task, aligning with Task.output
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

export function createCrew(config: CrewConfig): Crew {
  if (!config.agents || config.agents.length === 0) {
    throw new Error('Crew creation failed: No agents provided.');
  }
  if (!config.tasks || config.tasks.length === 0) {
    throw new Error('Crew creation failed: No tasks provided.');
  }

  // Validate that if a task has an agent, that agent is part of the crew's agents list.
  for (const task of config.tasks) {
    if (task.config.agent && !config.agents.some(a => a.id === task.config.agent?.id)) {
      throw new Error(
        `Task "${task.config.description}" is configured with an agent (ID: ${task.config.agent.id}, Role: ${task.config.agent.config.role}) that is not part of the provided crew agents list.`
      );
    }
  }

  return {
    id: uuidv4(),
    config: {
      ...config,
      process: config.process || CrewProcess.SEQUENTIAL,
      verbose: config.verbose ?? false,
    },
    status: 'PENDING',
    output: null,
    tasksOutput: new Map(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// Placeholder for telemetry
// biome-ignore lint/suspicious/noExplicitAny: <explanation>
function sendTelemetry(event: string, payload?: any): void {
  if (process.env.NODE_ENV !== 'test') {
    // console.log(`Telemetry: ${event}`, payload); // Replace with actual telemetry call
  }
}

export async function runCrew(crew: Crew): Promise<void> {
  if (crew.status === 'RUNNING') {
    console.warn(`Crew ${crew.id} is already running.`);
    return;
  }
  if (crew.status === 'COMPLETED' || crew.status === 'FAILED') {
    console.warn(
      `Crew ${crew.id} has already finished. Create a new crew to run again.`,
    );
    return;
  }

  crew.status = 'RUNNING';
  crew.startedAt = new Date();
  crew.updatedAt = new Date();
  sendTelemetry('crew_started', { crew_id: crew.id, process: crew.config.process });

  let finalOutput: Output = null;
  const taskOutputs = new Map<string, { output: string | object; logs?: string[] }>();

  if (crew.config.verbose) {
    console.log(`

[Crew AI] Working Agent Assistants
-------------------------------
Agents:
${crew.config.agents.map((agent) => `  - ${agent.config.role}`).join('\n')}

Tasks:
${crew.config.tasks.map((task) => `  - ${task.config.description}`).join('\n')}
`);
  }

  try {
    if (crew.config.process === CrewProcess.SEQUENTIAL) {
      if (crew.config.verbose) {
        console.log('\n[Crew AI] Beginning Sequential Process...\n');
      }
      for (const task of crew.config.tasks) {
        let agentForExecution: Agent | undefined = task.config.agent;

        if (!agentForExecution) {
          // If task has no specific agent, and crew has agents, use the first one.
          if (crew.config.agents.length > 0) {
            agentForExecution = crew.config.agents[0];
            if (crew.config.verbose) {
              console.log(
                `Task "${task.config.description}" has no specific agent. Assigning first crew agent: ${agentForExecution.config.role}`
              );
            }
          } else {
            // This case should ideally be caught by createCrew validation if tasks require agents
            throw new Error(
              `Task "${task.config.description}" has no agent assigned, and there are no agents in the crew.`
            );
          }
        }

        if (crew.config.verbose) {
          console.log(
            `\nExecuting task: ${task.config.description} with agent: ${agentForExecution.config.role}`,
          );
        }

        await executeTask(task, agentForExecution);

        if (task.output !== undefined && task.output !== null) { // Check if output is set
          taskOutputs.set(task.id, { output: task.output, logs: task.logs });
          finalOutput = task.output;
        } else if (task.error) {
          throw new Error(`Task ${task.id} ("${task.config.description}") failed: ${task.error}`);
        }

        if (crew.config.verbose) {
          const outputToLog = typeof task.output === 'string' ? task.output : JSON.stringify(task.output);
          console.log(`\nTask Output: ${outputToLog}\n`);
        }
      }
    } else if (crew.config.process === CrewProcess.HIERARCHICAL) {
      if (crew.config.verbose) {
        console.log(
          '\n[Crew AI] Hierarchical process is not yet implemented. Running sequentially as fallback.\n',
        );
      }
      // Fallback to sequential logic for hierarchical process
      for (const task of crew.config.tasks) {
        let agentForExecution: Agent | undefined = task.config.agent;

        if (!agentForExecution) {
          if (crew.config.agents.length > 0) {
            agentForExecution = crew.config.agents[0];
            if (crew.config.verbose) {
              console.log(
                `Task "${task.config.description}" (hierarchical fallback) has no specific agent. Assigning first crew agent: ${agentForExecution.config.role}`
              );
            }
          } else {
            throw new Error(
              `Task "${task.config.description}" (hierarchical fallback) has no agent assigned, and there are no agents in the crew.`
            );
          }
        }
         if (crew.config.verbose) {
          console.log(
            `\nExecuting task (hierarchical fallback): ${task.config.description} with agent: ${agentForExecution.config.role}`,
          );
        }

        await executeTask(task, agentForExecution);

        if (task.output !== undefined && task.output !== null) { // Check if output is set
          taskOutputs.set(task.id, { output: task.output, logs: task.logs });
          finalOutput = task.output;
        } else if (task.error) {
          throw new Error(`Task ${task.id} ("${task.config.description}") (hierarchical fallback) failed: ${task.error}`);
        }

        if (crew.config.verbose) {
          const outputToLog = typeof task.output === 'string' ? task.output : JSON.stringify(task.output);
          console.log(`\nTask Output (hierarchical fallback): ${outputToLog}\n`);
        }
      }
    }

    crew.output = finalOutput;
    crew.tasksOutput = taskOutputs;
    crew.status = 'COMPLETED';
    sendTelemetry('crew_ended', { crew_id: crew.id, status: 'COMPLETED' });
  } catch (error) {
    crew.status = 'FAILED';
    // biome-ignore lint/suspicious/noExplicitAny: <explanation>
    crew.output = { error: (error as any).message }; // Storing the error message in output
    console.error(`Crew ${crew.id} failed:`, error);
    sendTelemetry('crew_ended', {
      crew_id: crew.id,
      status: 'FAILED',
      // biome-ignore lint/suspicious/noExplicitAny: <explanation>
      error: (error as any).message,
    });
  } finally {
    crew.completedAt = new Date();
    crew.updatedAt = new Date();
    if (crew.config.verbose) {
      console.log('\n[Crew AI] Crew Execution Complete.');
      console.log(`Final Output: ${JSON.stringify(crew.output, null, 2)}`);
    }
  }
}

// Exporting the enum if it's defined here, or ensure it's imported correctly
export { CrewProcess } from '../core';
