// Pi is an external host seam: retain its tool definitions and shutdown handlers.
export function computerUseHost() {
  const tools = new Map();
  const shutdown = [];
  const events = new Map();
  return {
    tools,
    shutdown,
    async emit(event, value) {
      for (const handler of events.get(event) ?? []) await handler(value);
    },
    api: {
      registerTool(tool) {
        tools.set(tool.name, tool);
      },
      on(event, handler) {
        if (event === "session_shutdown") shutdown.push(handler);
        const handlers = events.get(event) ?? [];
        handlers.push(handler);
        events.set(event, handlers);
        return () => {};
      },
    },
  };
}
