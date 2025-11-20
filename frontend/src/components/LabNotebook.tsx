import { useState, useEffect, useRef } from "react";
import { Play, StopCircle, Sparkles, LayoutGrid, Terminal, Activity, FileText } from "lucide-react";
import { useExperiment } from "@/lib/useExperiment";
import { AgentNotebook } from "./Notebook/AgentNotebook";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";

export function LabNotebook() {
  const { isRunning, agents, orchestrator, error, startExperiment } =
    useExperiment();
  const [task, setTask] = useState("");
  const [mode, setMode] = useState<"single" | "orchestrator">("orchestrator");
  const [testMode, setTestMode] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevTimelineLengthRef = useRef(0);

  // Auto-scroll effect
  useEffect(() => {
    const currentLength = orchestrator.timeline.length;
    const prevLength = prevTimelineLengthRef.current;

    if (currentLength > prevLength) {
        // New item added
        const lastItem = orchestrator.timeline[currentLength - 1];
        
        // Scroll if it's a new agents group or paper, or if it's the very first thought
        if (lastItem.type === "agents" || lastItem.type === "paper" || currentLength === 1) {
            bottomRef.current?.scrollIntoView({ behavior: "smooth" });
        }
    }
    
    prevTimelineLengthRef.current = currentLength;
  }, [orchestrator.timeline]);

  const handleStart = () => {
    if (!task.trim()) return;
    startExperiment(mode, {
      task,
      gpu: "any", // Default to any GPU
      num_agents: 3,
      max_rounds: 3,
      max_parallel: 2,
      test_mode: testMode,
    });
  };

  return (
    <div className="flex-1 h-screen overflow-hidden flex flex-col bg-background font-sans selection:bg-purple-500/20">
      {/* Header */}
      <header className="h-14 border-b border-border/40 flex items-center justify-between px-6 bg-card/50 backdrop-blur-sm z-10">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="font-medium text-foreground tracking-tight">Research Protocol</span>
          <span className="text-border">/</span>
          <span className="text-muted-foreground">
            {task || "Untitled Experiment"}
          </span>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground font-medium">
            <Activity className="w-3.5 h-3.5" />
            <span>System Ready</span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-hidden flex">
        {/* Left Panel: Input & Config */}
        <div className="w-80 flex-shrink-0 p-6 flex flex-col gap-6 overflow-y-auto border-r border-border/40 bg-card/20">
          <div className="space-y-4">
            <div>
              <h1 className="text-lg font-medium tracking-tight mb-2 text-foreground">
                Research Objective
              </h1>
              <p className="text-muted-foreground text-xs leading-relaxed">
                Define the hypothesis or research question to investigate.
              </p>
            </div>

            <div className="relative group">
              <textarea
                value={task}
                onChange={(e) => setTask(e.target.value)}
                disabled={isRunning}
                placeholder="e.g., Investigate the scaling laws of test-time compute on reasoning tasks..."
                className="w-full h-40 bg-muted/20 border border-border/40 rounded-xl p-4 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-purple-500/20 focus:border-purple-500/20 transition-all placeholder:text-muted-foreground/30 font-medium leading-relaxed"
              />
              <div className="absolute bottom-3 right-3 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                <button
                  onClick={() => setTestMode(!testMode)}
                  disabled={isRunning}
                  className={cn(
                    "px-2 py-1 rounded-lg text-[10px] font-medium transition-all backdrop-blur-sm border",
                    testMode
                      ? "bg-amber-500/10 border-amber-500/20 text-amber-500"
                      : "bg-black/40 border-white/10 text-muted-foreground hover:bg-black/60"
                  )}
                >
                  {testMode ? "TEST MODE" : "REAL MODE"}
                </button>
                <select
                  value={mode}
                  onChange={(e) =>
                    setMode(e.target.value as "single" | "orchestrator")
                  }
                  disabled={isRunning}
                  className="bg-black/40 border border-white/10 rounded-lg px-2 py-1 text-[10px] text-muted-foreground focus:outline-none backdrop-blur-sm hover:bg-black/60 transition-colors"
                >
                  <option value="single">Single Agent</option>
                  <option value="orchestrator">Orchestrator Swarm</option>
                </select>
                <button
                  onClick={handleStart}
                  disabled={isRunning || !task.trim()}
                  className={cn(
                    "flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-medium transition-all backdrop-blur-sm",
                    isRunning
                      ? "bg-muted text-muted-foreground cursor-not-allowed"
                      : "bg-white text-black hover:bg-white/90 shadow-[0_0_15px_rgba(255,255,255,0.1)]"
                  )}
                >
                  {isRunning ? (
                    <>
                      <StopCircle className="w-3 h-3" />
                      Running...
                    </>
                  ) : (
                    <>
                      <Play className="w-3 h-3" />
                      Start
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
          
          {error && (
            <div className="p-4 rounded-xl bg-red-500/5 border border-red-500/10 text-red-400 text-xs leading-relaxed">
              Error: {error}
            </div>
          )}
        </div>

        {/* Right Panel: Visual Notebook Area */}
        <div className="flex-1 flex flex-col overflow-hidden bg-black/20 relative">
            {/* Background Pattern */}
            <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808008_1px,transparent_1px),linear-gradient(to_bottom,#80808008_1px,transparent_1px)] bg-[size:24px_24px] pointer-events-none" />
            
            <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
                <div className="max-w-7xl mx-auto space-y-8 pb-20">
                    
                    {/* Timeline Rendering */}
                    {orchestrator.timeline.map((item, index) => {
                        if (item.type === "thought") {
                            return (
                                <div key={index} className="w-full animate-in fade-in slide-in-from-bottom-4 duration-500">
                                    <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-medium text-purple-400/80 mb-3 px-1">
                                        <Sparkles className="w-3 h-3" />
                                        Principal Investigator
                                    </div>
                                    <div className="bg-card/40 border border-purple-500/10 rounded-2xl p-6 backdrop-blur-md shadow-2xl shadow-purple-900/5 relative overflow-hidden group">
                                        <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 via-transparent to-transparent opacity-50" />
                                        <div className="relative flex gap-4">
                                            <div className="mt-1.5 h-1.5 w-1.5 rounded-full bg-purple-400 shadow-[0_0_10px_rgba(192,132,252,0.5)] flex-shrink-0" />
                                            <div className="text-sm text-muted-foreground/80 leading-relaxed font-sans whitespace-pre-wrap">
                                                {item.content}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        } else if (item.type === "agents") {
                            return (
                                <div key={index} className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
                                    <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-medium text-blue-400/80 px-1">
                                        <LayoutGrid className="w-3 h-3" />
                                        Active Researchers
                                    </div>
                                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                                        {item.agentIds.map((agentId) => {
                                            const agent = agents[agentId];
                                            if (!agent) return null;
                                            return (
                                                <div key={agentId} className="h-[600px]">
                                                    <AgentNotebook agent={agent} />
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        } else if (item.type === "paper") {
                            return (
                                <div key={index} className="w-full animate-in fade-in slide-in-from-bottom-4 duration-500">
                                    <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-medium text-green-400/80 mb-3 px-1">
                                        <FileText className="w-3 h-3" />
                                        Final Research Report
                                    </div>
                                    <div className="bg-card/40 border border-green-500/10 rounded-2xl p-8 backdrop-blur-md shadow-2xl shadow-green-900/5 relative overflow-hidden">
                                        <div className="absolute inset-0 bg-gradient-to-br from-green-500/5 via-transparent to-transparent opacity-50" />
                                        <div className="relative prose prose-invert prose-sm max-w-none prose-headings:text-foreground prose-p:text-muted-foreground prose-strong:text-foreground prose-code:text-foreground prose-pre:bg-black/40 prose-pre:border prose-pre:border-white/10">
                                            <ReactMarkdown>{item.content}</ReactMarkdown>
                                        </div>
                                    </div>
                                </div>
                            );
                        }
                        return null;
                    })}

                    {/* Empty State */}
                    {!isRunning && orchestrator.timeline.length === 0 && (
                        <div className="h-full flex flex-col items-center justify-center text-muted-foreground/20 space-y-6 mt-32">
                            <div className="h-24 w-24 rounded-full bg-muted/5 flex items-center justify-center border border-white/5">
                                <Terminal className="h-10 w-10" />
                            </div>
                            <div className="text-center space-y-2">
                                <p className="text-sm font-medium text-foreground/40">Ready to start research</p>
                                <p className="text-xs text-muted-foreground/30">Configure your objective in the sidebar</p>
                            </div>
                        </div>
                    )}
                    
                    <div ref={bottomRef} />
                </div>
            </div>
        </div>
      </main>
    </div>
  );
}
