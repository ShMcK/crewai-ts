// Crew definitions for crew-ai-ts
import type { Agent } from '../agents';
import type { Task } from '../tasks';
import { CrewProcess } from '../core';
import { v4 as uuidv4 } from 'uuid';
import { executeTask } from '../tasks';
import {
  type ChatLLM,
  type OpenAIConfig,
  createOpenAIChatClient,
  type ChatMessage,
} from '../llms'; // Import necessary LLM types and factory

// biome-ignore lint/suspicious/noExplicitAny: <explanation>
type Output = any; // Placeholder

export interface CrewConfig {
  agents: Agent[];
  tasks: Task[];
  process?: CrewProcess;
  verbose?: boolean | number;
  managerLlm?: ChatLLM | OpenAIConfig; // Allow instantiated or config for manager
  shareCrew?: boolean;
}

export interface Crew {
  id: string;
  config: CrewConfig; // Holds the original config
  managerLlmInstance?: ChatLLM; // Instantiated manager LLM for hierarchical
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  // biome-ignore lint/suspicious/noExplicitAny: <explanation>
  output: any;
  tasksOutput: Map<string, { output: string | object; logs?: string[] }>;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

interface ManagerDecision {
    taskIdToDelegate: string;
    agentIdToAssign: string;
    additionalContextForAgent?: string;
}

export function createCrew(config: CrewConfig): Crew {
  if (!config.agents || config.agents.length === 0) {
    throw new Error('Crew creation failed: No agents provided.');
  }
  if (!config.tasks || config.tasks.length === 0) {
    throw new Error('Crew creation failed: No tasks provided.');
  }

  // Ensure default process if not specified, and store it in the config being saved.
  if (config.process === undefined) {
    config.process = CrewProcess.SEQUENTIAL;
  }
  const crewProcess = config.process; // Now it's definitely set

  // Ensure default verbosity if not specified
  if (config.verbose === undefined) {
    config.verbose = false;
  }

  for (const task of config.tasks) {
    if (task.config.agent && !config.agents.some(a => a.id === task.config.agent?.id)) {
      throw new Error(
        `Task "${task.config.description}" is configured with an agent (ID: ${task.config.agent.id}, Role: ${task.config.agent.config.role}) that is not part of the provided crew agents list.`
      );
    }
  }

  let instantiatedManagerLlm: ChatLLM | undefined;

  if (crewProcess === CrewProcess.HIERARCHICAL) {
    if (!config.managerLlm) {
      throw new Error(
        'Crew creation failed: Hierarchical process requires a managerLlm to be configured.',
      );
    }
    if ('apiKey' in config.managerLlm && 'modelName' in config.managerLlm && !('chat' in config.managerLlm)) {
      // It looks like an OpenAIConfig, try to instantiate it.
      // This check can be expanded for other LLM config types in the future.
      try {
        instantiatedManagerLlm = createOpenAIChatClient(config.managerLlm as OpenAIConfig);
      } catch (e) {
        throw new Error(`Failed to create manager LLM for hierarchical crew: ${e instanceof Error ? e.message : String(e)}`);
      }
    } else if (config.managerLlm && ('chat' in config.managerLlm || 'invoke' in config.managerLlm)) {
      // It's already an instantiated LLM object that conforms to ChatLLM or LLM
      instantiatedManagerLlm = config.managerLlm as ChatLLM;
    } else {
       throw new Error(
        'Crew creation failed: managerLlm for hierarchical process is not a recognized LLM instance or known config type (e.g., OpenAIConfig).',
      );
    }
    if (!instantiatedManagerLlm) { // Should be caught by earlier checks, but as a safeguard
        throw new Error('Manager LLM could not be instantiated for hierarchical process.');
    }
  }

  return {
    id: uuidv4(),
    config, // Store the original config
    managerLlmInstance: instantiatedManagerLlm,
    status: 'PENDING',
    output: null,
    tasksOutput: new Map(),
    createdAt: new Date(),
    updatedAt: new Date(),
    // process is part of config, no need to duplicate it here at top level of Crew object
  };
}

// Placeholder for telemetry
// biome-ignore lint/suspicious/noExplicitAny: <explanation>
function sendTelemetry(event: string, payload?: any): void {
  if (process.env.NODE_ENV !== 'test') {
    // console.log(`Telemetry: ${event}`, payload);
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
  const currentProcess = crew.config.process ?? CrewProcess.SEQUENTIAL;

  if (crew.config.verbose) {
    console.log(`

[Crew AI] Working Agent Assistants
-------------------------------
Process: ${currentProcess}
Agents:
${crew.config.agents.map((agent) => `  - ${agent.config.role} (ID: ${agent.id})`).join('\n')}

Tasks:
${crew.config.tasks.map((task) => `  - ${task.config.description} (ID: ${task.id})`).join('\n')}
`);
    if (currentProcess === CrewProcess.HIERARCHICAL && crew.managerLlmInstance) {
        console.log(`Manager LLM: ${crew.managerLlmInstance.providerName} - ${crew.managerLlmInstance.id}`);
    }
  }

  try {
    if (currentProcess === CrewProcess.SEQUENTIAL) {
      if (crew.config.verbose) {
        console.log('\n[Crew AI] Beginning Sequential Process...\n');
      }
      for (const task of crew.config.tasks) {
        let agentForExecution: Agent | undefined = task.config.agent;
        if (!agentForExecution) {
          if (crew.config.agents.length > 0) {
            agentForExecution = crew.config.agents[0];
            if (crew.config.verbose) {
              console.log(
                `Task "${task.config.description}" has no specific agent. Assigning first crew agent: ${agentForExecution.config.role}`
              );
            }
          } else {
            throw new Error(
              `Task "${task.config.description}" has no agent assigned, and there are no agents in the crew.`
            );
          }
        }
        if (crew.config.verbose) {
          console.log(
            `\nExecuting task: ${task.config.description} (ID: ${task.id}) with agent: ${agentForExecution.config.role} (ID: ${agentForExecution.id})`,
          );
        }
        await executeTask(task, agentForExecution);
        if (task.output !== undefined && task.output !== null) {
          taskOutputs.set(task.id, { output: task.output, logs: task.logs });
          finalOutput = task.output;
        } else if (task.error) {
          throw new Error(`Task ${task.id} ("${task.config.description}") failed: ${task.error}`);
        }
        if (crew.config.verbose) {
          const outputToLog = typeof task.output === 'string' ? task.output : JSON.stringify(task.output);
          console.log(`\nTask Output (ID: ${task.id}): ${outputToLog}\n`);
        }
      }
    } else if (currentProcess === CrewProcess.HIERARCHICAL) {
      if (!crew.managerLlmInstance) {
        // This should ideally be caught by createCrew, but as a safeguard during run.
        throw new Error('Hierarchical process selected, but manager LLM is not available on the crew.');
      }
      if (crew.config.verbose) {
        console.log('\n[Crew AI] Beginning Hierarchical Process...\n');
      }

      // --- HIERARCHICAL LOGIC --- 
      // This will be complex and iterative.
      // For now, a very simplified placeholder.
      const managerLlm = crew.managerLlmInstance;
      let iterationCount = 0;
      const maxIterations = crew.config.tasks.length + 10; // Allow more iterations, e.g., for retries

      // Map to store attempt details: status ('pending', 'failed', 'completed'), error, lastAgentId
      const taskAttemptInfo = new Map<string, {
          status: 'pending' | 'failed' | 'completed';
          error?: string;
          lastAgentId?: string;
          lastAttemptIteration?: number;
      }>();
      for (const task of crew.config.tasks) {
        taskAttemptInfo.set(task.id, { status: 'pending' });
      }

      // Function to get tasks that are not yet completed
      const getNonCompletedTasks = () => crew.config.tasks.filter(
          task => taskAttemptInfo.get(task.id)?.status !== 'completed'
      );

      while (getNonCompletedTasks().length > 0 && iterationCount < maxIterations) {
        iterationCount++;
        const currentRemainingTasks = getNonCompletedTasks();

        if (crew.config.verbose) {
          console.log(`
--- Manager Iteration: ${iterationCount} ---
Tasks not yet completed: ${currentRemainingTasks.length}
`);
        }

        // Create a prompt for the manager LLM
        const agentsDescription = crew.config.agents
          .map(a => `- ${a.config.role}: ${a.config.goal} (Tools: ${a.tools.map(t=>t.name).join(', ') || 'none'}) (ID: ${a.id})`)
          .join('\n');
        
        const availableTasksDescription = currentRemainingTasks
          .map(t => {
            const attempt = taskAttemptInfo.get(t.id);
            let statusMarker = '';
            if (attempt?.status === 'failed') {
              statusMarker = ` (Last attempt failed by agent ${attempt.lastAgentId || 'N/A'}. Error: ${attempt.error || 'Unknown error'})`;
            }
            return `- ${t.config.description} (Expected Output: ${t.config.expectedOutput}) (ID: ${t.id})${statusMarker}`;
          })
          .join('\n');

        const completedTasksSummary = Array.from(taskOutputs.entries())
            .filter(([, taskResult]) => !(taskResult.output && typeof taskResult.output === 'object' && 'error' in taskResult.output))
            .map(([taskId, taskResult]) => `Task ${taskId} output: ${typeof taskResult.output === 'string' ? taskResult.output : JSON.stringify(taskResult.output)}`)
            .join('\n') || 'No tasks completed successfully yet.';
        
        const recentlyFailedTasksFeedback = crew.config.tasks
            .map(task => taskAttemptInfo.get(task.id))
            .filter(attempt => attempt?.status === 'failed' && attempt.lastAttemptIteration === iterationCount -1) // Failed in the *immediately previous* iteration
            .map(attempt => {
                const task = crew.config.tasks.find(t => taskAttemptInfo.get(t.id) === attempt); // Find task for description
                return task ? `  - Task ID ${task.id} ("${task.config.description}") failed with error: ${attempt?.error}. Attempted by Agent ID ${attempt?.lastAgentId}.` : '';
            }).filter(Boolean).join('\n');

        const managerPrompt = `
As the project manager, your goal is to successfully complete all assigned tasks by orchestrating a team of agents.

Available Agents:
${agentsDescription}

Tasks to be Actioned (either pending or previously failed and needing retry):
${availableTasksDescription}

${recentlyFailedTasksFeedback ? `Context on Recently Failed Tasks (from last iteration):
${recentlyFailedTasksFeedback}
You should consider these failures when delegating.` : ''}

Completed Tasks Summary:
${completedTasksSummary}

Based on the available tasks, agent capabilities, and any recent failures, decide the next single task to delegate and to which agent.
Consider if a previously failed task should be retried (perhaps with a different agent or modified context if you provide one).
If all tasks are completed, or you believe the goal is met based on the completed tasks, respond with "ALL_TASKS_COMPLETED".
Otherwise, respond in the following JSON format ONLY:
{
  "taskIdToDelegate": "<id_of_the_task_to_delegate_from_the_Tasks_to_be_Actioned_list>",
  "agentIdToAssign": "<id_of_the_agent_to_assign_the_task>",
  "additionalContextForAgent": "<any_specific_instructions_or_context_for_the_agent_for_this_task, especially if retrying a failed task>"
}
Ensure the IDs are exact from the lists provided.
`;

        if (crew.config.verbose) {
          console.log(`Manager LLM Prompt:
${managerPrompt.substring(0, 500)}...
`);
        }

        const managerMessages: ChatMessage[] = [{ role: 'user', content: managerPrompt }];
        const managerResponse = await managerLlm.chat(managerMessages);
        const managerDecisionText = managerResponse.content;

        if (crew.config.verbose) {
          console.log(`Manager LLM Response:
${managerDecisionText}
`);
        }

        if (managerDecisionText.includes('ALL_TASKS_COMPLETED')) {
          if (crew.config.verbose) console.log('Manager decided all tasks are completed.');
          break; 
        }

        let parsedDecision: ManagerDecision;
        try {
          // Extract JSON part if LLM includes other text
          const jsonMatch = managerDecisionText.match(/\{.*\}/s);
          if (!jsonMatch || !jsonMatch[0]) throw new Error('No JSON object found in manager response');
          parsedDecision = JSON.parse(jsonMatch[0]) as ManagerDecision;
        } catch (e) {
          console.error('Failed to parse manager decision JSON:', e, 'Raw response:', managerDecisionText);
          // In a real scenario, might retry with manager or ask for clarification.
          // For now, we'll break the loop or throw an error.
          finalOutput = { error: 'Manager LLM response was not valid JSON.', details: managerDecisionText };
          throw new Error(`Manager LLM response was not valid JSON. Details: ${managerDecisionText.substring(0,100)}...`);
        }

        const { taskIdToDelegate, agentIdToAssign, additionalContextForAgent } = parsedDecision;

        const taskToExecute = currentRemainingTasks.find(t => t.id === taskIdToDelegate);
        const agentForExecution = crew.config.agents.find(a => a.id === agentIdToAssign);

        if (!taskToExecute) {
          console.error(`Manager designated task ID ${taskIdToDelegate} not found among actionable tasks or already successfully completed.`);
          // Potentially ask manager to reconsider or throw error
          // For now, we'll log and let the manager try again in the next iteration.
          // To avoid an immediate loop if the manager is stuck, we could add a specific error message to taskOutputs for this iteration.
          taskOutputs.set(`manager_error_iteration_${iterationCount}`, { output: { error: `Manager designated task ID ${taskIdToDelegate} not found or not actionable.` } });
          // No break, let manager retry. If LLM is bad, maxIterations will catch it.
          continue; 
        }
        if (!agentForExecution) {
          console.error(`Manager designated agent ID ${agentIdToAssign} not found.`);
          taskOutputs.set(`manager_error_iteration_${iterationCount}`, { output: { error: `Manager designated agent ID ${agentIdToAssign} not found.` } });
          // No break, let manager retry.
          continue;
        }

        // Augment task context if manager provided any
        if (additionalContextForAgent) {
            taskToExecute.config.context = taskToExecute.config.context 
                ? `${taskToExecute.config.context}\nManager Context: ${additionalContextForAgent}`
                : `Manager Context: ${additionalContextForAgent}`;
        }

        if (crew.config.verbose) {
          console.log(
            `\nManager delegating Task ID: ${taskToExecute.id} ("${taskToExecute.config.description}") to Agent ID: ${agentForExecution.id} (${agentForExecution.config.role})`,
          );
        }

        await executeTask(taskToExecute, agentForExecution); // This mutates taskToExecute

        if (taskToExecute.output !== undefined && taskToExecute.output !== null) {
          taskOutputs.set(taskToExecute.id, { output: taskToExecute.output, logs: taskToExecute.logs });
          taskAttemptInfo.set(taskToExecute.id, { status: 'completed', lastAttemptIteration: iterationCount });
          finalOutput = taskToExecute.output; // Hierarchical output logic might be more complex
          if (crew.config.verbose) {
             const outputToLog = typeof taskToExecute.output === 'string' ? taskToExecute.output : JSON.stringify(taskToExecute.output);
             console.log(`\nTask Output (ID: ${taskToExecute.id}): ${outputToLog}\n`);
          }
        } else if (taskToExecute.error) {
          // Inform manager about task failure?
          console.error(`Task ${taskToExecute.id} ("${taskToExecute.config.description}") failed: ${taskToExecute.error}. Agent: ${agentForExecution.id}. Will be available for retry.`);
          taskOutputs.set(taskToExecute.id, { output: { error: taskToExecute.error, agentId: agentForExecution.id }, logs: taskToExecute.logs });
          taskAttemptInfo.set(taskToExecute.id, { 
            status: 'failed', 
            error: taskToExecute.error, 
            lastAgentId: agentForExecution.id,
            lastAttemptIteration: iterationCount 
          });
          // Task remains in currentRemainingTasks (implicitly, as it's not 'completed') for the manager to potentially re-assign in the next iteration.
        }

        // Remove the (just attempted) task from remainingTasks // THIS LOGIC IS NOW HANDLED BY getNonCompletedTasks and taskAttemptInfo
        // remainingTasks = remainingTasks.filter(t => t.id !== taskToExecute.id); // OLD LOGIC
      }

      // After loop, check if all tasks were actually completed
      const allTasksCompleted = getNonCompletedTasks().length === 0;

      if (!allTasksCompleted && iterationCount >= maxIterations) {
        console.warn('Hierarchical crew reached max iterations before completing all tasks.');
        if (!finalOutput || Object.keys(finalOutput).length === 0) { // Avoid overwriting a partial finalOutput from a task
            finalOutput = { 
                warning: 'Max iterations reached in hierarchical process.', 
                remainingTasks: getNonCompletedTasks().map(t => ({id: t.id, description: t.config.description, status: taskAttemptInfo.get(t.id)?.status }))
            };
        }
      }
      
      // --- START: Phase 2: Manager's Final Summary/Output (Feature B) ---
      if (allTasksCompleted && taskOutputs.size > 0 && managerLlm) {
        if (crew.config.verbose) {
          console.log('\n[Crew AI] All tasks completed. Requesting final summary from manager LLM...');
        }
        const successfulTaskOutputsSummary = Array.from(taskOutputs.entries())
          .filter(([, result]) => !(result.output && typeof result.output === 'object' && 'error' in result.output))
          .map(([taskId, result]) => {
            const task = crew.config.tasks.find(t => t.id === taskId);
            return `Task: ${task?.config.description || taskId}
Output: ${typeof result.output === 'string' ? result.output : JSON.stringify(result.output)}`;
          })
          .join('\n\n');

        if (successfulTaskOutputsSummary) {
          const finalSummaryPrompt = `
All assigned tasks have been completed. Based on the following task outputs, please provide a comprehensive final summary or answer that fulfills the overall crew objective.

Summary of Successfully Completed Task Outputs:
${successfulTaskOutputsSummary}

Crew Objective (inferred from tasks): [Consider dynamically generating a crew objective summary if not explicitly provided in CrewConfig later]
Based on the provided outputs, synthesize the final result.
`;
          try {
            const summaryMessages: ChatMessage[] = [{ role: 'user', content: finalSummaryPrompt }];
            if (crew.config.verbose) {
                console.log(`Manager LLM Final Summary Prompt:
${finalSummaryPrompt.substring(0,500)}...
`);
            }
            const summaryResponse = await managerLlm.chat(summaryMessages);
            finalOutput = summaryResponse.content; // Manager's summarized output
            if (crew.config.verbose) {
                console.log(`Manager LLM Final Summary Response:
${finalOutput}
`);
            }
          } catch (e) {
            console.error('Failed to get final summary from manager LLM:', e);
            // finalOutput would remain as the output of the last task, or the warning if max iterations hit.
            // Add this error to the crew's output.
             const existingError = (finalOutput && typeof finalOutput === 'object' && finalOutput.error) ? `${finalOutput.error}; ` : '';
             finalOutput = { 
                ...(typeof finalOutput === 'object' ? finalOutput : { previousOutput: finalOutput }),
                error: `${existingError}Failed to get final summary from manager: ${e instanceof Error ? e.message : String(e)}`
             };
          }
        } else {
            if (crew.config.verbose) {
                console.log('No successful task outputs to summarize by manager.');
            }
            // if finalOutput is null or only contains a warning, set a completion message.
            if (!finalOutput || (typeof finalOutput === 'object' && 'warning' in finalOutput && Object.keys(finalOutput).length === 1)) {
                 finalOutput = "All tasks processed, but no specific outputs were generated or all failed.";
            }
        }
      } else if (crew.config.verbose && managerLlm && taskOutputs.size === 0) {
          console.log('\n[Crew AI] Hierarchical process finished, but no task outputs were recorded to summarize.');
      } else if (crew.config.verbose && managerLlm && !allTasksCompleted) {
          console.log('\n[Crew AI] Hierarchical process finished, but not all tasks were completed. Skipping manager summary.');
      }
      // --- END: Phase 2 ---

      if (crew.config.verbose) console.log('Hierarchical process finished.');
    }

    crew.output = finalOutput;
    crew.tasksOutput = taskOutputs;
    crew.status = 'COMPLETED';
    sendTelemetry('crew_ended', { crew_id: crew.id, status: 'COMPLETED' });
  } catch (error) {
    crew.status = 'FAILED';
    const errorMessage = error instanceof Error ? error.message : String(error);
    crew.output = { error: errorMessage };
    console.error(`Crew ${crew.id} failed:`, error);
    sendTelemetry('crew_ended', {
      crew_id: crew.id,
      status: 'FAILED',
      error: errorMessage,
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

export { CrewProcess } from '../core';
