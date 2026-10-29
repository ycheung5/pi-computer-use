// Pi is an external host seam: retain its tool definitions and shutdown handlers.
export function computerUseHost() {
  const tools = new Map();
  const shutdown = [];
  return {
    tools,
    shutdown,
    api: {
      registerTool(tool) {
        tools.set(tool.name, tool);
      },
      on(event, handler) {
        if (event === "session_shutdown") shutdown.push(handler);
        return () => {};
      },
    },
  };
}
