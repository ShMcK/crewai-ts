# crew-ai-ts

A TypeScript implementation of the popular Python library [crewAI](https://github.com/crewAIInc/crewAI), designed for orchestrating role-playing, autonomous AI agents. This project aims to bring the power and flexibility of crewAI to the TypeScript/JavaScript ecosystem, enabling developers to build sophisticated multi-agent applications.

## Current Status

`crew-ai-ts` is currently under active development. Key features implemented include:

*   **Core Concepts:** Agents, Tasks, and Crews.
*   **Processes:** Sequential and Hierarchical crew execution.
*   **LLM Integration:** Support for OpenAI (via API key) and Anthropic, with a flexible `ChatLLM` interface for extension.
*   **Agent Capabilities:** Memory (chat history), tool usage (via LLM JSON output).
*   **Task Features:** Contextual execution, output storage, Zod-based output schema validation, and saving output to files.
*   **Tooling:** Basic tool interface and an example calculator tool.
*   **Testing:** Comprehensive test suite using Vitest.
*   **Linting & Formatting:** BiomeJS for code quality.

For a detailed list of features and parity with the Python version, please see [`parity.md`](./parity.md).

## Getting Started

### Prerequisites

*   Node.js (version specified in `.nvmrc` or `package.json` engines)
*   pnpm (version specified in `package.json` `packageManager`)

### Installation

1.  Clone the repository:
    ```bash
    git clone https://github.com/your-username/crew-ai-ts.git
    cd crew-ai-ts
    ```
2.  Install dependencies:
    ```bash
    pnpm install
    ```

3.  Set up environment variables:
    Create a `.env` file by copying the example:
    ```bash
    cp .env.example .env
    ```
    Then, fill in your API keys (e.g., `OPENAI_API_KEY`) in the `.env` file.

## Basic Usage Example (Conceptual)

The library is designed to be used programmatically. Here's a conceptual example of how you might define and run a crew (actual API usage may evolve):

```typescript
// main.ts (example)
import { createAgent, createTask, createCrew, CrewProcess, runCrew } from './src'; // Adjust path as needed
import { OpenAIConfig } from './src/llms'; // Import necessary types

async function main() {
  // 1. Define Agents
  const researcher = createAgent({
    role: 'Senior Research Analyst',
    goal: 'Uncover cutting-edge developments in AI and data science',
    backstory: 'Expert in identifying emerging trends and analyzing complex data.',
    llm: { apiKey: process.env.OPENAI_API_KEY || 'YOUR_OPENAI_API_KEY', modelName: 'gpt-4o' } as OpenAIConfig // Ensure apiKey is handled
  });

  const writer = createAgent({
    role: 'Tech Content Strategist',
    goal: 'Craft compelling content on tech advancements',
    backstory: 'Renowned for insightful and engaging articles.',
    llm: { apiKey: process.env.OPENAI_API_KEY || 'YOUR_OPENAI_API_KEY', modelName: 'gpt-4o' } as OpenAIConfig // Ensure apiKey is handled
  });

  // 2. Define Tasks
  const researchTask = createTask({
    description: 'Conduct a comprehensive analysis of the latest advancements in AI in 2024. Identify key trends, breakthrough technologies, and potential industry impacts.',
    expectedOutput: 'A full analysis report in bullet points.',
    agent: researcher,
  });

  const writeTask = createTask({
    description: 'Using the insights from the research task, develop an engaging blog post that highlights the most significant AI advancements. It should be informative yet accessible, catering to a tech-savvy audience.',
    expectedOutput: 'A full blog post of at least 4 paragraphs.',
    agent: writer,
    context: [researchTask], // Example of context dependency
  });

  // 3. Create Crew
  const crew = createCrew({
    agents: [researcher, writer],
    tasks: [researchTask, writeTask],
    process: CrewProcess.SEQUENTIAL, // or HIERARCHICAL
    verbose: true,
  });

  // 4. Run Crew
  console.log('Crew kicking off...');
  await runCrew(crew); // Corrected to use runCrew as per current implementation

  console.log('\n\n######################');
  console.log('Crew run completed. Final Output:');
  console.log(crew.output);
  console.log('\nTasks Output:');
  crew.tasksOutput.forEach((taskOutput, taskId) => {
    console.log(`\nTask ID: ${taskId}`);
    console.log(`  Output: ${taskOutput.output}`);
    if (taskOutput.parsedOutput) {
      console.log(`  Parsed Output: ${JSON.stringify(taskOutput.parsedOutput)}`);
    }
    if (taskOutput.validationError) {
      console.log(`  Validation Error: ${taskOutput.validationError.message}`);
    }
  });
}

main().catch(console.error);
```
*(Note: This example is illustrative. Refer to the source code and tests for precise API usage as the library evolves.)*

## Development

### Available Scripts

*   `pnpm build`: Compile TypeScript to JavaScript.
*   `pnpm lint`: Lint the codebase using BiomeJS.
*   `pnpm lint:fix`: Lint and automatically fix issues.
*   `pnpm format`: Format the codebase using BiomeJS.
*   `pnpm check`: Run all BiomeJS checks (lint, format, safety).
*   `pnpm test`: Run the test suite using Vitest.
*   `pnpm test:watch`: Run tests in watch mode.
*   `pnpm test:cov`: Run tests and generate a coverage report.

## Implemented Modules

*   **`src/core`**: Core enums like `CrewProcess`.
*   **`src/agents`**: Agent creation (`createAgent`), configuration (`AgentConfig`), and task execution logic (`performAgentTask`).
*   **`src/tasks`**: Task creation (`createTask`), configuration (`TaskConfig`), and execution wrapper (`executeTask`).
*   **`src/crew`**: Crew creation (`createCrew`), configuration (`CrewConfig`), and orchestration logic for sequential and hierarchical processes (`runCrew`).
*   **`src/llms`**: LLM interface (`ChatLLM`), provider configurations (`OpenAIConfig`, `AnthropicConfig`), and client factory functions (`createOpenAIChatClient`, `createAnthropicChatClient`).
*   **`src/tools`**: Tool interface (`Tool`), `ToolContext`, and example tools.

## Roadmap & Future Work

This project aims for strong feature parity with the Python `crewAI`. Key areas for future development include:

*   **Broader LLM Support:** Adding clients for Ollama, other major cloud LLMs (Google Gemini, Cohere, etc.).
*   **Standard Tools:** Implementing a richer set of pre-built tools, especially a web search tool.
*   **Human Input Tool:** Allowing for interactive workflows.
*   **Enhanced Telemetry:** Implementing a privacy-conscious telemetry system.
*   Refinements to agent delegation and interaction models.

Contributions are welcome! Please see `CONTRIBUTING.md` (to be created) for guidelines.

## License

This project is licensed under the MIT License. 