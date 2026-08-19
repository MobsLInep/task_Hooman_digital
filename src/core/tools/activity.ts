import type { ActivityRepository } from '../persistence'
import type { ToolActivitySink, ToolInvocation } from './types'

export function createToolActivitySink(
  activity: ActivityRepository,
  newId: () => string
): ToolActivitySink {
  return {
    record(invocation: ToolInvocation): void {
      activity.log({
        id: newId(),
        kind: 'tool_call',
        summary: summarise(invocation),
        metaJson: JSON.stringify(invocation)
      })
    }
  }
}

function summarise(invocation: ToolInvocation): string {
  const verb =
    invocation.outcome === 'ok'
      ? 'ran'
      : invocation.outcome === 'validation_error'
        ? 'rejected arguments for'
        : invocation.outcome === 'timeout'
          ? 'timed out running'
          : invocation.outcome === 'unknown_tool'
            ? 'could not find tool'
            : 'failed running'

  return `${verb} ${invocation.tool} (${invocation.durationMs}ms)`
}
