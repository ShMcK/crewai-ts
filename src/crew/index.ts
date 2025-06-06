// Crew definitions for crew-ai-ts
import type { Agent } from '../agents';
import type { Task } from '../tasks';
import { TaskStatus } from '../tasks';
import { CrewProcess } from '../core';
import { v4 as uuidv4 } from 'uuid';
import { executeTask } from '../tasks';
import {
  type ChatLLM,
  createOpenAIChatClient,
  type ChatMessage,
  type LLMProviderConfig,
  createAnthropicChatClient,
  isOpenAIConfig,
  isAnthropicConfig
} from '../llms'; // Import necessary LLM types and factory
import { performAgentTask } from '../agents';
import type { z } from 'zod'; // Add Zod import

// biome-ignore lint/suspicious/noExplicitAny: <explanation>
type Output = any; // Placeholder

export interface CrewConfig {
  agents: Agent[];
  tasks: Task[];
  process?: CrewProcess;
  verbose?: boolean | number;
  managerLlm?: ChatLLM | LLMProviderConfig | Agent; // Use LLMProviderConfig
  objective?: string;
  shareCrew?: boolean;
}

export interface TaskOutputDetail {
  output: unknown;
  parsedOutput?: unknown;
  validationError?: z.ZodError | null;
  error?: string | object | null;
  logs: string[];
}

export interface Crew {
  id: string;
  config: CrewConfig;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  output: unknown | null; // Changed to unknown | null
  tasksOutput: Map<string, TaskOutputDetail>; // Use the new interface
  managerLlmInstance?: ChatLLM;
  managerAgentInstance?: Agent;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  telemetryEnabled?: boolean; // Assuming this might be added later for telemetry
}

// Type for tracking manager's attempts on tasks
interface TaskAttemptInfoValue {
  status: TaskStatus | 'failed_terminal' | 'skipped'; // Use Enum, add manager-specific ones for its logic
  error?: string;
  lastAgentId?: string;
  lastAttemptIteration?: number;
  attempts: number;
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
  let instantiatedManagerAgent: Agent | undefined;

