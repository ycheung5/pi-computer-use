export function validateDiscoveryTrace(
  events: Array<{ request?: string }>,
): void;
export function validateModelRoster(
  discovered: string[],
  modelNames: string[],
): void;
export function closeProvider(
  server: {
    close(callback: (error?: Error) => void): unknown;
    closeAllConnections(): void;
  },
  failure: unknown,
  timeoutMs: number,
): Promise<{ confirmed: boolean; failure: unknown }>;
export function canRemoveHome(status: {
  processClosed: boolean;
  observerCleanupConfirmed: boolean;
  groupGone: boolean;
  providerCloseConfirmed: boolean;
}): boolean;
