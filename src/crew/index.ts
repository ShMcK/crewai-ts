// Crew definitions for crew-ai-ts
import type { Agent } from '../agents';
import type { Task } from '../tasks';
import { CrewProcess } from '../core';

export interface CrewConfig {
  agents: Agent[];
  tasks: Task[];
  process?: CrewProcess;
  verbose?: boolean | number; // number for log level, boolean for on/off
  // biome-ignore lint/suspicious/noExplicitAny: Placeholder for manager LLM type
  managerLlm?: any;
  shareCrew?: boolean; // For telemetry, as seen in Python crewAI
  // Add other relevant properties from the Python version
}

export class Crew {
  agents: Agent[];
  tasks: Task[];
  process: CrewProcess;
  verbose: boolean | number;
  // biome-ignore lint/suspicious/noExplicitAny: Placeholder for manager LLM instance type
  managerLlm?: any;
  shareCrew: boolean;
  // biome-ignore lint/suspicious/noExplicitAny: Output can be varied based on tasks
  output: any[] = [];

  constructor(config: CrewConfig) {
    if (!config.agents || config.agents.length === 0) {
      throw new Error('A crew must have at least one agent.');
    }
    if (!config.tasks || config.tasks.length === 0) {
      throw new Error('A crew must have at least one task.');
    }

    this.agents = config.agents;
    this.tasks = config.tasks;
    this.process = config.process ?? CrewProcess.SEQUENTIAL;
    this.verbose = config.verbose ?? false;
    this.managerLlm = config.managerLlm;
    this.shareCrew = config.shareCrew ?? false;

    // Basic validation: if tasks have agents, they must be part of the crew
    for (const task of this.tasks) {
      if (task.agent && !this.agents.includes(task.agent)) {
        throw new Error(
          `Task '${task.description}' is assigned to an agent '${task.agent.role}' not in this crew.`,
        );
      }
    }
  }

  // biome-ignore lint/suspicious/noExplicitAny: Kickoff output is an array of varied task results
  async kickoff(): Promise<any[]> {
    if (this.verbose) {
      console.log(`Crew starting with process: ${this.process}`);
    }

    this.output = []; // Reset output for new kickoff

    if (this.process === CrewProcess.SEQUENTIAL) {
      for (const task of this.tasks) {
        if (this.verbose) {
          console.log(`Crew progressing to task: ${task.description}`);
        }
        const agentForTask = task.agent ?? this.agents[0];
        if (!agentForTask) {
            throw new Error(`No agent available for task '${task.description}' in sequential process.`);
        }

        const taskResult = await task.execute(agentForTask);
        this.output.push(taskResult);

        if (this.verbose) {
          console.log(`Task '${task.description}' completed with result:`, taskResult);
        }
        // Future: Pass context/output to the next task if needed
      }
    } else if (this.process === CrewProcess.HIERARCHICAL) {
      // Placeholder for hierarchical process logic
      // This would likely involve the managerLlm, task delegation, etc.
      console.warn(
        'Hierarchical process is not yet implemented. Running tasks sequentially as a fallback.'
      );
      // Fallback to sequential for now
      for (const task of this.tasks) {
        const agentForTask = task.agent ?? this.agents[0];
         if (!agentForTask) {
            throw new Error(`No agent available for task '${task.description}' in hierarchical (fallback) process.`);
        }
        const taskResult = await task.execute(agentForTask);
        this.output.push(taskResult);
      }
    } else {
      throw new Error(`Unsupported crew process: ${this.process}`);
    }

    if (this.verbose) {
      console.log('Crew kickoff complete. Final output:', this.output);
    }

    if (this.shareCrew) {
      this.sendTelemetry();
    }

    return this.output;
  }

  private sendTelemetry() {
    // Placeholder for telemetry logic
    // This would collect data as described in the crewAI Python documentation
    if (this.verbose) {
      console.log('Telemetry: Sharing crew data (placeholder).');
    }
    const telemetryData = {
      agentsCount: this.agents.length,
      tasksCount: this.tasks.length,
      process: this.process,
      // In a real scenario, more detailed (but anonymized or consented) data would be sent.
    };
    console.log('Telemetry Data (simulated):', telemetryData);
    // Actual telemetry sending logic would go here (e.g., using OpenTelemetry)
  }
}
