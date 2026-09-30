import { ApiStatus } from "@/components/ApiStatus";
import { HomePanel } from "@/components/HomePanel";

export default function Home() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <HomePanel />
        <div className="mt-6 border-t border-slate-200 pt-4">
          <ApiStatus />
        </div>
      </div>
    </main>
  );
}
