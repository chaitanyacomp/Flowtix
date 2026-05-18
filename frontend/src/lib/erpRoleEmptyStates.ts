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
      if (role === "QC") {
        return {
          title: "No batches awaiting QC.",
          body: "Production output will appear here when posted.",
        };
      }
      return {
        title: "No pending QC batches for this order.",
        body: "Use Show: All or Completed QC to review prior batches.",
      };

    case "dispatch_queue":
      if (role === "STORE") {
        return {
          title: "No dispatch drafts pending.",
          body: "Select a sales order with dispatchable stock to prepare a draft.",
        };
      }
      if (role === "ACCOUNTS") {
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
          body: "Planning will release work orders when requirement and RM are ready.",
        };
      }
      if (role === "SALES" || role === "STORE") {
        return {
          title: "No open work orders.",
          body: "Create a work order from an approved sales order when planning is complete.",
        };
      }
      return {
        title: "No open work orders.",
        body: "Select an approved sales order above to create one.",
      };

    case "work_orders_none":
      return {
        title: "No work orders yet.",
        body:
          role === "PRODUCTION"
            ? "Work orders appear here after planning releases them."
            : "Select an approved sales order, set WO qty, and create a work order.",
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
