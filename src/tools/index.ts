// Tool definitions for crew-ai-ts

/**
 * Interface for defining a tool that an Agent can use.
 * The `execute` method can take a structured input or a simple string,
 * and should return a string output for the LLM.
 */
export interface Tool<TInput = unknown, TOutput = string> {
  name: string;
  description: string;
  execute: (input: TInput) => Promise<TOutput>;
  // Optional: a method to define input schema for LLMs (e.g., JSON schema)
  // getInputSchema?: () => object;
}

/**
 * Abstract base class for creating tools.
 * Simplifies tool creation by requiring implementation of name, description, and _execute.
 */
export abstract class BaseTool<TInput = unknown, TOutput = string> implements Tool<TInput, TOutput> {
  abstract name: string;
  abstract description: string;

  // biome-ignore lint/suspicious/noExplicitAny: Input type is generic by design for BaseTool
  protected abstract _execute(input: TInput): Promise<TOutput>;

  // biome-ignore lint/suspicious/noExplicitAny: Input type is generic for the public execute
  async execute(input: TInput): Promise<TOutput> {
    try {
      return await this._execute(input);
    } catch (error) {
      // Generic error handling for tools
      console.error(`Error executing tool ${this.name}:`, error);
      // Return a string representation of the error to the LLM
      return `Error in tool ${this.name}: ${error instanceof Error ? error.message : String(error)}` as TOutput;
    }
  }
}

// Example of a simple tool implementation (can be moved to a separate file later)
export class SimpleCalculatorTool extends BaseTool<string, string> {
  name = "SimpleCalculator";
  description = "A simple calculator that can perform addition, subtraction, multiplication, and division on two numbers. Input should be a string like '5 + 3' or '10 * 2'.";

  protected async _execute(input: string): Promise<string> {
    try {
      // biome-ignore lint: Eval is used for a simple demo, not for production code.
      const result = eval(input);
      if (typeof result === 'number' && !Number.isNaN(result)) {
        return String(result);
      }
      return "Invalid calculation expression or result.";
    } catch (e) {
      return `Calculation error: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
}
