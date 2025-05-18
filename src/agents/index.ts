// Agent definitions for crew-ai-ts

import type { Tool } from '../tools';
import {
	type LLM, type ChatLLM, type LLMConfig, type ChatMessage,
	type OpenAIConfig, createOpenAIChatClient, type LLMProviderConfig, type AnthropicConfig, createAnthropicChatClient,
	isOpenAIConfig, isAnthropicConfig
} from '../llms';
import { v4 as uuidv4 } from 'uuid';

// Placeholder for Tool type - will be properly defined in src/tools/index.ts
// export interface Tool { // <-- REMOVE THIS BLOCK
// name: string;
// description: string;
// run: (input: any) => Promise<any>; // Basic tool execution signature
// }

export interface AgentConfig {
	role: string;
	goal: string;
	backstory: string;
	// LLM can be a pre-configured instance or a config object for a known provider
	llm?: LLM | ChatLLM | LLMProviderConfig; // Use LLMProviderConfig
	memory?: boolean;
	tools?: Tool[];
	allowDelegation?: boolean;
	verbose?: boolean;
	maxIter?: number;
}

export interface Agent {
	readonly id: string;
	readonly config: AgentConfig;
	readonly llm?: LLM | ChatLLM; // Instantiated LLM
	readonly tools: Tool[];
	readonly memory: boolean;
	history?: ChatMessage[]; // Added for agent memory
	readonly allowDelegation: boolean;
	readonly verbose: boolean;
	readonly maxIter: number;
}

export function createAgent(config: AgentConfig): Agent {
	let instantiatedLlm: LLM | ChatLLM | undefined;

	if (config.llm) {
		// Check if it's a config object that we know how to instantiate
		if (!('invoke' in config.llm) && !('chat' in config.llm)) {
			const providerConfig = config.llm as LLMProviderConfig;
			try {
				if (isOpenAIConfig(providerConfig)) {
					instantiatedLlm = createOpenAIChatClient(providerConfig);
				} else if (isAnthropicConfig(providerConfig)) {
					instantiatedLlm = createAnthropicChatClient(providerConfig);
				} else {
					console.warn(
						`Agent LLM config for '${config.role}' is not a recognized OpenAI or Anthropic config. LLM will be undefined. Config keys: ${Object.keys(providerConfig).join(', ')}`
					);
				}
			} catch (e) {
				console.error(
					`Failed to create LLM client for agent ${config.role} from provider config. Error: ${e instanceof Error ? e.message : String(e)}. LLM will be undefined.`
				);
			}
		} else if ('invoke' in config.llm || 'chat' in config.llm) {
			// It's already an instantiated LLM object
			instantiatedLlm = config.llm as LLM | ChatLLM;
		} else {
			// It's some other config object we don't know how to handle here
			console.warn(
				`Agent LLM config provided for '${config.role}' is not a known LLM instance or recognized config. LLM will be undefined.`
			);
		}
	}

	const agentResult = {
		id: uuidv4(),
		config,
		llm: instantiatedLlm,
		tools: config.tools ?? [],
		memory: config.memory ?? false,
		history: config.memory ? [] : undefined, // Initialize history if memory is true
		allowDelegation: config.allowDelegation ?? false,
		verbose: config.verbose ?? false,
		maxIter: config.maxIter ?? 25,
	};
	return agentResult;
}

