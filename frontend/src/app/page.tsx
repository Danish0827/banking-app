import { ApiStatus } from "@/components/ApiStatus";

export default function Home() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight">Banking App</h1>
        <p className="mt-2 text-sm text-slate-600">
          Project foundation is in place. Account features arrive in the next milestones.
        </p>
        <div className="mt-6 border-t border-slate-200 pt-4">
          <ApiStatus />
        </div>
      </div>
    </main>
  );
}
