import { describe, it, expect, beforeEach, vi } from 'vitest'

const cancel = vi.fn(async () => true)
const snapshot = vi.fn(async (conversationId: string) => ({
  conversationId,
  generating: false,
  text: '',
  toolCalls: [],
  startedAt: undefined,
  lastOutcome: undefined,
  lastError: undefined
}))

const api = {
  workspaces: {
    list: vi.fn(async () => [
      { id: 'ws-a', name: 'A' },
      { id: 'ws-b', name: 'B' }
    ]),
    create: vi.fn()
  },
  conversations: {
    list: vi.fn(async () => [
      { id: 'conv-1', title: 'One', pinned: 0, updatedAt: '2', workspaceId: 'ws-a' }
    ]),
    create: vi.fn(),
    rename: vi.fn(),
    remove: vi.fn(),
    setPinned: vi.fn()
  },
  messages: { list: vi.fn(async () => []) },
  notes: { list: vi.fn(async () => []), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
  documents: {
    list: vi.fn(async () => []),
    import: vi.fn(),
    resolveDuplicate: vi.fn(),
    chunks: vi.fn()
  },
  tasks: { active: vi.fn(async () => [] as unknown[]) },
  activity: { recent: vi.fn(async () => []) },
  generation: {
    send: vi.fn(),
    retry: vi.fn(),
    continue: vi.fn(),
    cancel,
    snapshot,
    active: vi.fn(async () => []),
    report: vi.fn(async () => null)
  },
  inspector: { tools: vi.fn(async () => []) },
  onEvent: vi.fn(() => () => {})
}

vi.stubGlobal('window', { api })

const { useStore } = await import('../../src/renderer/src/store')

const initial = useStore.getState()

beforeEach(() => {
  vi.clearAllMocks()
  useStore.setState(initial, true)
})

describe('switching never cancels a generation', () => {
  it('selectWorkspace does not call cancel', async () => {
    useStore.setState({ generating: { 'conv-1': true }, streaming: { 'conv-1': 'partial text' } })

    await useStore.getState().selectWorkspace('ws-b')

    expect(cancel).not.toHaveBeenCalled()

    expect(useStore.getState().generating['conv-1']).toBe(true)
    expect(useStore.getState().streaming['conv-1']).toBe('partial text')
  })

  it('selectConversation does not call cancel', async () => {
    useStore.setState({ activeWorkspaceId: 'ws-a', generating: { 'conv-1': true } })

    await useStore.getState().selectConversation('conv-2')

    expect(cancel).not.toHaveBeenCalled()
    expect(useStore.getState().generating['conv-1']).toBe(true)
  })

  it('cancel always names one conversation', async () => {
    useStore.setState({ activeConversationId: 'conv-1' })
    await useStore.getState().cancel()
    expect(cancel).toHaveBeenCalledWith('conv-1')

    await useStore.getState().cancel('conv-9')
    expect(cancel).toHaveBeenLastCalledWith('conv-9')
  })
})

describe('coming back to a live stream', () => {
  it('rebuilds the view from the main-process snapshot', async () => {
    snapshot.mockResolvedValueOnce({
      conversationId: 'conv-1',
      generating: true,
      text: 'text produced while the view was closed',
      toolCalls: [{ id: 't1', name: 'calculator', args: {} }],
      startedAt: 1,
      lastOutcome: undefined,
      lastError: undefined
    } as never)

    useStore.setState({ activeWorkspaceId: 'ws-a', activeConversationId: 'conv-1' })
    await useStore.getState().openConversation('conv-1')

    expect(snapshot).toHaveBeenCalledWith('conv-1')
    expect(useStore.getState().streaming['conv-1']).toBe('text produced while the view was closed')
    expect(useStore.getState().generating['conv-1']).toBe(true)
    expect(useStore.getState().toolCalls['conv-1']).toHaveLength(1)
  })
})

describe('events are routed by conversationId', () => {
  it('a delta for a background conversation leaves the visible one alone', () => {
    useStore.setState({
      activeConversationId: 'conv-1',
      streaming: { 'conv-1': 'visible ', 'conv-2': 'background ' }
    })

    useStore.getState().applyEvent({ type: 'delta', conversationId: 'conv-2', text: 'more' })

    expect(useStore.getState().streaming['conv-1']).toBe('visible ')
    expect(useStore.getState().streaming['conv-2']).toBe('background more')
  })

  it('tracks generating per conversation', () => {
    const { applyEvent } = useStore.getState()

    applyEvent({ type: 'state', conversationId: 'conv-1', generating: true })
    applyEvent({ type: 'state', conversationId: 'conv-2', generating: true })
    expect(useStore.getState().isGenerating('conv-1')).toBe(true)
    expect(useStore.getState().isGenerating('conv-2')).toBe(true)

    applyEvent({ type: 'state', conversationId: 'conv-1', generating: false })
    expect(useStore.getState().isGenerating('conv-1')).toBe(false)
    expect(useStore.getState().isGenerating('conv-2')).toBe(true)
  })

  it('surfaces an error only for the visible conversation', () => {
    useStore.setState({ activeConversationId: 'conv-1' })

    useStore
      .getState()
      .applyEvent({ type: 'settled', conversationId: 'conv-2', outcome: 'error', error: 'boom' })
    expect(useStore.getState().lastError).toBeNull()

    useStore
      .getState()
      .applyEvent({ type: 'settled', conversationId: 'conv-1', outcome: 'error', error: 'boom' })
    expect(useStore.getState().lastError).toBe('boom')
  })
})

describe('task tray', () => {
  it('badges running tasks AND live generations, across workspaces', async () => {
    api.tasks.active.mockResolvedValueOnce([
      { id: 't1', workspaceId: 'ws-b', workspaceName: 'B', type: 'ingest', status: 'running' }
    ] as never)

    await useStore.getState().refreshTasks()
    useStore.setState({ generating: { 'conv-1': true, 'conv-2': true, 'conv-3': false } })

    expect(useStore.getState().taskBadge()).toBe(3)
  })

  it('opening a task from another workspace switches to it', async () => {
    useStore.setState({ activeWorkspaceId: 'ws-a', trayOpen: true })

    await useStore.getState().openTask({
      id: 't1',
      workspaceId: 'ws-b',
      workspaceName: 'B',
      type: 'ingest',
      status: 'running',
      createdAt: '1'
    })

    expect(useStore.getState().activeWorkspaceId).toBe('ws-b')
    expect(useStore.getState().trayOpen).toBe(false)
    expect(cancel).not.toHaveBeenCalled()
  })
})

describe('conversation filtering', () => {
  it('filters by title in the store, not in a component', () => {
    useStore.setState({
      conversations: [
        { id: 'a', title: 'Kestrels', pinned: 0, updatedAt: '2' },
        { id: 'b', title: 'Ospreys', pinned: 0, updatedAt: '1' }
      ] as never
    })

    useStore.getState().setConversationQuery('kest')
    expect(
      useStore
        .getState()
        .filteredConversations()
        .map((c) => c.id)
    ).toEqual(['a'])

    useStore.getState().setConversationQuery('')
    expect(useStore.getState().filteredConversations()).toHaveLength(2)
  })
})
