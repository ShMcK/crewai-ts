// Tool definitions for crew-ai-ts

/**
 * Optional context that can be passed to a tool's execute method.
 */
export interface ToolContext {
  taskDescription?: string;
  originalTaskContext?: string; // Renamed from 'context' to avoid confusion with this interface name
  // Add other relevant context fields as needed
}

/**
 * Represents a tool that an agent can use.
 * @template TInput The type of the input parameter for the tool's execute method.
 * @template TOutput The type of the output/result from the tool's execute method.
 */
export interface Tool<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  execute: (input: TInput, context?: ToolContext) => Promise<TOutput>;
  // Optional: Define if the tool's output can be directly used as input for another task/agent
  isDirectInput?: boolean; // e.g. for a simple calculator, the output is directly usable.
  // Optional: A schema for the expected input, could be a JSON schema object or a validation function.
  // inputSchema?: object | ((input: any) => { valid: boolean; message?: string });
}

/**
 * Higher-order function to create a tool executor with standardized error handling.
 * This function is not exported but used internally by tools if desired.
 * @param toolName The name of the tool, used in error messages.
 * @param coreExecute The core logic function of the tool.
 */
function createToolExecutor<TInput, TOutput>(
  toolName: string,
  // biome-ignore lint/suspicious/noExplicitAny: coreExecute can have any input/output
  coreExecute: (input: TInput) => Promise<any>,
): (input: TInput) => Promise<TOutput | string> { // Output can be TOutput or an error string
  return async (input: TInput): Promise<TOutput | string> => {
    try {
      const result = await coreExecute(input);
      return result as TOutput;
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      // console.error(`Error in tool ${toolName}:`, errorMessage);
      return `Error in tool ${toolName}: ${errorMessage}`;
    }
  };
}

// Example Tool: SimpleCalculatorTool (refactored as a plain object)
export const simpleCalculatorTool: Tool<string, string> = {
  name: 'SimpleCalculator',
  description:
    'A simple calculator that evaluates mathematical expressions. Input should be a string like "5 + 3" or "10 * 2 / 4".',
  async execute(expression: string, _context?: ToolContext): Promise<string> {
    try {
      // Warning: Using eval can be a security risk if the input is not sanitized.
      // biome-ignore lint/security/noGlobalEval: Core functionality of this specific tool
      const result = eval(expression);

      if (result === Number.POSITIVE_INFINITY || result === Number.NEGATIVE_INFINITY || Number.isNaN(result)) {
        return 'Invalid calculation expression or result.';
      }
      return String(result);
    } catch (e) {
      // Handle specific errors like SyntaxError from eval
      if (e instanceof SyntaxError || e instanceof ReferenceError) {
        return `Calculation error: ${e.message}`;
      }
      return 'Invalid calculation expression or result.'; // Generic fallback for other errors
    }
  },
};

// Add more tools here as needed
// e.g., WebSearchTool, FileReadTool, etc.
