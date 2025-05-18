// Task definitions for crew-ai-ts
import { type Agent, performAgentTask } from '../agents';
import { v4 as uuidv4 } from 'uuid';
import type { z } from 'zod';
import * as fs from 'node:fs'; // Import fs module with node: protocol
import * as path from 'node:path'; // Import path module with node: protocol
import type { Tool } from '../tools'; // Ensure ToolContext is imported if used by tools

export enum TaskStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  FAILED = 'failed',
  SKIPPED = 'skipped',
}

// Task Configuration (Input to create a task)
export interface TaskConfig {
  description: string;
  expectedOutput: string;
  agent?: Agent; // Agent who is preferred/assigned to perform the task
  context?: string | Task[]; // Context can be a string or an array of previous Tasks
  tools?: Tool<unknown, unknown>[];
  outputSchema?: z.ZodSchema<unknown>; // For Zod schema based output parsing
  humanInput?: boolean; // Placeholder for human input feature
  asyncExecution?: boolean; // Hint for the crew on how to run this
  outputFile?: string; // Path to save the task output
  // Example of a potential future config property:
  // toolNames?: string[]; // Specify tools required/allowed for this task
}

// Task State (Represents a task instance with its current state)
export interface Task {
  readonly id: string; // Unique identifier for the task instance
  readonly config: TaskConfig; // The original configuration

  status: TaskStatus;
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
    status: TaskStatus.PENDING,
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
  if (task.status === TaskStatus.COMPLETED || task.status === TaskStatus.SKIPPED || (task.status === TaskStatus.IN_PROGRESS && !task.config.asyncExecution)) {
    const message = `Task execution skipped: Task '${task.config.description}' (ID: ${task.id}) is already ${task.status}.`;
    task.logs.push(`[${new Date().toISOString()}] ${message}`);
    console.warn(message);
    return;
  }

  task.status = TaskStatus.IN_PROGRESS;
  task.startedAt = new Date();
  const startTime = task.startedAt.toISOString();
  task.logs.push(`[${startTime}] Task starting. Agent: ${agentForExecution.config.role} (ID: ${agentForExecution.id}).`);
  console.log(
    `Task '${task.config.description}' (ID: ${task.id}) starting execution by agent ${agentForExecution.config.role} (ID: ${agentForExecution.id}). Expected output: ${task.config.expectedOutput}`,
  );

  try {
    // Determine context for the agent
    let agentContext = '';
    if (typeof task.config.context === 'string') {
      agentContext = task.config.context;
    } else if (Array.isArray(task.config.context)) {
      // This case implies task.config.context was already resolved to Task[] with outputs
      // However, executeTask typically receives a stringified context from runCrew.
      // For safety, if it's still Task[], we stringify their descriptions and outputs (if available)
      agentContext = task.config.context.map(prevTask => {
        let outputStr = 'Output not available or task not run.';
        if (prevTask.output !== null && prevTask.output !== undefined) {
          outputStr = typeof prevTask.output === 'string' ? prevTask.output : JSON.stringify(prevTask.output);
        }
        return `Previous Task: ${prevTask.config.description}\nOutput: ${outputStr}`;
      }).join('\n\n---\n');
    }
    const rawOutput = await performAgentTask(agentForExecution, task.config.description, agentContext || undefined);
    task.output = rawOutput;
    task.logs.push(`[${new Date().toISOString()}] Raw output received from agent.`);

    // Output parsing if schema is provided
    if (task.config.outputSchema) {
      const parseResult = task.config.outputSchema.safeParse(rawOutput);
      if (parseResult.success) {
        task.parsedOutput = parseResult.data;
        task.validationError = null;
        task.logs.push(`[${new Date().toISOString()}] Output successfully parsed and validated against schema.`);
        if (agentForExecution.config.verbose) {
          console.log(`Task output for "${task.config.description}" (ID: ${task.id}) successfully validated. Parsed data available.`);
        }
      } else {
        task.parsedOutput = null; // Store raw output in task.output, but parsed is null due to error
        task.validationError = parseResult.error;
        const errorDetail = parseResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ');
        task.logs.push(`[${new Date().toISOString()}] Output parsing/validation failed: ${errorDetail}`);
        console.warn(
          `Task output validation failed for "${task.config.description}" (ID: ${task.id}). Errors: ${errorDetail}. Raw output is still available.`
        );
      }
    } else {
      task.parsedOutput = null;
      task.validationError = null;
    }

    task.status = TaskStatus.COMPLETED;
    task.completedAt = new Date();
    const endTime = task.completedAt.toISOString();
    task.logs.push(
      `[${endTime}] Task completed. Output: ${typeof task.output === 'string' ? task.output : JSON.stringify(task.output)}`
    );
    console.log(
      `Task '${task.config.description}' (ID: ${task.id}) finished by agent ${agentForExecution.config.role} (ID: ${agentForExecution.id}). Output: ${task.output}`,
    );

    // Save output to file if specified
    if (task.config.outputFile) {
      const outputToSave =
        task.parsedOutput !== null &&
        task.parsedOutput !== undefined &&
        !task.validationError
          ? task.parsedOutput
          : task.output;
      try {
        const filePath = path.resolve(task.config.outputFile);
        const dirPath = path.dirname(filePath);
        if (!fs.existsSync(dirPath)) {
          fs.mkdirSync(dirPath, { recursive: true });
          task.logs.push(`[${new Date().toISOString()}] Created directory for output file: ${dirPath}`);
        }
        fs.writeFileSync(filePath, JSON.stringify(outputToSave, null, 2));
        task.logs.push(`[${new Date().toISOString()}] Task output saved to ${filePath}`);
        console.log(`Task output for "${task.config.description}" (ID: ${task.id}) saved to ${filePath}`);
      } catch (fileError: unknown) {
        const fileErrorMessage = fileError instanceof Error ? fileError.message : String(fileError);
        task.logs.push(
          `[${new Date().toISOString()}] Failed to save task output to ${task.config.outputFile}. Error: ${fileErrorMessage}`,
        );
        console.warn(
          `Failed to save task output for "${task.config.description}" (ID: ${task.id}) to ${task.config.outputFile}. Error: ${fileErrorMessage}`,
        );
      }
    }

  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    task.status = TaskStatus.FAILED;
    task.error = error.message;
    task.output = null; // Ensure output is nulled on failure
    task.parsedOutput = null; // Ensure parsedOutput is nulled
    task.validationError = null; // Ensure validationError is nulled
    task.completedAt = new Date();
    const endTime = task.completedAt.toISOString();
    task.logs.push(`[${endTime}] Task failed. Error: ${error.message}`);
    console.error(
      `Task '${task.config.description}' (ID: ${task.id}) failed execution by agent ${agentForExecution.config.role} (ID: ${agentForExecution.id}). Error: ${task.error}`,
    );
    throw error; // Re-throw the error so the crew can handle it
  }
}

// Helper functions to check task status
export function isTaskCompleted(task: Task): boolean {
  return task.status === TaskStatus.COMPLETED;
}

export function hasTaskFailed(task: Task): boolean {
  return task.status === TaskStatus.FAILED;
}

export function isTaskPending(task: Task): boolean {
  return task.status === TaskStatus.PENDING;
}

export function isTaskInProgress(task: Task): boolean {
  return task.status === TaskStatus.IN_PROGRESS;
}