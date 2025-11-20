import { cn } from "@/lib/utils";
import { Loader2, CheckCircle2, XCircle, Circle } from "lucide-react";

interface StatusBadgeProps {
  status: "idle" | "running" | "completed" | "failed" | "planning";
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = {
    idle: {
      icon: Circle,
      text: "Idle",
      color: "text-muted-foreground",
      bg: "bg-muted/20",
      border: "border-muted/20",
    },
    running: {
      icon: Loader2,
      text: "In Progress",
      color: "text-blue-400",
      bg: "bg-blue-500/10",
      border: "border-blue-500/20",
      animate: true,
    },
    planning: {
      icon: Loader2,
      text: "Planning",
      color: "text-purple-400",
      bg: "bg-purple-500/10",
      border: "border-purple-500/20",
      animate: true,
    },
    completed: {
      icon: CheckCircle2,
      text: "Completed",
      color: "text-green-400",
      bg: "bg-green-500/10",
      border: "border-green-500/20",
    },
    failed: {
      icon: XCircle,
      text: "Failed",
      color: "text-red-400",
      bg: "bg-red-500/10",
      border: "border-red-500/20",
    },
  };

  const { icon: Icon, text, color, bg, border, animate } = config[status];

  return (
    <div
      className={cn(
        "flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-xs font-medium w-fit",
        bg,
        border,
        color,
        className
      )}
    >
      <Icon className={cn("w-3.5 h-3.5", animate && "animate-spin")} />
      <span>{text}</span>
    </div>
  );
}
