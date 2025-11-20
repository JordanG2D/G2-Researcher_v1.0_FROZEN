import { useEffect, useRef } from "react";
import { LogEvent } from "@/lib/api";
import { cn } from "@/lib/utils";

interface ConsoleProps {
  logs: LogEvent[];
  className?: string;
}

export function Console({ logs, className }: ConsoleProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  return (
    <div
      className={cn(
        "bg-black border border-border/40 rounded-lg overflow-hidden flex flex-col font-mono text-xs",
        className
      )}
    >
      <div className="px-4 py-2 border-b border-border/40 bg-muted/20 flex items-center justify-between">
        <span className="text-muted-foreground">Console Output</span>
        <div className="flex gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-red-500/20 border border-red-500/50" />
          <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/20 border border-yellow-500/50" />
          <div className="w-2.5 h-2.5 rounded-full bg-green-500/20 border border-green-500/50" />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-1 max-h-[300px]">
        {logs.length === 0 && (
          <div className="text-muted-foreground/50 italic">
            Waiting for process output...
          </div>
        )}
        {logs.map((log, i) => (
          <div key={i} className="whitespace-pre-wrap break-all">
            <span className="text-muted-foreground select-none mr-3">
              {new Date(log.timestamp).toLocaleTimeString([], {
                hour12: false,
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </span>
            <span
              className={cn(
                log.stream === "stderr" ? "text-red-400" : "text-zinc-300"
              )}
            >
              {log.plain || log.raw}
            </span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
