/** Operational BOM status helpers (manufacturing planning, not accounting). */



const BomStatus = {

  DRAFT: "DRAFT",

  APPROVED: "APPROVED",

  INACTIVE: "INACTIVE",

  ARCHIVED: "ARCHIVED",

};



const BomType = {

  STANDARD: "STANDARD",

  APPROXIMATE: "APPROXIMATE",

  CUSTOMER_SPECIFIC: "CUSTOMER_SPECIFIC",

};



/** Statuses that block SO auto-close / downstream "clear" checks. */

const OPEN_BOM_STATUSES_FOR_PLANNING = [BomStatus.DRAFT, BomStatus.APPROVED];



function bomIsApproved(row) {

  if (!row) return false;

  if (String(row.status ?? "") === BomStatus.APPROVED) return true;

  return row.isLocked === true && row.status == null;

}



function bomIsDraft(row) {

  return String(row?.status ?? BomStatus.DRAFT) === BomStatus.DRAFT;

}



function bomIsInactive(row) {

  return String(row?.status ?? "") === BomStatus.INACTIVE;

}



function bomIsArchived(row) {

  return String(row?.status ?? "") === BomStatus.ARCHIVED;

}



function bomIsEditableWithoutAdmin(row) {

  return bomIsDraft(row);

}



function bomLooksLocked(row) {

  return bomIsApproved(row);

}



/** Prisma where for production RM issue / RM check (approved recipe only). */

function approvedBomWhere(fgItemId) {

  return {

    fgItemId: Number(fgItemId),

    status: BomStatus.APPROVED,

  };

}



/** Prefer latest approved revision when multiple rows exist. */

const approvedBomOrderBy = { revisionNo: "desc" };



function latestApprovedBomFindArgs(fgItemId) {

  return {

    where: approvedBomWhere(fgItemId),

    orderBy: approvedBomOrderBy,

  };

}



module.exports = {

  BomStatus,

  BomType,

  OPEN_BOM_STATUSES_FOR_PLANNING,

  bomIsApproved,

  bomIsDraft,

  bomIsInactive,

  bomIsArchived,

  bomIsEditableWithoutAdmin,

  bomLooksLocked,

  approvedBomWhere,

  approvedBomOrderBy,

  latestApprovedBomFindArgs,

};


