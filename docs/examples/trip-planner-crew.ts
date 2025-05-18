// docs/examples/trip-planner-crew.ts

import { 
  createAgent, 
  createTask, 
  createCrew, 
  CrewProcess, 
  runCrew 
} from '../../src'; // Adjust path based on your directory structure
import type { OpenAIConfig } from '../../src/llms'; // Adjust path
// import type { Tool } from '../../src/tools'; // Example: If you had a search tool

// Example of how you might load API keys (ensure .env file is set up)
import dotenv from 'dotenv';
dotenv.config();


async function tripPlanner() {
  console.log('Initializing Trip Planner Crew...\n');

  // Define Agents
  // --------------- 

  // Agent 1: Expert City Explorer
  // This agent would ideally use a search tool to get up-to-date information.
  const cityExplorer = createAgent({
    role: 'Expert City Explorer',
    goal: 'Uncover the best attractions, local customs, and hidden gems of a given city. Provide insights on best times to visit and safety tips.',
    backstory: 
      `An avid globetrotter with a knack for deep-diving into city cultures. 
      You have years of experience exploring cities worldwide and sharing your findings.`,
    llm: { apiKey: process.env.OPENAI_API_KEY, modelName: 'gpt-4o' } as OpenAIConfig,
    verbose: true,
    allowDelegation: false,
    // tools: [/* webSearchTool */] // Would be added here
  });

  // Agent 2: Travel Concierge
  // This agent takes the city information and crafts a detailed itinerary.
  const travelConcierge = createAgent({
    role: 'Travel Concierge',
    goal: 'Create a detailed, engaging, and practical multi-day travel itinerary based on provided city research. The itinerary should include daily activities, dining suggestions, and travel tips.',
    backstory:
      `A meticulous planner with a passion for crafting unforgettable travel experiences. 
      You excel at organizing information into actionable and exciting itineraries.`,
    llm: { apiKey: process.env.OPENAI_API_KEY, modelName: 'gpt-4o' } as OpenAIConfig,
    verbose: true,
    allowDelegation: false, // Can be true if you want it to potentially delegate back to researcher for more info
  });

  // Define Tasks
  // ------------- 

  const cityToExplore = 'Paris, France'; // Example city

  // Task 1: Research the city
  const researchCityTask = createTask({
    description: 
      `Conduct comprehensive research on ${cityToExplore}. 
      Focus on key attractions (historical, cultural, entertainment), unique local experiences, 
      traditional cuisine, cultural etiquette, safety considerations, and best travel seasons.`,
    expectedOutput:
      `A detailed report on ${cityToExplore}, covering: 
      1. Top 5-7 attractions with brief descriptions. 
      2. 3-4 unique local experiences or hidden gems. 
      3. Overview of local cuisine and 2-3 must-try dishes. 
      4. Important cultural etiquette tips for visitors. 
      5. Safety advice and areas to be cautious of. 
      6. Recommended seasons/months to visit and why.`,
    agent: cityExplorer,
  });

  // Task 2: Plan the Itinerary
  const planItineraryTask = createTask({
    description:
      `Based on the research report for ${cityToExplore}, create a 3-day travel itinerary. 
      The itinerary should be well-structured, with a balance of sightseeing, cultural immersion, and relaxation. 
      Include suggestions for morning, afternoon, and evening activities each day, plus 2-3 dining options per day (various price points if possible).`,
    expectedOutput:
      `A complete 3-day itinerary for ${cityToExplore}, formatted clearly day-by-day. Each day should include: 
      - Morning: Activity/Sightseeing. 
      - Afternoon: Activity/Sightseeing. 
      - Evening: Activity/Dinner suggestion. 
      - Brief notes on transport or tips for the day where applicable. 
      Dining suggestions should include cuisine type and a short note.`,
    agent: travelConcierge,
    context: [researchCityTask], // researchCityTask is a Task object
  });

  // Create and Run the Crew
  // ------------------------
  const tripCrew = createCrew({
    agents: [cityExplorer, travelConcierge],
    tasks: [researchCityTask, planItineraryTask],
    process: CrewProcess.SEQUENTIAL,
    verbose: true,
  });

  console.log('Trip Planner Crew Kicking Off!\n');
  await runCrew(tripCrew);

  console.log('\n\n######################');
  console.log('Trip Planner Crew Run Completed.\n');
  console.log('Final Output (Output of the last task):');
  console.log(tripCrew.output);

  console.log('\n--- Individual Task Outputs ---');
  tripCrew.tasksOutput.forEach((taskOutput, taskId) => {
    const task = tripCrew.config.tasks.find(t => t.id === taskId);
    console.log(`\n## Task: ${task?.config.description.substring(0, 50)}... (ID: ${taskId})`);
    console.log(`  Agent: ${task?.config.agent?.config.role}`);
    console.log(`  Status: ${task?.status}`);
    console.log('  Output:');
    console.log(taskOutput.output);
    if (taskOutput.parsedOutput) {
      console.log('  Parsed Output:');
      console.log(JSON.stringify(taskOutput.parsedOutput, null, 2));
    }
    if (taskOutput.validationError) {
      console.log('  Validation Error:');
      console.log(taskOutput.validationError.message);
    }
  });
  console.log('\n######################\n');
}

tripPlanner().catch(error => {
  console.error('Error running Trip Planner Crew:', error);
});

/*
To Run This Example:

1. Save this file as `trip-planner-crew.ts` in your `docs/examples/` directory.
2. Make sure you have `ts-node` installed (`pnpm add -D ts-node`) and `dotenv` if you use it for API keys (`pnpm add dotenv`).
3. Set up your `.env` file at the root of the project with your `OPENAI_API_KEY`.
4. From the root of your project, run:
   `pnpm exec ts-node ./docs/examples/trip-planner-crew.ts`

Note: LLM responses can be lengthy. The `verbose: true` flags will provide detailed logs.
*/ 