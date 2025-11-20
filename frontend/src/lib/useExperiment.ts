import { useState, useRef } from "react";
import { streamExperiment, LogEvent } from "./api";

export type StepType = "thought" | "code" | "result" | "text";

export interface ExperimentStep {
    id: string;
    type: StepType;
    content: string;
    metadata?: Record<string, any>;
    timestamp: number;
}

export interface AgentState {
    id: string;
    status: "idle" | "running" | "completed" | "failed";
    hypothesis?: string;
    gpu?: string;
    logs: string[];
    exitCode?: number;
    steps: ExperimentStep[];
}

export type TimelineItem =
    | { type: "thought"; content: string; timestamp: number }
    | { type: "agents"; agentIds: string[]; timestamp: number }
    | { type: "paper"; content: string; timestamp: number };

export interface OrchestratorState {
    status: "idle" | "planning" | "running" | "completed";
    thoughts: string[];
    plan: string[];
    timeline: TimelineItem[];
}

export function useExperiment() {
    const [isRunning, setIsRunning] = useState(false);
    const [logs, setLogs] = useState<LogEvent[]>([]);
    const [agents, setAgents] = useState<Record<string, AgentState>>({});
    const [orchestrator, setOrchestrator] = useState<OrchestratorState>({
        status: "idle",
        thoughts: [],
        plan: [],
        timeline: [],
    });
    const [error, setError] = useState<string | null>(null);

    // Keep track of the latest agents state to update it functionally
    const agentsRef = useRef<Record<string, AgentState>>({});

    const updateAgent = (id: string, update: Partial<AgentState>) => {
        setAgents((prev) => {
            const current = prev[id] || { id, status: "idle", logs: [], steps: [] };
            const next = {
                ...prev,
                [id]: { ...current, ...update },
            };
            agentsRef.current = next;
            return next;
        });
    };

    const addAgentStep = (id: string, step: Omit<ExperimentStep, "id" | "timestamp">) => {
        setAgents((prev) => {
            const current = prev[id] || { id, status: "idle", logs: [], steps: [] };
            const newStep: ExperimentStep = {
                ...step,
                id: Math.random().toString(36).substring(7),
                timestamp: Date.now(),
            };

            const next = {
                ...prev,
                [id]: {
                    ...current,
                    steps: [...current.steps, newStep],
                },
            };
            agentsRef.current = next;
            return next;
        });
    };

    const appendToLatestAgentStep = (id: string, type: StepType, chunk: string) => {
        setAgents((prev) => {
            const current = prev[id];
            if (!current || current.steps.length === 0) return prev;

            const steps = [...current.steps];
            const lastStep = steps[steps.length - 1];

            // If the last step matches the type, append to it.
            // Otherwise, we might need to create a new one, but for 'result' streaming
            // we generally expect a result block to exist (created by TOOL_CALL or just implicitly).
            // If it doesn't exist or type doesn't match, we'll create a new one.
            if (lastStep.type === type) {
                steps[steps.length - 1] = {
                    ...lastStep,
                    content: lastStep.content + chunk
                };
            } else {
                // Fallback: create new step if types mismatch
                steps.push({
                    id: Math.random().toString(36).substring(7),
                    type,
                    content: chunk,
                    timestamp: Date.now(),
                });
            }

            const next = {
                ...prev,
                [id]: { ...current, steps }
            };
            agentsRef.current = next;
            return next;
        });
    };

    const startExperiment = async (
        mode: "single" | "orchestrator",
        config: {
            task: string;
            gpu?: string;
            num_agents?: number;
            max_rounds?: number;
            max_parallel?: number;
            test_mode?: boolean;
        }
    ) => {
        setIsRunning(true);
        setError(null);
        setAgents({});
        setOrchestrator({ thoughts: [], plan: [], timeline: [], status: "running" });

        try {
            const endpoint = mode === "single"
                ? "/api/experiments/single/stream"
                : "/api/experiments/orchestrator/stream";

            const payload = mode === "single"
                ? { task: config.task, gpu: config.gpu, test_mode: config.test_mode }
                : {
                    task: config.task,
                    gpu: config.gpu,
                    num_agents: config.num_agents || 3,
                    max_rounds: config.max_rounds || 3,
                    max_parallel: config.max_parallel || 2,
                    test_mode: config.test_mode
                };

            await streamExperiment(
                endpoint,
                payload,
                (event) => {
                    setLogs((prev) => [...prev, event]);

                    if (event.type === "line" && event.plain) {
                        // Check for ::EVENT:: marker
                        const eventIndex = event.plain.indexOf("::EVENT::");
                        if (eventIndex !== -1) {
                            try {
                                const jsonStr = event.plain.substring(eventIndex + "::EVENT::".length);
                                const payload = JSON.parse(jsonStr);

                                // Try to extract Agent ID from prefix if present: "[Agent 1] ::EVENT::..."
                                let inferredAgentId: string | undefined;
                                const prefix = event.plain.substring(0, eventIndex);
                                const match = prefix.match(/\[Agent (\d+)\]/);
                                if (match) {
                                    inferredAgentId = match[1];
                                }

                                handleStructuredEvent(payload, inferredAgentId);
                            } catch (e) {
                                console.warn("Failed to parse structured event:", e);
                            }
                        }
                    }
                },
                (err) => {
                    setError(err.message);
                    setIsRunning(false);
                },
                () => {
                    setIsRunning(false);
                }
            );
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to start experiment");
            setIsRunning(false);
        }
    };

    const handleStructuredEvent = (event: any, inferredAgentId?: string) => {
        const { type, data } = event;

        switch (type) {
            case "AGENT_START":
                updateAgent(data.agent_id, {
                    status: "running",
                    hypothesis: data.hypothesis,
                    gpu: data.gpu,
                });

                // Add agent to the current 'agents' timeline item if it exists, or create new one
                setOrchestrator((prev) => {
                    const lastItem = prev.timeline[prev.timeline.length - 1];
                    if (lastItem && lastItem.type === "agents") {
                        // Check if agent is already in the list to avoid dupes
                        if (lastItem.agentIds.includes(data.agent_id)) {
                            return prev;
                        }
                        // Update the last item in place (immutably)
                        const newTimeline = [...prev.timeline];
                        newTimeline[newTimeline.length - 1] = {
                            ...lastItem,
                            agentIds: [...lastItem.agentIds, data.agent_id]
                        };
                        return { ...prev, timeline: newTimeline };
                    } else {
                        // Create new agents group
                        return {
                            ...prev,
                            timeline: [
                                ...prev.timeline,
                                { type: "agents", agentIds: [data.agent_id], timestamp: Date.now() }
                            ]
                        };
                    }
                });
                break;

            case "AGENT_THOUGHT":
                if (inferredAgentId) {
                    addAgentStep(inferredAgentId, {
                        type: "thought",
                        content: data.thought,
                    });
                }
                break;

            case "AGENT_TOOL":
                if (inferredAgentId) {
                    addAgentStep(inferredAgentId, {
                        type: "code",
                        content: `${data.tool}(${JSON.stringify(data.args, null, 2)})`,
                        metadata: { tool: data.tool, args: data.args },
                    });
                }
                break;

            case "AGENT_TOOL_RESULT":
                if (inferredAgentId) {
                    // Update the latest step if it's a result block (from streaming),
                    // otherwise create a new one.
                    setAgents((prev) => {
                        const current = prev[inferredAgentId];
                        if (!current) return prev;

                        const steps = [...current.steps];
                        const lastStep = steps[steps.length - 1];

                        if (lastStep && lastStep.type === "result") {
                            // Update existing result block with the final full content
                            steps[steps.length - 1] = {
                                ...lastStep,
                                content: data.result,
                                metadata: { ...lastStep.metadata, tool: data.tool }
                            };
                        } else {
                            // Create new result block
                            steps.push({
                                id: Math.random().toString(36).substring(7),
                                type: "result",
                                content: data.result,
                                metadata: { tool: data.tool },
                                timestamp: Date.now(),
                            });
                        }

                        return {
                            ...prev,
                            [inferredAgentId]: { ...current, steps }
                        };
                    });
                }
                break;

            case "AGENT_STREAM":
                if (inferredAgentId && typeof data?.chunk === "string") {
                    // Stream incremental sandbox output into the latest result cell.
                    // NotebookCell already handles carriage returns (\r) to render
                    // tqdm-style progress bars cleanly.
                    appendToLatestAgentStep(inferredAgentId, "result", data.chunk);
                }
                break;

            case "AGENT_COMPLETE":
                updateAgent(data.agent_id, {
                    status: "completed",
                    exitCode: data.exit_code,
                });
                break;

            case "ORCH_THOUGHT":
                setOrchestrator((prev) => ({
                    ...prev,
                    thoughts: [...prev.thoughts, data.thought],
                    timeline: [
                        ...prev.timeline,
                        { type: "thought", content: data.thought, timestamp: Date.now() }
                    ]
                }));
                break;

            case "ORCH_PAPER":
                setOrchestrator((prev) => ({
                    ...prev,
                    timeline: [
                        ...prev.timeline,
                        { type: "paper", content: data.content, timestamp: Date.now() }
                    ]
                }));
                break;

            case "ORCH_TOOL":
                // We could also track orchestrator steps if we wanted a notebook for it
                break;
        }
    };

    // We need a way to parse the agent ID from the line if it exists.
    // The orchestrator prefixes: `[Agent {id}] `

    return {
        isRunning,
        logs,
        agents,
        orchestrator,
        error,
        startExperiment,
    };
}
