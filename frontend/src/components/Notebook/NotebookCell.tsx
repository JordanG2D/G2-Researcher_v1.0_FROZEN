import { Brain, Terminal, ArrowRight } from "lucide-react";
import { ExperimentStep } from "@/lib/useExperiment";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface NotebookCellProps {
    step: ExperimentStep;
}

export function NotebookCell({ step }: NotebookCellProps) {
    const { type, content } = step;

    if (type === "thought") {
        return (
            <div className="flex gap-4 mb-6 animate-in fade-in slide-in-from-bottom-2 duration-500 group">
                <div className="mt-1 flex-shrink-0 opacity-40 group-hover:opacity-100 transition-opacity">
                    <div className="h-6 w-6 rounded-full bg-purple-500/10 flex items-center justify-center border border-purple-500/20">
                        <Brain className="h-3 w-3 text-purple-400" />
                    </div>
                </div>
                <div className="flex-1 space-y-1">
                    <div className="text-[10px] font-medium text-purple-400/60 uppercase tracking-widest">Thinking</div>
                    <div className="text-sm text-muted-foreground/80 leading-relaxed font-sans prose prose-invert prose-sm max-w-none prose-p:leading-relaxed prose-pre:bg-black/50 prose-pre:border prose-pre:border-white/10">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {content}
                        </ReactMarkdown>
                    </div>
                </div>
            </div>
        );
    }

    if (type === "code") {
        return (
            <div className="flex gap-4 mb-6 animate-in fade-in slide-in-from-bottom-2 duration-500 group">
                <div className="mt-1 flex-shrink-0 opacity-40 group-hover:opacity-100 transition-opacity">
                    <div className="h-6 w-6 rounded-full bg-blue-500/10 flex items-center justify-center border border-blue-500/20">
                        <Terminal className="h-3 w-3 text-blue-400" />
                    </div>
                </div>
                <div className="flex-1 space-y-2 min-w-0">
                    <div className="text-[10px] font-medium text-blue-400/60 uppercase tracking-widest">Tool Call</div>
                    <div className="bg-black/40 rounded border border-border/40 overflow-hidden">
                        <pre className="p-3 text-xs font-mono text-blue-100/90 overflow-x-auto custom-scrollbar">
                            {content}
                        </pre>
                    </div>
                </div>
            </div>
        );
    }

    if (type === "result") {
        return (
            <div className="flex gap-4 mb-8 animate-in fade-in slide-in-from-bottom-2 duration-500 group">
                <div className="mt-1 flex-shrink-0 opacity-40 group-hover:opacity-100 transition-opacity">
                    <div className="h-6 w-6 rounded-full bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20">
                        <ArrowRight className="h-3 w-3 text-emerald-400" />
                    </div>
                </div>
                <div className="flex-1 space-y-2 min-w-0">
                    <div className="text-[10px] font-medium text-emerald-400/60 uppercase tracking-widest">Result</div>
                    <div className="bg-emerald-950/5 rounded border border-emerald-500/10 overflow-hidden">
                        <pre className="p-3 text-xs font-mono text-emerald-100/70 overflow-x-auto max-h-60 custom-scrollbar">
                            {content}
                        </pre>
                    </div>
                </div>
            </div>
        );
    }

    return null;
}
