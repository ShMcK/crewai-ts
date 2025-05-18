// Task definitions for crew-ai-ts
import { type Agent, performAgentTask } from '../agents';
import { v4 as uuidv4 } from 'uuid';
import type { z, ZodTypeAny } from 'zod';

// Task Configuration (Input to create a task)
export interface TaskConfig {
  description: string;
  expectedOutput: string;
  agent?: Agent; // Agent who is preferred/assigned to perform the task
  context?: string; // Data from other tasks or initial context
  asyncExecution?: boolean; // Hint for the crew on how to run this
  outputSchema?: ZodTypeAny; // Use ZodTypeAny
  // Example of a potential future config property:
  // toolNames?: string[]; // Specify tools required/allowed for this task
}

// Task State (Represents a task instance with its current state)
export interface Task {
  readonly id: string; // Unique identifier for the task instance
  readonly config: TaskConfig; // The original configuration

  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
  output: unknown | null; // Use unknown
  parsedOutput?: unknown | null; // Use unknown
  validationError?: z.ZodError | null; // For Zod validation errors
  error: string | object | null; // Error message if the task failed
  logs: string[]; // For capturing execution logs specific to this task run
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

// Factory function to create a new task instance
export function createTask(config: TaskConfig): Task {
  return {
    id: uuidv4(),
    config,
    status: 'pending',
    output: null, // Initialize output to null
    parsedOutput: null, // Initialize parsedOutput to null
    validationError: null, // Initialize validationError to null
    error: null, // Initialize error to null
    logs: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// Function to execute a task
// This function mutates the task object with the result and status.
// It requires an agent to perform the execution.
export async function executeTask(
  task: Task,
  agentForExecution: Agent, // The agent that will execute this task
): Promise<void> {
  // Prevent re-execution of already completed or currently non-async in-progress tasks
  if (task.status === 'completed' || (task.status === 'in_progress' && !task.config.asyncExecution)) {
    const message = `Task execution skipped: Task '${task.config.description}' (ID: ${task.id}) is already ${task.status}.`;
    task.logs.push(`[${new Date().toISOString()}] ${message}`);
    console.warn(message);
    return;
  }

  task.status = 'in_progress';
  task.startedAt = new Date();
  const startTime = task.startedAt.toISOString();
  task.logs.push(`[${startTime}] Task starting. Agent: ${agentForExecution.config.role} (ID: ${agentForExecution.id}).`);
  console.log(
    `Task '${task.config.description}' (ID: ${task.id}) starting execution by agent ${agentForExecution.config.role} (ID: ${agentForExecution.id}). Expected output: ${task.config.expectedOutput}`,
  );

  try {
    const result = await performAgentTask(agentForExecution, task.config.description, task.config.context);
    task.output = result;

    // Perform Zod validation if outputSchema is provided
    if (task.config.outputSchema) {
      const parseResult = task.config.outputSchema.safeParse(task.output);
      if (parseResult.success) {
        task.parsedOutput = parseResult.data;
        task.validationError = null;
        task.logs.push(`[${new Date().toISOString()}] Task output successfully validated against schema.`);
        if (agentForExecution.config.verbose) {
          console.log(`Task output for "${task.config.description}" (ID: ${task.id}) successfully validated. Parsed data available.`);
        }
      } else {
        task.parsedOutput = null;
        task.validationError = parseResult.error;
        const errorDetail = parseResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ');
        task.logs.push(`[${new Date().toISOString()}] Task output validation failed: ${errorDetail}`);
        console.warn(
          `Task output validation failed for "${task.config.description}" (ID: ${task.id}). Errors: ${errorDetail}. Raw output is still available.`
        );
      }
    } else {
      task.parsedOutput = null;
      task.validationError = null;
    }

    task.status = 'completed';
    task.completedAt = new Date();
    const endTime = task.completedAt.toISOString();
    task.logs.push(
      `[${endTime}] Task completed. Output: ${typeof task.output === 'string' ? task.output : JSON.stringify(task.output)}`
    );
    console.log(
      `Task '${task.config.description}' (ID: ${task.id}) finished by agent ${agentForExecution.config.role} (ID: ${agentForExecution.id}). Output: ${task.output}`,
    );

  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    task.status = 'failed';
    task.error = error.message;
    task.output = null;
    task.parsedOutput = null;
    task.validationError = null;
    task.completedAt = new Date();
    const endTime = task.completedAt.toISOString();
    task.logs.push(`[${endTime}] Task failed. Error: ${error.message}`);
    console.error(
      `Task '${task.config.description}' (ID: ${task.id}) failed execution by agent ${agentForExecution.config.role} (ID: ${agentForExecution.id}). Error: ${task.error}`,
    );
    throw error;
  }
}

// Helper functions to check task status (Restored)
export function isTaskCompleted(task: Task): boolean {
  return task.status === 'completed';
}

export function hasTaskFailed(task: Task): boolean {
  return task.status === 'failed';
}

export function isTaskPending(task: Task): boolean {
  return task.status === 'pending';
}

export function isTaskInProgress(task: Task): boolean {
  return task.status === 'in_progress';
}