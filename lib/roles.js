import { departmentsByKey } from "@/data/departments";

export const executiveSuperAdminTitles = [
  "Managing Director",
  "Executive Chairman",
  "Operations Manager",
  "General Manager",
];

export const accountApprovalOptions = [
  { value: "pending", label: "Pending approval" },
  { value: "approved", label: "Approved" },
];

export const jobLevelOptions = [
  { value: "manager", label: "Manager" },
  { value: "supervisor", label: "Supervisor" },
  { value: "line_staff", label: "Line Staff" },
];

export const operationsMetricConfig = {
  inHouse: {
    label: "In-house guests",
    shortLabel: "In-house",
  },
  availableRooms: {
    label: "Available rooms",
    shortLabel: "Available rooms",
  },
  breakfastEntitled: {
    label: "Breakfast entitlement",
    shortLabel: "Breakfast entitlement",
  },
  cleanedRooms: {
    label: "Cleaned rooms",
    shortLabel: "Cleaned rooms",
  },
};

export function getDepartment(departmentKey) {
  return departmentsByKey[departmentKey] ?? null;
}

export function getDepartmentName(departmentKey) {
  return getDepartment(departmentKey)?.name ?? "Unassigned";
}

export function getPrivilegeList(departmentKey, jobLevel) {
  const department = getDepartment(departmentKey);

  if (!department) {
    return [];
  }

  return department.privileges[jobLevel === "line_staff" ? "line_staff" : "manager"] ?? [];
}

export function getDefaultStaffTitle(departmentKey, jobLevel) {
  const department = getDepartment(departmentKey);

  if (!department) {
    if (jobLevel === "manager") {
      return "Manager";
    }

    if (jobLevel === "supervisor") {
      return "Supervisor";
    }

    return "Line Staff";
  }

  if (departmentKey === "executive_management" && jobLevel === "manager") {
    return executiveSuperAdminTitles[0];
  }

  if (jobLevel === "manager") {
    return department.managerTitle || `${department.name} Manager`;
  }

  if (jobLevel === "supervisor") {
    return `${department.name} Supervisor`;
  }

  return `${department.name} Staff`;
}

export function getStaffTitleOptions(departmentKey, jobLevel) {
  if (departmentKey === "executive_management" && jobLevel === "manager") {
    return executiveSuperAdminTitles.map((title) => ({
      value: title,
      label: title,
    }));
  }

  const defaultTitle = getDefaultStaffTitle(departmentKey, jobLevel);
  return [
    {
      value: defaultTitle,
      label: defaultTitle,
    },
  ];
}

export function formatJobLevel(jobLevel) {
  if (jobLevel === "manager") {
    return "Manager";
  }

  if (jobLevel === "supervisor") {
    return "Supervisor";
  }

  return "Line Staff";
}

export function isManager(profile) {
  return profile?.jobLevel === "manager";
}

export function isSupervisor(profile) {
  return profile?.jobLevel === "supervisor";
}

export function isLead(profile) {
  return isManager(profile) || isSupervisor(profile);
}

export function isSuperAdmin(profile) {
  return Boolean(profile?.isSuperAdmin);
}

export function isFrontOfficeManager(profile) {
  return profile?.departmentKey === "front_office" && isLead(profile);
}

export function isHousekeepingManager(profile) {
  return profile?.departmentKey === "housekeeping" && isLead(profile);
}

export function isMaintenanceManager(profile) {
  return profile?.departmentKey === "maintainance" && isLead(profile);
}

export function isHumanResourceManager(profile) {
  return profile?.departmentKey === "human_resource" && isLead(profile);
}

export function isAuditManager(profile) {
  return profile?.departmentKey === "audit" && isLead(profile);
}

export function isNightDutyManager(profile) {
  return profile?.departmentKey === "night_duty" && isLead(profile);
}

export function isStoreStaff(profile) {
  return profile?.departmentKey === "store";
}

export function canAccessManagerWorkspace(profile) {
  return isSuperAdmin(profile) || isLead(profile);
}

export function getAccessLabel(profile) {
  if (isSuperAdmin(profile)) {
    return "Super Admin";
  }

  if (isManager(profile)) {
    return "Manager";
  }

  if (isSupervisor(profile)) {
    return "Supervisor";
  }

  return "Line Staff";
}

export function getApprovalStatus(profile) {
  return profile?.approvalStatus ?? "approved";
}

export function isApprovedProfile(profile) {
  return getApprovalStatus(profile) === "approved";
}

