export const API_BASE_URL = "http://localhost:8000";

export interface SingleExperimentRequest {
    task: string;
    gpu?: string;
    test_mode?: boolean;
}

export interface OrchestratorExperimentRequest {
    task: string;
    gpu?: string;
    num_agents: number;
    max_rounds: number;
    max_parallel: number;
    test_mode?: boolean;
}

export type ExperimentRequest =
    | SingleExperimentRequest
    | OrchestratorExperimentRequest;

export interface LogEvent {
    type: "line" | "summary";
    stream?: "stdout" | "stderr";
    timestamp: string;
    raw?: string;
    plain?: string;
    exit_code?: number;
    duration_seconds?: number;
}

export async function streamExperiment(
    endpoint: "/api/experiments/single/stream" | "/api/experiments/orchestrator/stream",
    payload: ExperimentRequest,
    onData: (data: LogEvent) => void,
    onError: (error: Error) => void,
    onComplete: () => void
) {
    try {
        const response = await fetch(`${API_BASE_URL}${endpoint}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            throw new Error(`API Error: ${response.status} ${response.statusText}`);
        }

        if (!response.body) {
            throw new Error("No response body");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const event = JSON.parse(line);
                    onData(event);
                } catch (e) {
                    console.warn("Failed to parse JSON line:", line, e);
                }
            }
        }

        onComplete();
    } catch (error) {
        onError(error instanceof Error ? error : new Error(String(error)));
    }
}
