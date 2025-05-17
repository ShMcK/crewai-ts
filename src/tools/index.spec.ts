import { describe, it, expect, vi, beforeEach } from 'vitest';
import { simpleCalculatorTool, type Tool } from './index'; // createToolExecutor is not exported, tested via usage if needed or by exporting it.

// For testing createToolExecutor, we'll define a helper here or import it if it were exported.
// Let's assume createToolExecutor is a local (not exported) helper for now as per the previous refactor.
// If we decide to export createToolExecutor, we can test it directly.
// For now, its functionality is implicitly tested if a tool uses it.
// To explicitly test it, we would need to export it from src/tools/index.ts.
// Let's proceed by primarily testing the exported tools.

// If createToolExecutor were exported, tests would look like this:
/*
describe('createToolExecutor', () => {
  const toolName = 'TestExecutorTool';
  const mockCoreExecute = vi.fn();
  const executor = createToolExecutor(toolName, mockCoreExecute);

  beforeEach(() => {
    mockCoreExecute.mockClear();
  });

  it('should call coreExecute with input and return its result', async () => {
    mockCoreExecute.mockResolvedValue('core success');
    const result = await executor('test input');
    expect(mockCoreExecute).toHaveBeenCalledWith('test input');
    expect(result).toBe('core success');
  });

  it('should return error message string if coreExecute throws an Error', async () => {
    mockCoreExecute.mockRejectedValue(new Error('core error'));
    const result = await executor('test input');
    expect(result).toBe('Error in tool TestExecutorTool: core error');
  });

  it('should return stringified error if coreExecute throws non-Error', async () => {
    mockCoreExecute.mockRejectedValue('core custom error');
    const result = await executor('test input');
    expect(result).toBe('Error in tool TestExecutorTool: core custom error');
  });
});
*/

describe('SimpleCalculatorTool', () => {
  // simpleCalculatorTool is now a plain object, not a class instance.
  const calculator: Tool<string, string> = simpleCalculatorTool;

  it('should have correct name and description', () => {
    expect(calculator.name).toBe('SimpleCalculator');
    expect(calculator.description).toContain('simple calculator');
  });

  it('should perform addition', async () => {
    expect(await calculator.execute('5 + 3')).toBe('8');
  });

  it('should perform subtraction', async () => {
    expect(await calculator.execute('10 - 4')).toBe('6');
  });

  it('should perform multiplication', async () => {
    expect(await calculator.execute('7 * 3')).toBe('21');
  });

  it('should perform division', async () => {
    expect(await calculator.execute('20 / 5')).toBe('4');
  });

  it('should handle decimal results', async () => {
    expect(await calculator.execute('5 / 2')).toBe('2.5');
  });

  it('should return an error message for invalid expressions due to eval errors', async () => {
    // eval can throw various errors, SyntaxError for incomplete, ReferenceError for undefined vars
    expect(await calculator.execute('5 + ')).toBe('Calculation error: Unexpected end of input');
    expect(await calculator.execute('abc')).toBe('Calculation error: abc is not defined');
  });

  it('should return specific message for division by zero (Infinity)', async () => {
    expect(await calculator.execute('5 / 0')).toBe('Invalid calculation expression or result.');
  });

  it('should return specific message for operations resulting in NaN (0/0)', async () => {
    expect(await calculator.execute('0 / 0')).toBe('Invalid calculation expression or result.');
  });

  // Example of testing a tool that might use the createToolExecutor (if it were used by SimpleCalculatorTool or another exported tool)
  // Let's imagine a dummy tool that uses it:
  /*
    const mockCoreLogic = vi.fn();
    const wrappedTool: Tool<string, string> = {
      name: "WrappedTestTool",
      description: "A tool wrapped with createToolExecutor for testing purposes.",
      execute: createToolExecutor("WrappedTestTool", mockCoreLogic)
    };

    it('wrapped tool should delegate to core logic via executor', async () => {
      mockCoreLogic.mockResolvedValue('wrapped success');
      const result = await wrappedTool.execute('input for wrapped');
      expect(mockCoreLogic).toHaveBeenCalledWith('input for wrapped');
      expect(result).toBe('wrapped success');
    });

    it('wrapped tool should show executor error handling', async () => {
      mockCoreLogic.mockRejectedValue(new Error('wrapped core error'));
      const result = await wrappedTool.execute('input for wrapped error');
      expect(result).toBe('Error in tool WrappedTestTool: wrapped core error');
    });
  */
}); 