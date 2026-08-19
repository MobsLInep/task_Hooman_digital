import { z } from 'zod'
import { all, create, type MathNode } from 'mathjs'
import { jsonSchemaOf } from '../registry'
import type { Tool, ToolContext } from '../types'

const math = create(all!)

const parseExpression = math.parse.bind(math)

const disabled = (name: string) => (): never => {
  throw new Error(`${name}() is not available in the calculator`)
}

math.import(
  {
    import: disabled('import'),
    createUnit: disabled('createUnit'),
    reviver: disabled('reviver'),
    evaluate: disabled('evaluate'),
    parse: disabled('parse'),
    simplify: disabled('simplify'),
    derivative: disabled('derivative'),
    resolve: disabled('resolve')
  },
  { override: true }
)

const MAX_EXPRESSION_LENGTH = 500

export const calculatorArgs = z.object({
  expression: z
    .string()
    .min(1)
    .max(MAX_EXPRESSION_LENGTH)
    .describe(
      'A single arithmetic expression, e.g. "2 + 2 * 3", "sqrt(144)", "5 km to miles". ' +
        'Function definitions and assignments are not allowed.'
    ),
  precision: z
    .number()
    .int()
    .min(1)
    .max(15)
    .optional()
    .describe('Significant digits in the formatted result. Defaults to full precision.')
})

export type CalculatorArgs = z.infer<typeof calculatorArgs>

export interface CalculatorResult {
  expression: string
  result: string
}

function assertSafe(node: MathNode): void {
  node.traverse((child) => {
    if (child.type === 'FunctionAssignmentNode') {
      throw new Error('Function definitions are not allowed in the calculator')
    }
    if (child.type === 'AssignmentNode') {
      throw new Error('Assignments are not allowed in the calculator')
    }
  })
}

export function createCalculatorTool(): Tool<CalculatorArgs, CalculatorResult> {
  return {
    name: 'calculator',
    description:
      'Evaluate an arithmetic expression. Supports the usual operators, common functions ' +
      '(sqrt, sin, log, ...) and unit conversion such as "5 km to miles". ' +
      'Cannot define functions, assign variables, or import anything.',
    schema: calculatorArgs,
    jsonSchema: () => jsonSchemaOf(calculatorArgs),
    requiresWorkspace: true,
    timeoutMs: 100,

    async execute(args: CalculatorArgs, _ctx: ToolContext): Promise<CalculatorResult> {
      const node = parseExpression(args.expression)
      assertSafe(node)

      const value: unknown = node.compile().evaluate({})

      const formatted =
        args.precision === undefined
          ? math.format(value)
          : math.format(value, { precision: args.precision })

      return { expression: args.expression, result: formatted }
    }
  }
}
