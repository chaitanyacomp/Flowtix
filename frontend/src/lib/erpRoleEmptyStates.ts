/**
 * Role-aware empty-state copy — labels only.
 */

export type ErpWorkspaceEmptyKey =
  | "production_queue"
  | "qc_batches"
  | "dispatch_queue"
  | "work_orders_open"
  | "work_orders_none"
  | "accounts_billing_pending";

export type RoleEmptyState = { title: string; body?: string };

export function getRoleEmptyState(workspace: ErpWorkspaceEmptyKey, role: string): RoleEmptyState {
  switch (workspace) {
    case "production_queue":
      if (role === "PRODUCTION") {
        return {
          title: "No work orders pending for production.",
          body: "Open Work Orders to start or select a line from the queue.",
        };
      }
      return {
        title: "No production lines available.",
        body: "Create a work order or check requirement planning.",
      };

    case "qc_batches":
      if (role === "QA" || role === "PRODUCTION") {
        return {
          title: "No batches awaiting QA.",
          body: "Approved production output will appear here for quality checks.",
        };
      }
      return {
        title: "No pending QA batches for this order.",
        body: "Use Show: All or completed QA to review prior batches.",
      };

    case "dispatch_queue":
      if (role === "STORE") {
        return {
          title: "No dispatch drafts pending.",
          body: "Select a sales order with dispatchable stock to prepare a draft.",
        };
      }
      if (role === "PURCHASE") {
        return {
          title: "No dispatches ready in this view.",
          body: "Finalized dispatches awaiting billing appear on the commercial desk.",
        };
      }
      return {
        title: "No dispatch activity in this view.",
        body: "Choose a sales order and line to prepare or finalize dispatch.",
      };

    case "work_orders_open":
      if (role === "PRODUCTION") {
        return {
          title: "No open work orders.",
          body: "Work orders appear here after Store completes RM validation on sales orders.",
        };
      }
      return {
        title: "No Work Orders available.",
        body: "Work Orders are created from Sales Orders after RM validation.",
      };

    case "work_orders_none":
      return {
        title: "No Work Orders available.",
        body: "Work Orders are created from Sales Orders after RM validation.",
      };

    case "accounts_billing_pending":
      return {
        title: "No finalized dispatches awaiting billing.",
        body: "Locked dispatches without a sales bill will appear here.",
      };

    default:
      return { title: "Nothing to show in this view." };
  }
}