  if (crewProcess === CrewProcess.HIERARCHICAL) {
    if (!config.managerLlm) {
      throw new Error(
        'Crew creation failed: Hierarchical process requires a managerLlm or manager Agent to be configured.',
      );
    }

    const managerInput = config.managerLlm;

    // Check 1: Is it an Agent instance?
    if (managerInput && typeof (managerInput as Agent).config?.role === 'string' && Array.isArray((managerInput as Agent).tools)) {
      instantiatedManagerAgent = managerInput as Agent;
    } 
    // Check 2: Is it an already instantiated ChatLLM instance (but not an Agent)?
    else if (
      managerInput &&
      (typeof (managerInput as ChatLLM).chat === 'function' || typeof (managerInput as ChatLLM).invoke === 'function') &&
      !(typeof (managerInput as Agent).config?.role === 'string' && Array.isArray((managerInput as Agent).tools))
    ) {
      instantiatedManagerLlm = managerInput as ChatLLM;
    } 
    // Check 3: Is it a known LLMProviderConfig that needs instantiation?
    else if (
      managerInput && 
      !('chat' in managerInput) && !('invoke' in managerInput) && // Not already instantiated
      'apiKey' in managerInput && 'modelName' in managerInput      // Common properties for our configs
    ) {
      const providerConfig = managerInput as LLMProviderConfig;
      try {
        if (isOpenAIConfig(providerConfig)) {
          instantiatedManagerLlm = createOpenAIChatClient(providerConfig);
        } else if (isAnthropicConfig(providerConfig)) {
          instantiatedManagerLlm = createAnthropicChatClient(providerConfig);
        } else {
          throw new Error(
            `Crew creation failed: managerLlm for hierarchical process is an unrecognized LLMProviderConfig. Config keys: ${Object.keys(providerConfig).join(', ')}`
          );
        }
      } catch (e) {
        throw new Error(
          `Crew creation failed: Could not instantiate managerLlm from the provided config. Error: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    } 
    else {
      let inputType = 'unknown type';
      if (managerInput && typeof managerInput === 'object') {
        // Convert managerInput to object to access Object.keys without TS complaining for union types
        const managerInputAsObject = managerInput as object;
        inputType = `${Object.keys(managerInputAsObject).slice(0, 3).join(', ')}...`; // Peek at some keys
      }
      throw new Error(
        `Crew creation failed: managerLlm for hierarchical process is not a recognized Agent instance, LLM instance, or known LLM config type (e.g., OpenAIConfig). Provided input (first 3 keys): ${inputType}`,
      );
    }

    if (!instantiatedManagerAgent && !instantiatedManagerLlm) {
      // This should be caught by the else block above, but as a safeguard.
      throw new Error('Manager could not be resolved for hierarchical process. Provide an Agent, an LLM instance, or an LLMConfig.');
    }
  }

  return {
    id: uuidv4(),
    config: {
      ...config,
      process: config.process || CrewProcess.SEQUENTIAL,
      verbose: config.verbose === undefined ? false : config.verbose,
    },
    status: 'PENDING',
    output: null, // Initialize output to null
    tasksOutput: new Map<string, TaskOutputDetail>(),
    createdAt: new Date(),
    updatedAt: new Date(),
    managerLlmInstance: instantiatedManagerLlm,
    managerAgentInstance: instantiatedManagerAgent,
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

  let finalOutput: unknown | null = null;
  const taskOutputs = new Map<string, TaskOutputDetail>();
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
        try {
          await executeTask(task, agentForExecution);
          if (task.status === TaskStatus.COMPLETED) {
            const taskDetail: TaskOutputDetail = {
              output: task.output,
              parsedOutput: task.parsedOutput,
              validationError: task.validationError,
              logs: task.logs
            };
            taskOutputs.set(task.id, taskDetail);
            finalOutput = task.parsedOutput !== null && task.parsedOutput !== undefined ? task.parsedOutput : task.output;
          } else if (task.status === TaskStatus.FAILED) {
            const taskDetail: TaskOutputDetail = {
              output: task.output,
              parsedOutput: task.parsedOutput,
              validationError: task.validationError,
              error: task.error,
              logs: task.logs
            };
            taskOutputs.set(task.id, taskDetail);
            finalOutput = { error: `Task ${task.id} failed`, details: task.error };
            throw new Error(`Task ${task.id} ("${task.config.description}") failed: ${JSON.stringify(task.error)}`);
          }
          if (crew.config.verbose) {
            const outputToLog = typeof task.output === 'string' ? task.output : JSON.stringify(task.output);
            console.log(`\nTask Output (ID: ${task.id}): ${outputToLog}\n`);
          }
        } catch (e: unknown) {
          const errMessage = e instanceof Error ? e.message : String(e);
          finalOutput = { error: `Critical error during sequential execution of task ${task.id}`, details: errMessage };
          taskOutputs.set(task.id, {
            output: null,
            error: { critical: errMessage }, 
            logs: [...task.logs, `Critical error: ${errMessage}`]
          });
          throw new Error(`Critical error during sequential execution of task ${task.id}: ${errMessage}`);
        }
      }
    } else if (currentProcess === CrewProcess.HIERARCHICAL) {
      if (!crew.managerLlmInstance && !crew.managerAgentInstance) {
        // This should ideally be caught by createCrew, but as a safeguard during run.
        throw new Error('Hierarchical process selected, but manager LLM is not available on the crew.');
      }
      if (crew.config.verbose) {
        console.log('\n[Crew AI] Beginning Hierarchical Process...\n');
      }

      // --- HIERARCHICAL LOGIC --- 
      // This will be complex and iterative.
      // For now, a very simplified placeholder.
      let iterationCount = 0;
      const maxIterations = crew.config.tasks.length + 10; // Allow more iterations, e.g., for retries

      // Map to store attempt details: status ('pending', 'failed', 'completed'), error, lastAgentId
      const taskAttemptInfo = new Map<string, TaskAttemptInfoValue>();
      for (const task of crew.config.tasks) {
        taskAttemptInfo.set(task.id, { status: TaskStatus.PENDING, attempts: 0 });
      }

      // Function to get tasks that are not yet completed
      const getNonCompletedTasks = () => crew.config.tasks.filter(
          task => taskAttemptInfo.get(task.id)?.status !== TaskStatus.COMPLETED
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
            if (attempt && attempt.status === TaskStatus.FAILED) {
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
            .filter(attempt => attempt?.status === TaskStatus.FAILED && attempt.lastAttemptIteration === iterationCount -1) // Failed in the *immediately previous* iteration
            .map(attempt => {
                const task = crew.config.tasks.find(t => taskAttemptInfo.get(t.id) === attempt); // Find task for description
                return task ? `  - Task ID ${task.id} ("${task.config.description}") failed with error: ${attempt?.error}. Attempted by Agent ID ${attempt?.lastAgentId}.` : '';
            }).filter(Boolean).join('\n');

        const managerPrompt = `
As the project manager, your primary goal is to orchestrate the successful completion of all assigned tasks by effectively delegating to your team of agents and utilizing your available tools if necessary. 
Review the current project status including available agents, their capabilities, remaining tasks (and their statuses), and any outputs or failures from previously attempted tasks. 
Then, decide the next single action. 

Actions:
1. Delegate a task: If a task is ready for an agent, provide the delegation details in the specified JSON format.
2. Use a tool: If you need more information or need to process existing information before delegating, you can use one of your tools. Ensure you provide your thought process and the required JSON for the tool call.
3. Complete the project: If all tasks are completed, or you assess the project goals are met, respond with only the string "ALL_TASKS_COMPLETED".

Follow the output format instructions precisely for delegation or tool use. For delegation, the JSON should be the ONLY content in your response if no tool is used.
`;

        let managerDecisionText: string;

        if (crew.managerAgentInstance) {
          // Manager is an Agent, use performAgentTask
          if (crew.config.verbose) {
            console.log(`Manager Agent "${crew.managerAgentInstance.config.role}" (ID: ${crew.managerAgentInstance.id}) is making a decision...`);
            // We don't log the full prompt here as performAgentTask will construct its own.
            // However, the core content (agents, tasks, summary) is similar to managerPrompt.
            // The managerAgentInstance will get a task like "Decide next step for the crew given the following project status..."
            // For now, we will pass the constructed managerPrompt as the task description for the manager agent.
          }
          // TODO: Refine how context (agentsDescription, tasksDescription, etc.) is passed to performAgentTask
          // For now, the managerPrompt IS the task for the agent.
          // performAgentTask itself prepends role, goal, backstory, tools. So the prompt here should be the core task.
          const managerAgentTaskDescription = managerPrompt; // Simplified for now.
          const managerContext = `
Available Worker Agents (excluding yourself):
${agentsDescription}

Tasks to be Actioned (pending or failed and needing retry):
${availableTasksDescription}

${recentlyFailedTasksFeedback ? `Context on Recently Failed Tasks (from last iteration):
${recentlyFailedTasksFeedback}` : ''}

Completed Tasks Summary:
${completedTasksSummary}

Your available tools are: [${crew.managerAgentInstance?.tools.map(t => t.name).join(', ') || 'None'}]. Refer to their descriptions if you consider using them.

Output format for delegation (JSON ONLY):
{
  "taskIdToDelegate": "<id_of_the_task_to_delegate>",
  "agentIdToAssign": "<id_of_the_agent_to_assign_the_task>",
  "additionalContextForAgent": "<any_specific_instructions_or_context>"
}
Output format for ALL_TASKS_COMPLETED: Respond with the exact string "ALL_TASKS_COMPLETED".
`;

          // The managerPrompt used for raw LLM is too specific in its JSON structure for an agent that might use tools first.
          // performAgentTask will combine agent's system prompt, this task, context, and tool descriptions.
          managerDecisionText = await performAgentTask(crew.managerAgentInstance, managerAgentTaskDescription, managerContext);

        } else if (crew.managerLlmInstance) {
          // Manager is a raw LLM, use direct chat
          // Construct the specific prompt for raw LLM decision making (expects JSON or completion string)
          const rawManagerPrompt = `
As the project manager, your goal is to successfully complete all assigned tasks by orchestrating a team of agents.

Available Agents (excluding yourself, the manager):
${agentsDescription}

Tasks to be Actioned (either pending or previously failed and needing retry):
${availableTasksDescription}

${recentlyFailedTasksFeedback ? `Context on Recently Failed Tasks (from last iteration):
${recentlyFailedTasksFeedback}
You should consider these failures when delegating.` : ''}

Completed Tasks Summary:
${completedTasksSummary}

Based on the available tasks, agent capabilities, and any recent failures, decide the next single task to delegate and to which agent. 
If all tasks are completed, or you believe the goal is met based on the completed tasks, respond with "ALL_TASKS_COMPLETED".
Otherwise, respond in the following JSON format ONLY (ensuring valid JSON, especially with escaped characters in strings if needed):
{
  "taskIdToDelegate": "<id_of_the_task_to_delegate_from_the_Tasks_to_be_Actioned_list>",
  "agentIdToAssign": "<id_of_the_agent_to_assign_the_task>",
  "additionalContextForAgent": "<any_specific_instructions_or_context_for_the_agent_for_this_task, especially if retrying a failed task>"
}
Ensure the IDs are exact from the lists provided.
`;
          if (crew.config.verbose) {
            console.log(`Manager LLM (${crew.managerLlmInstance.providerName} - ${crew.managerLlmInstance.id}) is making a decision...`);
            console.log(`Manager LLM Prompt (Raw):
${rawManagerPrompt.substring(0, 1000)}...
`);
          }
          const managerMessages: ChatMessage[] = [{ role: 'user', content: rawManagerPrompt }];
          const managerResponse = await crew.managerLlmInstance.chat(managerMessages);
          managerDecisionText = managerResponse.content;
        } else {
          // Should be caught by createCrew, but as a safeguard.
          throw new Error('Hierarchical process: No manager (Agent or LLM) available.');
        }

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
          taskOutputs.set(`manager_error_iteration_${iterationCount}`, {
            output: { error: `Manager designated task ID ${taskIdToDelegate} not found or not actionable.` },
            logs: []
          });
          // No break, let manager retry. If LLM is bad, maxIterations will catch it.
          continue; 
        }
        if (!agentForExecution) {
          console.error(`Manager designated agent ID ${agentIdToAssign} not found.`);
          taskOutputs.set(`manager_error_iteration_${iterationCount}`, {
            output: { error: `Manager designated agent ID ${agentIdToAssign} not found.` }, 
            logs: []
          });
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

        // Update taskAttemptInfo based on the actual execution status from taskToExecute (which is TaskStatus enum)
        const currentAttemptInfo = taskAttemptInfo.get(taskToExecute.id);
        if (currentAttemptInfo) {
            taskAttemptInfo.set(taskToExecute.id, {
                ...currentAttemptInfo,
                status: taskToExecute.status, // Directly use taskToExecute.status (it's already TaskStatus enum)
                error: taskToExecute.error ? String(taskToExecute.error) : undefined,
                lastAgentId: agentForExecution.id,
                lastAttemptIteration: iterationCount,
            });
        }

        if (taskToExecute.status === TaskStatus.COMPLETED) { // USE ENUM
          const taskDetail: TaskOutputDetail = {
            output: taskToExecute.output,
            parsedOutput: taskToExecute.parsedOutput,
            validationError: taskToExecute.validationError,
            logs: taskToExecute.logs
          };
          taskOutputs.set(taskToExecute.id, taskDetail);
          finalOutput = taskToExecute.parsedOutput !== null && taskToExecute.parsedOutput !== undefined ? taskToExecute.parsedOutput : taskToExecute.output;
          if (crew.config.verbose) {
             const outputToLog = typeof taskToExecute.output === 'string' ? taskToExecute.output : JSON.stringify(taskToExecute.output);
             console.log(`\nTask Output (ID: ${taskToExecute.id}): ${outputToLog}\n`);
          }
        } else if (taskToExecute.status === TaskStatus.FAILED) { // USE ENUM
          const taskDetail: TaskOutputDetail = {
            output: taskToExecute.output,
            parsedOutput: taskToExecute.parsedOutput,
            validationError: taskToExecute.validationError,
            error: taskToExecute.error,
            logs: taskToExecute.logs
          };
          taskOutputs.set(taskToExecute.id, taskDetail);
          // Error already logged by executeTask, manager will decide next step
          // Potentially set finalOutput here if this is a terminal failure for the loop
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
      if (allTasksCompleted && taskOutputs.size > 0) {
        let finalSummaryProviderAvailable = false;
        if (crew.managerAgentInstance?.llm) finalSummaryProviderAvailable = true;
        else if (crew.managerLlmInstance) finalSummaryProviderAvailable = true;

        if (finalSummaryProviderAvailable) {
          if (crew.config.verbose) {
            const providerType = crew.managerAgentInstance ? `Agent (${crew.managerAgentInstance.config.role})` : `LLM (${crew.managerLlmInstance?.providerName})`;
            console.log(`\n[Crew AI] All tasks completed. Requesting final summary from manager ${providerType}...`);
          }
          const successfulTaskOutputsSummary = Array.from(taskOutputs.entries())
            .filter(([, taskDetail]) => {
              // Filter out tasks that explicitly have an error stored at the TaskOutputDetail level
              // or whose raw output might look like an error object (though this is less robust).
              if (taskDetail.error) return false;
              if (taskDetail.output && typeof taskDetail.output === 'object' && 'error' in taskDetail.output) return false;
              return true;
            })
            .map(([taskId, taskDetail]) => {
              const task = crew.config.tasks.find(t => t.id === taskId);
              // Prioritize parsedOutput if available and no validation error, otherwise use raw output.
              const outputForSummary = (taskDetail.parsedOutput !== null && taskDetail.parsedOutput !== undefined && !taskDetail.validationError)
                                       ? taskDetail.parsedOutput
                                       : taskDetail.output;
              const outputString = typeof outputForSummary === 'string'
                                   ? outputForSummary
                                   : JSON.stringify(outputForSummary);
              
              let detailString = `Task: ${task?.config.description || taskId}\nOutput: ${outputString}`;
              if (taskDetail.validationError) {
                const valErrorSummary = taskDetail.validationError.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ');
                detailString += `\nValidation Status: FAILED (Errors: ${valErrorSummary}). Raw output was used for summary.`;
              }
              return detailString;
            })
            .join('\n\n');

          if (successfulTaskOutputsSummary) {
            const crewObjective = crew.config.objective || "Synthesize a cohesive final answer based on the outputs of the completed tasks.";

            // Prompt for direct LLM call (if managerLlmInstance is used)
            const finalSummaryPrompt = `
All assigned tasks have been completed. The overall crew objective was: "${crewObjective}".

Based on the following task outputs, please provide a comprehensive final summary or answer that fulfills this objective.

Summary of Successfully Completed Task Outputs:
${successfulTaskOutputsSummary}

Synthesize the final result based on the objective and the provided outputs.
`;

            try {
              if (crew.config.verbose) {
                  console.log(`Manager Final Summary Task Description (Objective: "${crewObjective}"):
Synthesize a final report based on the overall crew objective and the following task outputs.
Context (Task Outputs Summary):
${successfulTaskOutputsSummary.substring(0,300)}...
`);
              }
              
              let summaryMade = false;
              if (crew.managerAgentInstance) { // Prioritize manager agent
                  const finalSummaryTaskForAgent = `
The overall crew objective is: "${crewObjective}".

Based on this objective and the following summaries of successfully completed task outputs, please provide a comprehensive final summary or answer that fulfills the crew's purpose.
Ensure your response is a direct, final answer to the collective goal, not a meta-commentary on the summarization process itself.`;
                  const finalSummaryContextForAgent = `
Summary of Successfully Completed Task Outputs:
${successfulTaskOutputsSummary}
`;
                  finalOutput = await performAgentTask(crew.managerAgentInstance, finalSummaryTaskForAgent, finalSummaryContextForAgent);
                  summaryMade = true;
              } else if (crew.managerLlmInstance) { 
                  // Fallback to direct LLM call if no manager agent, but manager LLM exists
                  const summaryMessages: ChatMessage[] = [{ role: 'user', content: finalSummaryPrompt }];
                   if (crew.config.verbose) { // Also log raw prompt if using direct LLM
                      console.log(`Manager Final Summary Prompt (Raw LLM):
${finalSummaryPrompt.substring(0,500)}...
`);
                  }
                  const summaryResponse = await crew.managerLlmInstance.chat(summaryMessages);
                  finalOutput = summaryResponse.content; 
                  summaryMade = true;
              } else {
                  // This case means no suitable LLM was found for summarization.
                  console.warn('[Crew AI] No manager LLM with chat capabilities available for final summary, though tasks were completed.');
              }

              if (summaryMade && crew.config.verbose && finalOutput) { 
                  console.log(`Manager Final Summary Response:
${finalOutput}
`);
              }

              // if finalOutput is null or only contains a warning, set a completion message.
              if (!summaryMade && (!finalOutput || (typeof finalOutput === 'object' && 'warning' in finalOutput && Object.keys(finalOutput).length === 1))) {
                   finalOutput = "All tasks processed. No summary could be generated due to lack of suitable manager LLM or no successful outputs.";
              }
            } catch (e: unknown) {
              console.error('Failed to get final summary from manager:', e);
              // finalOutput would remain as the output of the last task, or the warning if max iterations hit.
              // Add this error to the crew's output.
               const existingError = (finalOutput && typeof finalOutput === 'object' && 'error' in finalOutput && finalOutput.error) ? `${finalOutput.error}; ` : '';
               finalOutput = {
                  ...(typeof finalOutput === 'object' ? finalOutput : { previousOutput: finalOutput }),
                  error: `${existingError}Failed to get final summary from manager: ${e instanceof Error ? e.message : String(e)}`
               };
            }
          } else {
              console.log('\n[Crew AI] No successfully completed task outputs (without validation errors if schema provided) available to generate a manager summary.');
              // Consider what finalOutput should be. If it has content from a failed task, that might be it.
              // If all tasks failed validation or had errors, finalOutput might be an aggregation of those.
              // For now, if no successful outputs, and finalOutput isn't already an error, set a message.
              if (!finalOutput || (typeof finalOutput === 'object' && !('error' in finalOutput))) {
                  finalOutput = "No successful task outputs available for a final summary.";
              }
          }
        } else if (crew.config.verbose) {
            console.log('\n[Crew AI] Hierarchical process completed, but no manager LLM available for final summary.');
        }
      } else if (crew.config.verbose && taskOutputs.size === 0 && (crew.managerLlmInstance || crew.managerAgentInstance)) {
          console.log('\n[Crew AI] Hierarchical process finished, but no task outputs were recorded to summarize.');
      } else if (crew.config.verbose && !allTasksCompleted && (crew.managerLlmInstance || crew.managerAgentInstance)) {
          console.log('\n[Crew AI] Hierarchical process finished, but not all tasks were completed. Skipping manager summary.');
      } else if (!allTasksCompleted && (crew.managerLlmInstance || crew.managerAgentInstance)) {
        console.warn('[Crew AI Warning] Manager summary skipped because not all tasks were reported as completed by the manager loop.');
      }
      // --- END: Phase 2 ---

      if (crew.config.verbose) console.log('Hierarchical process finished.');
    }

    crew.output = finalOutput;
    crew.tasksOutput = taskOutputs;
    crew.status = 'COMPLETED';
    sendTelemetry('crew_ended', { crew_id: crew.id, status: 'COMPLETED' });
  } catch (error: unknown) {
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
