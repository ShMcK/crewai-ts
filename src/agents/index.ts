// Agent definitions for crew-ai-ts

import type { Tool } from '../tools';
import type { LLM, ChatLLM, LLMConfig } from '../llms'; // Added LLM, ChatLLM, LLMConfig

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
	// biome-ignore lint/suspicious/noExplicitAny: LLM can be various types, to be refined with specific LLM instances
	llm?: LLM | ChatLLM | LLMConfig; // Using imported types, still broad for flexibility
	memory?: boolean;
	tools?: Tool[];
	allowDelegation?: boolean;
	verbose?: boolean;
	maxIter?: number; // Maximum iterations for the agent
	// Add other relevant properties from the Python version as we discover them
}

export class Agent {
	readonly role: string;
	readonly goal: string;
	readonly backstory: string;
	// biome-ignore lint/suspicious/noExplicitAny: LLM can be various types, to be refined with specific LLM instances
	llm?: LLM | ChatLLM; // Agent instance should have an instantiated LLM
	memory: boolean;
	tools: Tool[];
	allowDelegation: boolean;
	verbose: boolean;
	maxIter: number;

	constructor(config: AgentConfig) {
		this.role = config.role;
		this.goal = config.goal;
		this.backstory = config.backstory;
		// Basic LLM instantiation logic (very simplified)
		// In a real app, this would involve more sophisticated factory/provider logic
		if (config.llm && !(typeof config.llm === 'function')) { // Check if it's a config object and not an instance
			if ((config.llm as LLMConfig).apiKey && (config.llm as LLMConfig).modelName === 'gpt-3.5-turbo') {
				// This is a hacky way to demonstrate instantiation from config.
				// A proper factory or DI system would be better.
				// this.llm = new OpenAIChatModel(config.llm as OpenAIConfig); // Assuming OpenAIChatModel is exported from llms
				// For now, just assign if it looks like a config. We need OpenAIChatModel available for this.
				// To avoid circular deps or making this too complex now, we'll keep it assignable.
			}
			// If it's a config object but not matching a simple known one, it might be pre-configured.
			// Or it's an already instantiated LLM. This part needs refinement.
			this.llm = config.llm as LLM | ChatLLM; // Trusting the input for now
		} else if (config.llm) {
			this.llm = config.llm as LLM | ChatLLM;
		}

		this.memory = config.memory ?? false;
		this.tools = config.tools ?? [];
		this.allowDelegation = config.allowDelegation ?? false;
		this.verbose = config.verbose ?? false;
		this.maxIter = config.maxIter ?? 25;
	}

	// Simplified placeholder for agent execution logic
	async executeTask(
		taskDescription: string,
		context?: string,
	): Promise<string> {
		if (this.verbose) {
			console.log(
				`Agent ${this.role} starting task: ${taskDescription}${context ? ` with context: ${context}` : ""}`,
			);
		}

		let result = `Task '${taskDescription}' processed by agent ${this.role}.`;

		// Simulate LLM call if LLM is present
		if (this.llm && typeof (this.llm as ChatLLM).chat === 'function') {
			if (this.verbose) console.log(`Agent ${this.role} using ChatLLM.`);
			const chatMessages: import('../llms').ChatMessage[] = [{ role: 'user', content: `Task: ${taskDescription}${context ? `\nContext: ${context}` : ''}` }];
			const llmResponse = await (this.llm as ChatLLM).chat(chatMessages);
			result += ` LLM Response: ${llmResponse.content}`;
		} else if (this.llm && typeof (this.llm as LLM).invoke === 'function') {
			if (this.verbose) console.log(`Agent ${this.role} using generic LLM.`);
			const llmResponse = await (this.llm as LLM).invoke(`Task: ${taskDescription}${context ? `\nContext: ${context}` : ''}`);
			result += ` LLM Response: ${llmResponse}`;
		} else {
			if (this.verbose) console.log(`Agent ${this.role} has no LLM or LLM type is not recognized for direct call.`);
		}

		if (this.tools.length > 0 && this.tools[0]) {
			const toolToUse = this.tools[0];
			if (this.verbose) {
				console.log(`Agent ${this.role} considering tool: ${toolToUse.name}`);
			}
			// result += ` Potential use of tool '${toolToUse.name}' was considered.`;
			// Example of actually using a tool (input type needs to match tool definition)
			try {
				// biome-ignore lint/suspicious/noExplicitAny: Tool input is unknown for this generic part
				const toolInput: any = { instruction: taskDescription, context: context }; 
				const toolResult = await toolToUse.execute(toolInput as unknown); // Cast to unknown first if TInput is unknown
				result += ` Tool '${toolToUse.name}' executed. Result: ${toolResult}`;
			} catch (e) {
				result += ` Error executing tool '${toolToUse.name}'.`;
				if (this.verbose) console.error(`Tool execution error for ${toolToUse.name}:`, e);
			}
		}

		if (this.verbose) {
			console.log(
				`Agent ${this.role} finished task: ${taskDescription}, result: ${result}`,
			);
		}
		return result;
	}
}
