import { useEffect, useState } from "react";
import {
  AuthProvider,
  UpdateBanner,
  useAuth,
  type User,
} from "./auth/AuthProvider";
import ConnectScreen from "./auth/ConnectScreen";
import Dashboard from "./dashboard/Dashboard";
import type { DashboardData } from "./dashboard/model";
import DotField from "./ui/DotField";

function AuthGate() {
  const { user } = useAuth();
  const demo = import.meta.env.DEV && new URLSearchParams(window.location.search).has("demo");
  const [demoContent, setDemoContent] = useState<{ data: DashboardData; user: User } | null>(null);

  useEffect(() => {
    if (!demo) return;
    void import("./dashboard/fixture").then(({ DEMO_DASHBOARD, DEMO_USER }) => {
      setDemoContent({ data: DEMO_DASHBOARD, user: DEMO_USER });
    });
  }, [demo]);

  if (demo) return demoContent ? <Dashboard initialData={demoContent.data} demoUser={demoContent.user} /> : null;
  return user ? <Dashboard /> : <ConnectScreen />;
}

export default function App() {
  return (
    <AuthProvider>
      <div className="fixed inset-0 -z-20 bg-bg" />
      <DotField />
      <AuthGate />
      <UpdateBanner />
    </AuthProvider>
  );
}
