import { FlaskConical, BookOpen, Settings, Terminal } from "lucide-react";
import { cn } from "@/lib/utils";

export function Sidebar() {
  return (
    <div className="w-64 h-screen border-r bg-card flex flex-col">
      <div className="p-6 flex items-center gap-3 border-b border-border/40">
        <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center">
          <FlaskConical className="w-5 h-5 text-white" />
        </div>
        <span className="font-serif font-medium text-lg tracking-tight">
          Fractal Notebook
        </span>
      </div>

      <div className="flex-1 py-6 px-3 space-y-1">
        <NavItem icon={BookOpen} label="Lab Notebook" active />
        <NavItem icon={Terminal} label="Console Output" />
        <NavItem icon={Settings} label="Settings" />
      </div>

      <div className="p-4 border-t border-border/40">
        <div className="flex items-center gap-3 px-2 py-2 rounded-md hover:bg-muted/50 transition-colors cursor-pointer">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600" />
          <div className="flex flex-col">
            <span className="text-sm font-medium">Principal Investigator</span>
            <span className="text-xs text-muted-foreground">Online</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function NavItem({
  icon: Icon,
  label,
  active,
}: {
  icon: any;
  label: string;
  active?: boolean;
}) {
  return (
    <button
      className={cn(
        "w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-all",
        active
          ? "bg-white/5 text-white font-medium"
          : "text-muted-foreground hover:text-white hover:bg-white/5"
      )}
    >
      <Icon className="w-4 h-4" />
      {label}
    </button>
  );
}
