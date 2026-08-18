import { useEffect } from "react";
import { AdminAuthGate } from "@/components/dashboard/AdminAuthGate";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { useAdminSession } from "@/hooks/use-admin-session";

export default function Dashboard() {
  const adminSession = useAdminSession();

  useEffect(() => {
    const previousTitle = document.title;
    document.title = "Brimax — Administração";
    return () => {
      document.title = previousTitle;
    };
  }, []);

  return (
    <div className="dashboard-page min-h-screen">
      <AdminAuthGate
        state={adminSession.state}
        config={adminSession.config}
        onCredential={adminSession.acceptCredential}
        onRetry={adminSession.retry}
        onSignOut={adminSession.signOut}
      >
        {adminSession.state.status === "authenticated" && (
          <DashboardShell
            session={adminSession.state.session}
            preview={adminSession.state.preview}
            onSignOut={adminSession.signOut}
          />
        )}
      </AdminAuthGate>
    </div>
  );
}
