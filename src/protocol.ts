export interface WorkerRequest {
  id: number;
  action: string;
  args: Record<string, unknown>;
  operationId?: string;
}

export interface WorkerResult {
  ok: boolean;
  action: string;
  [key: string]: unknown;
}

export interface WorkerResponse {
  id: number;
  result: WorkerResult;
}
