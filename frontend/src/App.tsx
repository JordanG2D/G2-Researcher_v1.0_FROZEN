import { LabNotebook } from "@/components/LabNotebook";

function App() {
  return (
    <div className="flex h-screen w-full bg-black text-foreground font-sans antialiased selection:bg-white/20">
      <LabNotebook />
    </div>
  );
}

export default App;
