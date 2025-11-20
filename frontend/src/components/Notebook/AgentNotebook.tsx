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
        <div className="flex flex-col h-full bg-card/30 backdrop-blur-sm border border-border/40 rounded-xl overflow-hidden shadow-2xl shadow-black/20 transition-all hover:border-border/60 group">
            {/* Minimal Header */}
            <div className="flex-shrink-0 px-6 py-4 border-b border-border/20 bg-card/20 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full bg-white/20 group-hover:bg-white/40 transition-colors" />
                    <div className="flex flex-col">
                        <span className="text-sm font-medium text-foreground/90 tracking-tight">
                            Researcher {agent.id}
                        </span>
                        <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
                            {agent.gpu || "CPU"}
                        </span>
                    </div>
                </div>
                <StatusBadge status={agent.status} />
            </div>

            {/* Hypothesis / Context */}
            {agent.hypothesis && (
                <div className="flex-shrink-0 px-6 py-3 bg-muted/5 border-b border-border/20">
                    <div className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-widest mb-1">
                        Current Hypothesis
                    </div>
                    <div className="text-xs text-muted-foreground/80 font-sans leading-relaxed line-clamp-2">
                        {agent.hypothesis}
                    </div>
                </div>
            )}

            {/* Notebook Content */}
            <div 
                ref={scrollRef}
                className="flex-1 overflow-y-auto p-6 custom-scrollbar scroll-smooth"
            >
                <div className="space-y-2">
                    {agent.steps.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-muted-foreground/20 space-y-2 min-h-[200px]">
                            <div className="w-8 h-8 rounded-full border border-current flex items-center justify-center">
                                <span className="text-xs">AG</span>
                            </div>
                            <span className="text-xs font-medium uppercase tracking-widest">Awaiting Tasks</span>
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
