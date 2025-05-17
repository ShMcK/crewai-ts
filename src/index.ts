export * from "./core";
export * from "./agents";
export * from "./tasks";
export * from "./crew";
export * from "./tools";
export * from "./llms";

console.log("crew-ai-ts initialized with new structure!");

// Example usage (can be removed later)
export const greet = (name: string): string => {
	return `Hello, ${name}! This is crew-ai-ts.`;
};
