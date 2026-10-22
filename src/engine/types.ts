export interface FailureEvidence {
  id: string;
  flowId: string;
  time: string;
  message: string;
  url: string;
  consoleErrors: string[];
  failedRequests: string[];
  screenshotPath?: string;
  tracePath?: string;
}
export interface RunReport { succeeded: string[]; failures: FailureEvidence[]; }