// Renamed from Agent.executeTask to performAgentTask
export async function performAgentTask(
	agent: Agent,
	taskDescription: string,
	context?: string,
): Promise<string> {
	if (agent.verbose) {
		console.log(
			`Agent ${agent.config.role} (ID: ${agent.id}) starting task: ${taskDescription}${context ? ` with context: ${context}` : ""}`,
		);
	}

	// Initial result if no LLM
	let finalAgentResponse = `Task '${taskDescription}' processed by agent ${agent.config.role} without LLM interaction.`;

	if (!agent.llm) {
		if (agent.verbose) console.log(`Agent ${agent.config.role} has no LLM configured for this task.`);
		// Even without LLM, attempt simplified tool usage if tools are present and taskDescription implies it somehow (future enhancement)
		// For now, if no LLM, no complex tool usage, just return basic processing message.
		return finalAgentResponse;
	}

	// Construct initial prompt for the LLM
	// TODO: Consider adding a more structured way to include tool descriptions in the prompt if agent has tools.
	const toolDescriptions = agent.tools.map(tool => `- ${tool.name}: ${tool.description}`).join('\n');

	let fullPrompt = '';
	if (agent.memory && agent.history && agent.history.length > 0) {
		const historyString = agent.history.map(msg => `${msg.role}: ${msg.content}`).join('\n\n');
		fullPrompt += `${historyString}\n\n`;
	}

	const currentInteractionPrompt = `You are ${agent.config.role}. Your goal is: ${agent.config.goal}. ${agent.config.backstory}\n\nAvailable tools:\n${toolDescriptions || 'No tools available.'}\n\nTask: ${taskDescription}${context ? `\nContext: ${context}` : ''}\n\nRespond with your analysis and decision. If you need to use a tool, respond with a JSON object with "tool_name" and "tool_input" keys, for example: \`\`\`json\n{\n  "tool_name": "your_tool_name",\n  "tool_input": "input for the tool"\n}\n\`\`\`\nIf you do not need to use a tool, provide your final answer directly as a string.`;
	fullPrompt += currentInteractionPrompt;

	try {
		let llmResponseContent: string;

		if (agent.verbose) {
			console.log(`Agent ${agent.config.role} (LLM: ${agent.llm.providerName} ${agent.llm.id}) using LLM. Full prompt snippet: ${fullPrompt.substring(0, 500)}...`);
		}

		// First LLM call
		if ('chat' in agent.llm && typeof agent.llm.chat === 'function') {
			const chatMessages: ChatMessage[] = [{ role: 'user', content: fullPrompt }];
			const llmResponse = await agent.llm.chat(chatMessages);
			llmResponseContent = llmResponse.content;
		} else if ('invoke' in agent.llm && typeof agent.llm.invoke === 'function') {
			const llmResponse = await agent.llm.invoke(fullPrompt);
			llmResponseContent = String(llmResponse); // Ensure string
		} else {
			finalAgentResponse = 'Agent LLM not recognized or misconfigured for direct call.';
			if (agent.verbose) console.warn(`Agent ${agent.config.role} LLM type not recognized for direct call.`);
			return finalAgentResponse;
		}

		if (agent.verbose) {
			console.log(`Agent ${agent.config.role} initial LLM response: ${llmResponseContent.substring(0, 250)}...`);
		}

		// Check for tool use
		// Regex to find JSON block for tool call, allowing for surrounding text from LLM.
		const toolCallMatch = llmResponseContent.match(/```json\s*({[^}]+})\s*```|({[^}]+})/s);
		let toolCallJson: { tool_name?: string; tool_input?: string } | null = null;

		if (toolCallMatch?.[1]) { // Prefer ```json {} ```
			try {
				toolCallJson = JSON.parse(toolCallMatch[1]);
			} catch (e) { /* ignore, try next match */ }
		}
		if (!toolCallJson && toolCallMatch?.[2]) { // Fallback to bare {} (less robust). Used optional chain for toolCallMatch?.[2]
			try {
				// Given the check above, toolCallMatch must be non-null here if toolCallMatch[2] was accessed.
				toolCallJson = JSON.parse(toolCallMatch[2] as string); // Added 'as string' due to optional chain making it potentially undefined to TS
			} catch (e) {
				if (agent.verbose) console.log('Could not parse potential bare JSON object for tool call.', e);
			}
		}

		if (toolCallJson?.tool_name && typeof toolCallJson?.tool_input !== 'undefined') {
			const { tool_name, tool_input } = toolCallJson;
			const toolToUse = agent.tools.find(t => t.name === tool_name);

			if (toolToUse) {
				if (agent.verbose) {
					console.log(`Agent ${agent.config.role} attempting to use tool: ${tool_name} with input: ${JSON.stringify(tool_input)}`);
				}
				let toolResultString: string;
				try {
					const toolContextForExecution = { taskDescription, originalTaskContext: context };
					const toolExecutionOutput = await toolToUse.execute(tool_input as unknown, toolContextForExecution);
					toolResultString = typeof toolExecutionOutput === 'string' ? toolExecutionOutput : JSON.stringify(toolExecutionOutput);
					if (agent.verbose) {
						console.log(`Agent ${agent.config.role} tool ${tool_name} output: ${toolResultString.substring(0,200)}...`);
					}
				} catch (toolError) {
					const errorMsg = toolError instanceof Error ? toolError.message : String(toolError);
					toolResultString = `Error executing tool '${tool_name}': ${errorMsg}`;
					if (agent.verbose) console.error(`Tool execution error for ${tool_name}:`, toolError);
				}

				// Second LLM call with tool result
				let promptWithToolResult = '';
				if (agent.memory && agent.history && agent.history.length > 0) {
					const historyString = agent.history.map(msg => `${msg.role}: ${msg.content}`).join('\n\n');
					promptWithToolResult += `${historyString}\n\n`;
				}
				promptWithToolResult += `${currentInteractionPrompt}\n\nI used the tool '${tool_name}'. Tool Output:\n\`\`\`\n${toolResultString}\n\`\`\`\nNow, provide your final answer based on this information and the original task.`;

				if (agent.verbose) {
					console.log(`Agent ${agent.config.role} making second LLM call with tool output. Prompt snippet: ${promptWithToolResult.substring(0, 500)}...`);
				}

				if ('chat' in agent.llm && typeof agent.llm.chat === 'function') {
					const finalChatMessages: ChatMessage[] = [{ role: 'user', content: promptWithToolResult }];
					const finalLlmResponse = await agent.llm.chat(finalChatMessages);
					finalAgentResponse = finalLlmResponse.content;
				} else if ('invoke' in agent.llm && typeof agent.llm.invoke === 'function') {
					const finalLlmResponse = await agent.llm.invoke(promptWithToolResult);
					finalAgentResponse = String(finalLlmResponse);
				} else {
					// Should not happen due to earlier check, but as a safeguard
					finalAgentResponse = 'Agent LLM not recognized for second call.';
				}
			} else {
				if (agent.verbose) console.warn(`Agent ${agent.config.role} tried to use tool '${tool_name}' but it was not found in its tool list.`);
				finalAgentResponse = `Error: Tool '${tool_name}' not found. Original LLM response: ${llmResponseContent}`;
			}
		} else {
			// No valid tool call detected, use initial LLM response as final answer
			finalAgentResponse = llmResponseContent;
		}
	} catch (e) {
		const error = e instanceof Error ? e.message : String(e);
		finalAgentResponse = `Error during agent task processing: ${error}`;
		if (agent.verbose) console.error(`Agent ${agent.config.role} task processing error:`, e);
	}

	// Update history if memory is enabled
	if (agent.memory && agent.history) {
		// The 'user' message is the core task/context presented in this specific call
		const userMessageForHistory: ChatMessage = { 
			role: 'user', 
			content: `Task: ${taskDescription}${context ? `\nContext for task: ${context}` : ''}` 
		};
		agent.history.push(userMessageForHistory);

		const assistantMessageForHistory: ChatMessage = { role: 'assistant', content: finalAgentResponse };
		agent.history.push(assistantMessageForHistory);

		if (agent.verbose) {
			console.log(`Agent ${agent.config.role} memory updated. History size: ${agent.history.length}`);
		}
	}

	if (agent.verbose) {
		console.log(`Agent ${agent.config.role} (ID: ${agent.id}) finished task: ${taskDescription}, final response: ${finalAgentResponse.substring(0, 200)}...`);
	}
	return finalAgentResponse;
}
