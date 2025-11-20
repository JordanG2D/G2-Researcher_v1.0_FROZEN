import { useEffect, useRef } from "react";
import { AgentState } from "@/lib/useExperiment";
import { NotebookCell } from "./NotebookCell";
import { StatusBadge } from "../StatusBadge";

interface AgentNotebookProps {
    agent: AgentState;
}

export function AgentNotebook({ agent }: AgentNotebookProps) {
    const scrollRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to bottom when new steps are added
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [agent.steps.length]);

    return (
        <div className="flex flex-col h-full border border-[#1d1d1f] bg-black/50 backdrop-blur-sm transition-colors duration-500">
            {/* Header - Ultra Minimal */}
            <div className="flex-shrink-0 h-12 px-4 border-b border-[#1d1d1f] flex items-center justify-between bg-black/50">
                <div className="flex items-center gap-3">
                    <span className="text-[10px] font-medium text-[#f5f5f7] tracking-widest uppercase">
                        Agent {agent.id}
                    </span>
                    <div className="w-[1px] h-3 bg-[#1d1d1f]" />
                    <span className="text-[10px] font-medium text-[#6e6e73] uppercase tracking-widest">
                        {agent.gpu || "CPU"}
                    </span>
                </div>
                <StatusBadge status={agent.status} />
            </div>

            {/* Hypothesis - Clean & Typography focused */}
            {agent.hypothesis && (
                <div className="flex-shrink-0 p-4 border-b border-[#1d1d1f] bg-black">
                    <div className="text-[10px] font-medium text-[#424245] uppercase tracking-widest mb-2">
                        Objective
                    </div>
                    <div className="text-xs text-[#86868b] font-light leading-relaxed line-clamp-2">
                        {agent.hypothesis}
                    </div>
                </div>
            )}

            {/* Notebook Content */}
            <div 
                ref={scrollRef}
                className="flex-1 overflow-y-auto p-4 custom-scrollbar scroll-smooth"
            >
                <div className="space-y-8">
                    {agent.steps.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center min-h-[200px]">
                            <div className="w-1 h-1 rounded-full bg-[#333] mb-3" />
                            <span className="text-[10px] font-medium text-[#424245] uppercase tracking-widest">Initializing Environment</span>
                        </div>
                    ) : (
                        agent.steps.map((step) => (
                            <NotebookCell key={step.id} step={step} />
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}
