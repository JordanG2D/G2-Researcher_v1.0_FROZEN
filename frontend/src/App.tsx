import { Sidebar } from "@/components/Sidebar";
import { LabNotebook } from "@/components/LabNotebook";

function App() {
  return (
    <div className="flex h-screen w-full bg-background text-foreground font-sans antialiased selection:bg-white/20">
      <Sidebar />
      <LabNotebook />
    </div>
  );
}

export default App;
