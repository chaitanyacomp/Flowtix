import { useAuth } from "../../hooks/useAuth";
import { AdminOperationalDashboardPage } from "../DashboardPage";
import { PurchaseDashboardPage } from "../PurchaseDashboardPage";
import { QaDashboardPage } from "../QaDashboardPage";
import { StoreDashboardPage } from "../store/StoreDashboardPage";
import { useDashboardPendingActionsDesk } from "../../hooks/useDashboardPendingActionsDesk";

function PurchaseDashboardWithPending() {
  const { deskProps } = useDashboardPendingActionsDesk({ fetchDelayMs: 0 });
  return <PurchaseDashboardPage pendingActions={deskProps} />;
}

function QaDashboardWithPending() {
  const { deskProps } = useDashboardPendingActionsDesk({ fetchDelayMs: 0 });
  return <QaDashboardPage pendingActions={deskProps} />;
}

export function DashboardPage() {
  const auth = useAuth();
  const role = auth.user?.role ?? "";

  switch (role) {
    case "PURCHASE":
      return <PurchaseDashboardWithPending />;
    case "QA":
      return <QaDashboardWithPending />;
    case "STORE":
      return <StoreDashboardPage />;
    case "PRODUCTION":
      return <AdminOperationalDashboardPage role="PRODUCTION" />;
    case "ADMIN":
      return <AdminOperationalDashboardPage role="ADMIN" />;
    default:
      return <AdminOperationalDashboardPage role="ADMIN" />;
  }
}
