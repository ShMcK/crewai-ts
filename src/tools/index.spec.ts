import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BaseTool, SimpleCalculatorTool, type Tool } from './index';

// --- Test Tool Implementation ---
class TestTool extends BaseTool<string, string> {
  name = 'TestTool';
  description = 'A test tool';

  // Mockable _execute method
  _execute = vi.fn(async (input: string): Promise<string> => {
    if (input === 'error') {
      throw new Error('Test tool execution error');
    }
    return `Test tool executed with: ${input}`;
  });
}
// --- End Test Tool Implementation ---

describe('BaseTool', () => {
  let tool: TestTool;

  beforeEach(() => {
    tool = new TestTool();
    tool._execute.mockClear(); // Clear mock history before each test
  });

  it('should correctly call _execute and return its result', async () => {
    const input = 'test input';
    const result = await tool.execute(input);
    expect(tool._execute).toHaveBeenCalledWith(input);
    expect(result).toBe(`Test tool executed with: ${input}`);
  });

  it('should handle errors from _execute and return an error message string', async () => {
    const input = 'error';
    const result = await tool.execute(input);
    expect(tool._execute).toHaveBeenCalledWith(input);
    expect(result).toBe('Error in tool TestTool: Test tool execution error');
  });

  it('should handle non-Error objects thrown from _execute', async () => {
    tool._execute.mockImplementationOnce(async () => {
      // biome-ignore lint: Testing non-Error throw which is a valid JS feature though often discouraged.
      throw 'Custom error object';
    });
    const input = 'custom_error_input';
    const result = await tool.execute(input);
    expect(tool._execute).toHaveBeenCalledWith(input);
    expect(result).toBe('Error in tool TestTool: Custom error object');
  });
});

describe('SimpleCalculatorTool', () => {
  let calculator: SimpleCalculatorTool;

  beforeEach(() => {
    calculator = new SimpleCalculatorTool();
  });

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

  it('should return an error message for invalid expressions', async () => {
    expect(await calculator.execute('5 + ')).toBe('Calculation error: Unexpected end of input');
    expect(await calculator.execute('abc')).toBe('Calculation error: abc is not defined'); // or similar based on JS eval behavior
  });

  it('should return an error message for division by zero (Infinity)', async () => {
    expect(await calculator.execute('5 / 0')).toBe('Invalid calculation expression or result.');
  });

  it('should return an error message for operations resulting in NaN', async () => {
    expect(await calculator.execute('0 / 0')).toBe('Invalid calculation expression or result.');
  });
}); 