export function getOperationsAccess(profile) {
  if (!profile || !canAccessManagerWorkspace(profile)) {
    return {
      canViewPanel: false,
      canEditFrontOffice: false,
      canEditHousekeeping: false,
      canPrint: false,
      visibleMetrics: [],
    };
  }

  if (isSuperAdmin(profile)) {
    return {
      canViewPanel: true,
      canEditFrontOffice: true,
      canEditHousekeeping: true,
      canPrint: true,
      visibleMetrics: [
        "inHouse",
        "availableRooms",
        "breakfastEntitled",
        "cleanedRooms",
      ],
    };
  }

  if (isFrontOfficeManager(profile)) {
    return {
      canViewPanel: true,
      canEditFrontOffice: true,
      canEditHousekeeping: false,
      canPrint: true,
      visibleMetrics: [
        "inHouse",
        "availableRooms",
        "breakfastEntitled",
        "cleanedRooms",
      ],
    };
  }

  if (profile.departmentKey === "food_beverages") {
    return {
      canViewPanel: true,
      canEditFrontOffice: false,
      canEditHousekeeping: false,
      canPrint: true,
      visibleMetrics: ["inHouse", "breakfastEntitled"],
    };
  }

  if (profile.departmentKey === "night_duty") {
    return {
      canViewPanel: true,
      canEditFrontOffice: false,
      canEditHousekeeping: false,
      canPrint: true,
      visibleMetrics: ["inHouse", "breakfastEntitled"],
    };
  }

  if (isHousekeepingManager(profile)) {
    return {
      canViewPanel: true,
      canEditFrontOffice: false,
      canEditHousekeeping: true,
      canPrint: true,
      visibleMetrics: ["inHouse", "availableRooms", "cleanedRooms"],
    };
  }

  return {
    canViewPanel: false,
    canEditFrontOffice: false,
    canEditHousekeeping: false,
    canPrint: false,
    visibleMetrics: [],
  };
}

export function getPropertyAccess(profile) {
  const managerView = canAccessManagerWorkspace(profile);

  return {
    canViewPanel: managerView,
    canViewRoomIssues: managerView,
    canViewUtilities: managerView,
    canViewComplaints: managerView,
    canEditRoomIssues:
      isSuperAdmin(profile) ||
      isHousekeepingManager(profile) ||
      isMaintenanceManager(profile),
    canEditUtilities:
      isSuperAdmin(profile) ||
      isMaintenanceManager(profile) ||
      isNightDutyManager(profile),
    canEditComplaints:
      isSuperAdmin(profile) ||
      isFrontOfficeManager(profile) ||
      isHousekeepingManager(profile) ||
      isMaintenanceManager(profile),
  };
}

export function getManagerWorkspaceAccess(profile) {
  const managerView = canAccessManagerWorkspace(profile);
  const storeWorkspace = isStoreStaff(profile) || isSuperAdmin(profile);
  const canManageStaff =
    isSuperAdmin(profile) ||
    isHumanResourceManager(profile);

  return {
    canViewTabs: managerView || storeWorkspace,
    canViewEvents: managerView,
    canEditEvents:
      isSuperAdmin(profile) ||
      isFrontOfficeManager(profile),
    canManageStaff,
    canApproveStaff: canManageStaff,
    canViewStore: storeWorkspace,
    canEditStore: storeWorkspace,
  };
}

export function getStoreAccess(profile) {
  const storeWorkspace = isStoreStaff(profile) || isSuperAdmin(profile);

  return {
    canViewPanel: storeWorkspace,
    canEditPanel: storeWorkspace,
  };
}

export function getHousekeepingReportAccess(profile) {
  const housekeepingWorkspace =
    isSuperAdmin(profile) ||
    isHousekeepingManager(profile);

  return {
    canViewPanel: housekeepingWorkspace,
    canEditPanel: housekeepingWorkspace,
    canPrintPanel: housekeepingWorkspace,
  };
}

export function getNightDutyAccess(profile) {
  const nightDutyWorkspace = isSuperAdmin(profile) || isNightDutyManager(profile);

  return {
    canViewPanel: nightDutyWorkspace,
    canEditPanel: nightDutyWorkspace,
    canPrintPanel: nightDutyWorkspace,
  };
}

export function getAuditLogAccess(profile) {
  const canViewPanel =
    isSuperAdmin(profile) ||
    isHumanResourceManager(profile) ||
    isAuditManager(profile);

  return {
    canViewPanel,
    canPrintPanel: canViewPanel,
  };
}

export function buildProfilePayload({
  uid,
  fullName,
  email,
  birthday,
  phoneNumber,
  homeAddress,
  departmentKey,
  jobLevel,
  staffTitle,
  isFirstItAdmin,
}) {
  const normalizedTitle = (staffTitle || getDefaultStaffTitle(departmentKey, jobLevel)).trim();
  const isExecutiveSuperAdmin = executiveSuperAdminTitles.includes(normalizedTitle);
  const isSuperAdminAccount = Boolean(isFirstItAdmin || isExecutiveSuperAdmin);
  const approvalStatus = isFirstItAdmin ? "approved" : "pending";

  return {
    uid,
    fullName: fullName.trim(),
    email: email.trim().toLowerCase(),
    birthday: birthday || "",
    phoneNumber: phoneNumber?.trim() ?? "",
    homeAddress: homeAddress?.trim() ?? "",
    departmentKey,
    departmentName: getDepartmentName(departmentKey),
    jobLevel,
    staffTitle: normalizedTitle,
    isSuperAdmin: isSuperAdminAccount,
    approvalStatus,
    approvedAt: approvalStatus === "approved" ? new Date().toISOString() : "",
    approvedByName: approvalStatus === "approved" ? normalizedTitle : "",
    employmentStatus: "active",
    surcharges: "",
    leaveEligibility: "",
    lastProfileNotification: "",
    lastProfileNotificationAt: "",
    accessLevel: isSuperAdminAccount
      ? "super_admin"
      : jobLevel === "manager"
        ? "department_manager"
        : jobLevel === "supervisor"
          ? "department_supervisor"
        : "line_staff",
    privileges: getPrivilegeList(departmentKey, jobLevel),
  };
}
