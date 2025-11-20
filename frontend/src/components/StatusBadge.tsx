import { cn } from "@/lib/utils";

interface StatusBadgeProps {
  status: "idle" | "running" | "completed" | "failed" | "planning";
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = {
    idle: {
      text: "Idle",
      dotColor: "bg-[#333]",
    },
    running: {
      text: "Running",
      dotColor: "bg-blue-500",
      animate: true,
    },
    planning: {
      text: "Planning",
      dotColor: "bg-purple-500",
      animate: true,
    },
    completed: {
      text: "Done",
      dotColor: "bg-green-500",
    },
    failed: {
      text: "Failed",
      dotColor: "bg-red-500",
    },
  };

  const { text, dotColor, animate } = config[status];

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div 
        className={cn(
          "h-1.5 w-1.5 rounded-full transition-colors duration-500", 
          dotColor,
          animate && "animate-pulse"
        )} 
      />
      <span className="text-[10px] font-medium tracking-widest text-[#86868b] uppercase">
        {text}
      </span>
    </div>
  );
}
