import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import { AuthSession } from "apis/model/auth";
import AuthService from "apis/services/Auth";
import LoginScreen from "./LoginScreen";
import SideNav from "./SideNav";

export interface AppOutletContext {
  session: AuthSession;
  logout: () => void;
}

/** Customer support workspace with chat and order-data navigation. */
const AppShell = () => {
  const [session, setSession] = useState<AuthSession | null>(null);

  useEffect(() => {
    setSession(AuthService.getSession());
  }, []);

  const logout = () => {
    AuthService.clearSession();
    setSession(null);
  };

  if (!session) {
    return <LoginScreen onLogin={setSession} />;
  }

  return (
    <div className="h-[100dvh] overflow-hidden bg-background text-on-background font-body-md">
      <SideNav session={session} onLogout={logout} />
      <main className="h-full overflow-hidden pb-16 lg:ml-60 lg:pb-0">
        <Outlet context={{ session, logout } satisfies AppOutletContext} />
      </main>
    </div>
  );
};

export default AppShell;
