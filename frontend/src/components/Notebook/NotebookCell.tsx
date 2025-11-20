import { Brain, Terminal, ArrowRight, ChevronRight } from "lucide-react";
import { ExperimentStep } from "@/lib/useExperiment";
import { cn } from "@/lib/utils";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface NotebookCellProps {
    step: ExperimentStep;
}

export function NotebookCell({ step }: NotebookCellProps) {
    const { type, content } = step;

    if (type === "thought") {
        return (
            <div className="animate-in fade-in slide-in-from-bottom-2 duration-500">
                <div className="flex items-center gap-2 mb-2">
                    <div className="w-1 h-1 rounded-full bg-[#424245]" />
                    <span className="text-[10px] font-medium text-[#424245] uppercase tracking-widest">Thinking</span>
                </div>
                <div className="pl-3 border-l border-[#1d1d1f] ml-0.5">
                    <div className="text-xs text-[#86868b] leading-relaxed font-light whitespace-pre-wrap">
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
            <div className="animate-in fade-in slide-in-from-bottom-2 duration-500">
                <div className="flex items-center gap-2 mb-2">
                    <Terminal className="w-3 h-3 text-[#424245]" />
                    <span className="text-[10px] font-medium text-[#424245] uppercase tracking-widest">Command</span>
                </div>
                <div className="bg-[#0a0a0a] border border-[#1d1d1f] rounded-sm overflow-hidden">
                    <pre className="p-3 text-[10px] font-mono text-[#d1d1d6] overflow-x-auto custom-scrollbar">
                        {content}
                    </pre>
                </div>
            </div>
        );
    }

    if (type === "result") {
        return (
            <div className="animate-in fade-in slide-in-from-bottom-2 duration-500">
                <div className="flex items-center gap-2 mb-2">
                    <ArrowRight className="w-3 h-3 text-[#424245]" />
                    <span className="text-[10px] font-medium text-[#424245] uppercase tracking-widest">Output</span>
                </div>
                <div className="pl-3 border-l border-[#1d1d1f] ml-0.5">
                    <pre className="text-[10px] font-mono text-[#86868b] overflow-x-auto custom-scrollbar whitespace-pre-wrap">
                        {content}
                    </pre>
                </div>
            </div>
        );
    }

    return null;
}
