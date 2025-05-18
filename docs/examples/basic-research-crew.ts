// docs/examples/trip-planner-crew.ts

import { 
  createAgent, 
  createTask, 
  createCrew, 
  runCrew,
  CrewProcess
} from '../../src'; // Adjust path based on your directory structure
import type { OpenAIConfig } from '../../src/llms'; // Adjust path
// import type { Tool } from '../../src/tools'; // Example: If you had a search tool

// Example of how you might load API keys (ensure .env file is set up)
import dotenv from 'dotenv';
dotenv.config();

async function basicResearch() {
  console.log('Initializing Basic Research Crew...\n');

  const writer = createAgent({
    role: 'Writer',
    goal: 'Write a blog post about the most significant AI advancements.',
    backstory: 'You are a writer who writes blog posts about the most significant AI advancements.',
    llm: { apiKey: process.env.OPENAI_API_KEY, modelName: 'gpt-4o' } as OpenAIConfig,
    verbose: true,
  });

  const researchTask = createTask({
    description: 'Research the most significant AI advancements.',
    expectedOutput: 'A report of at least 4 paragraphs.',
    agent: writer,
  });

  const writeTask = createTask({
    description: 'Using the insights from the research task, develop an engaging blog post that highlights the most significant AI advancements. It should be informative yet accessible, catering to a tech-savvy audience.',
    expectedOutput: 'A full blog post of at least 4 paragraphs.',
    agent: writer,
    context: [researchTask],
  });

  // 3. Create Crew 
  const crew = createCrew({
    agents: [writer],
    tasks: [researchTask, writeTask],
    process: CrewProcess.SEQUENTIAL,
  });

  // 4. Run Crew
  const result = await runCrew(crew);
  console.log(result);
}

basicResearch().catch(error => {
  console.error('Error running Basic Research Crew:', error);
});
