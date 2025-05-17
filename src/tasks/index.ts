// Task definitions for crew-ai-ts
import type { Agent } from '../agents';

export interface TaskConfig {
  description: string;
  expectedOutput: string;
  agent?: Agent;
  context?: string; // Data from other tasks, to be stringified or structured
  asyncExecution?: boolean;
  // Add other relevant properties from the Python version as we discover them
}

export class Task {
  description: string;
  expectedOutput: string;
  agent?: Agent;
  context?: string;
  asyncExecution: boolean;
  output?: string | object; // Task output
  private completed = false;

  constructor(config: TaskConfig) {
    this.description = config.description;
    this.expectedOutput = config.expectedOutput;
    this.agent = config.agent;
    this.context = config.context;
    this.asyncExecution = config.asyncExecution ?? false;
  }

  isCompleted(): boolean {
    return this.completed;
  }

  // Placeholder for task execution logic
  // This will typically involve the assigned agent executing the task description
  async execute(agentOverride?: Agent): Promise<string | object> {
    const executionAgent = agentOverride ?? this.agent;
    if (!executionAgent) {
      throw new Error(
        `Task '${this.description}' has no agent assigned and no agent was provided for execution.`,
      );
    }

    console.log(
      `Task '${this.description}' starting execution by agent ${executionAgent.role}. Expected output: ${this.expectedOutput}`,
    );

    // The agent would use its LLM and tools here
    const result = await executionAgent.executeTask(this.description, this.context);

    this.output = result;
    this.completed = true;
    console.log(
      `Task '${this.description}' finished by agent ${executionAgent.role}. Output: ${result}`,
    );
    return result;
  }
}
