// Agent definitions for crew-ai-ts

import type { Tool } from '../tools';
import {
	type LLM, type ChatLLM, type LLMConfig, type ChatMessage,
	type OpenAIConfig, createOpenAIChatClient // Import factory
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
	llm?: LLM | ChatLLM | OpenAIConfig; // Made more specific for OpenAI example
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
	readonly allowDelegation: boolean;
	readonly verbose: boolean;
	readonly maxIter: number;
}

export function createAgent(config: AgentConfig): Agent {
	let instantiatedLlm: LLM | ChatLLM | undefined;

	if (config.llm) {
		// Check if it's a config object that we know how to instantiate (e.g., OpenAIConfig)
		// This is a simplified check. A more robust factory would inspect a 'provider' field or use type guards.
		if ('apiKey' in config.llm && 'modelName' in config.llm && !('invoke' in config.llm) && !('chat' in config.llm)) {
			// Assuming it's OpenAIConfig if it has apiKey and modelName, and no execute/chat methods
			// In a real system, you might have a config.provider field to switch on.
			try {
				instantiatedLlm = createOpenAIChatClient(config.llm as OpenAIConfig);
			} catch (e) {
				console.error(`Failed to create OpenAI client for agent ${config.role}:`, e);
				// Decide if agent should be created without LLM or throw
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

	return {
		id: uuidv4(),
		config,
		llm: instantiatedLlm,
		tools: config.tools ?? [],
		memory: config.memory ?? false,
		allowDelegation: config.allowDelegation ?? false,
		verbose: config.verbose ?? false,
		maxIter: config.maxIter ?? 25,
	};
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

	let result = `Task '${taskDescription}' processed by agent ${agent.config.role}.`;

	if (agent.llm) {
		const prompt = `Role: ${agent.config.role}\nGoal: ${agent.config.goal}\nBackstory: ${agent.config.backstory}\n\nTask: ${taskDescription}${context ? `\nContext: ${context}` : ''}`;
		if (agent.verbose) {
			console.log(`Agent ${agent.config.role} (LLM: ${agent.llm.providerName} ${agent.llm.id}) using LLM. Prompt snippet: ${prompt.substring(0,100)}...`);
		}
		try {
			if ('chat' in agent.llm && typeof agent.llm.chat === 'function') {
				const chatMessages: ChatMessage[] = [{ role: 'user', content: prompt }];
				const llmResponse = await agent.llm.chat(chatMessages);
				result += ` LLM Response: ${llmResponse.content}`;
			} else if ('invoke' in agent.llm && typeof agent.llm.invoke === 'function') {
				const llmResponse = await agent.llm.invoke(prompt);
				result += ` LLM Response: ${String(llmResponse)}`;
			} else {
				result += ' LLM not recognized or misconfigured for direct call.';
				if (agent.verbose) console.warn(`Agent ${agent.config.role} LLM type not recognized for direct call.`);
			}
		} catch (e) {
			const error = e instanceof Error ? e.message : String(e);
			result += ` Error during LLM call: ${error}`;
			if (agent.verbose) console.error(`Agent ${agent.config.role} LLM error:`, e);
		}
	} else {
		if (agent.verbose) console.log(`Agent ${agent.config.role} has no LLM configured for this task.`);
	}

	// Tool usage simulation (simplified)
	if (agent.tools.length > 0 && agent.tools[0]) {
		const toolToUse = agent.tools[0];
		if (agent.verbose) {
			console.log(`Agent ${agent.config.role} considering tool: ${toolToUse.name}`);
		}
		try {
			// biome-ignore lint/suspicious/noExplicitAny: Tool input is unknown for this generic part
			const toolInput: any = { instruction: taskDescription, context };
			const toolResult = await toolToUse.execute(toolInput as unknown);
			result += ` Tool '${toolToUse.name}' executed. Result: ${String(toolResult)}`;
		} catch (e) {
			const errorMsg = e instanceof Error ? e.message : String(e);
			result += ` Error executing tool '${toolToUse.name}': ${errorMsg}`;
			if (agent.verbose) console.error(`Tool execution error for ${toolToUse.name}:`, e);
		}
	}

	if (agent.verbose) {
		console.log(`Agent ${agent.config.role} (ID: ${agent.id}) finished task: ${taskDescription}, result: ${result}`);
	}
	return result;
}
