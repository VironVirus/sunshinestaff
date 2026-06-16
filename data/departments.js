export const departments = [
  {
    key: "food_beverages",
    name: "Food and Beverages",
    managerTitle: "F&B Manager",
    summary: "Coordinates breakfast readiness, meal counts, and guest dining service.",
    focus: [
      "See the latest in-house count from Front Office.",
      "Track the number of guests entitled to breakfast.",
    ],
    privileges: {
      line_staff: [
        "View live in-house guest count.",
        "See breakfast entitlement numbers before service opens.",
        "Follow the latest operational note shared by Front Office.",
      ],
      manager: [
        "Everything available to line staff.",
        "Lead breakfast planning using the current occupancy snapshot.",
        "Coordinate handover with Front Office and Night Duty.",
      ],
    },
  },
  {
    key: "front_office",
    name: "Front Office",
    managerTitle: "Front Office Manager",
    summary: "Controls room availability, in-house figures, and breakfast entitlement updates.",
    focus: [
      "Update in-house count in real time.",
      "Update available rooms and breakfast entitlement.",
    ],
    privileges: {
      line_staff: [
        "Update in-house guest count.",
        "Update available rooms and breakfast entitlement.",
        "Print the daily occupancy and breakfast snapshot.",
      ],
      manager: [
        "Everything available to line staff.",
        "Oversee all Front Office updates for the day.",
        "Lead department operations and handovers.",
      ],
    },
  },
  {
    key: "it",
    name: "IT",
    managerTitle: "IT Manager",
    summary: "Maintains the portal, permissions, and shared staff systems.",
    focus: [
      "The first registered IT manager becomes the overall admin.",
      "IT can extend modules and manage system-wide updates.",
    ],
    privileges: {
      line_staff: [
        "Support portal maintenance and staff technical issues.",
        "Assist with system rollout and troubleshooting.",
      ],
      manager: [
        "Become overall admin if you are the first IT manager registered.",
        "Edit shared portal content and oversee all departments.",
        "Coordinate future system integrations for each department.",
      ],
    },
  },
  {
    key: "executive_management",
    name: "Executive Management",
    managerTitle: "Executive Leadership",
    summary: "Executive oversight for the hotel's operations, planning, and cross-department decisions.",
    focus: [
      "Executive accounts have hotel-wide visibility.",
      "Managing Director, Executive Chairman, Operations Manager, and General Manager are super admins.",
    ],
    privileges: {
      line_staff: [
        "View executive notices shared with staff.",
      ],
      manager: [
        "See every manager workspace across the hotel.",
        "Access hotel-wide oversight as a super admin account.",
        "Follow events, complaints, and operational updates from every department.",
      ],
    },
  },
  {
    key: "maintainance",
    name: "Maintainance",
    managerTitle: "Maintainance Manager",
    summary: "Tracks property issues, repairs, and room readiness support.",
    focus: [
      "Department tools can be added here next.",
      "Managers will head all maintainance requests and handovers.",
    ],
    privileges: {
      line_staff: [
        "View maintainance department updates.",
        "Follow work priorities shared by the department head.",
      ],
      manager: [
        "Everything available to line staff.",
        "Lead department planning and future task workflows.",
      ],
    },
  },
  {
    key: "store",
    name: "Store",
    managerTitle: "Store Manager",
    summary: "Handles stock visibility, internal requisitions, and supply readiness.",
    focus: [
      "Department inventory tools can be added later.",
      "Managers will control stock-related workflows here.",
    ],
    privileges: {
      line_staff: [
        "View store updates and supply notes.",
      ],
      manager: [
        "Everything available to line staff.",
        "Head store requests and supply coordination.",
      ],
    },
  },
  {
    key: "accounts",
    name: "Accounts",
    managerTitle: "Accounts Manager",
    summary: "Supports finance coordination, reconciliations, and reporting visibility.",
    focus: [
      "Department financial workflows can be integrated here later.",
      "Managers will direct all accounts operations from this space.",
    ],
    privileges: {
      line_staff: [
        "View accounts updates and notices.",
      ],
      manager: [
        "Everything available to line staff.",
        "Lead the department and future finance workflows.",
      ],
    },
  },
  {
    key: "audit",
    name: "Audit",
    managerTitle: "Audit Manager",
    summary: "Supports compliance checks, reconciliations, and audit reporting.",
    focus: [
      "Audit workflows can be added as a dedicated module.",
      "Managers will oversee department reporting and review.",
    ],
    privileges: {
      line_staff: [
        "View audit notices and department updates.",
      ],
      manager: [
        "Everything available to line staff.",
        "Lead audit reviews and reporting workflows.",
      ],
    },
  },
  {
    key: "human_resource",
    name: "Human Resource",
    managerTitle: "HR Manager",
    summary: "Supports people operations, announcements, recognition, and staff records.",
    focus: [
      "Recognition and staff profile workflows can expand from here.",
      "Managers can later manage people operations in this portal.",
    ],
    privileges: {
      line_staff: [
        "View staff communications and HR updates.",
      ],
      manager: [
        "Everything available to line staff.",
        "Lead people operations and future staff record tools.",
      ],
    },
  },
  {
    key: "kitchen",
    name: "Kitchen",
    managerTitle: "Kitchen Manager",
    summary: "Coordinates production planning and kitchen shift readiness.",
    focus: [
      "Kitchen workflows can be plugged in as the next module.",
      "Managers will direct kitchen planning and service support.",
    ],
    privileges: {
      line_staff: [
        "View kitchen updates and shift notices.",
      ],
      manager: [
        "Everything available to line staff.",
        "Lead department setup and future production workflows.",
      ],
    },
  },
  {
    key: "security",
    name: "Security",
    managerTitle: "Security Manager",
    summary: "Coordinates incident visibility, shift alerts, and property security updates.",
    focus: [
      "Security workflows can be integrated into this portal later.",
      "Managers will head security coordination and reporting.",
    ],
    privileges: {
      line_staff: [
        "View shift alerts and department notices.",
      ],
      manager: [
        "Everything available to line staff.",
        "Lead security reporting and response coordination.",
      ],
    },
  },
  {
    key: "housekeeping",
    name: "HouseKeeping",
    managerTitle: "HouseKeeping Manager",
    summary: "Supports room status follow-up, staffing readiness, and floor coordination.",
    focus: [
      "See the current number of available rooms from Front Office.",
      "HouseKeeping manager can update the number of cleaned rooms.",
    ],
    privileges: {
      line_staff: [
        "View department notices and room readiness updates.",
      ],
      manager: [
        "Everything available to line staff.",
        "See the current available-room count from Front Office.",
        "Update cleaned-room progress for the live dashboard.",
      ],
    },
  },
  {
    key: "night_duty",
    name: "Night Duty",
    managerTitle: "Night Duty Manager",
    summary: "Monitors overnight operations and receives the daily occupancy handover.",
    focus: [
      "See in-house and breakfast numbers from Front Office.",
      "Night Duty manager can print a daily report for handover.",
    ],
    privileges: {
      line_staff: [
        "View the current in-house count and breakfast entitlement.",
        "Follow overnight notes shared by Front Office.",
      ],
      manager: [
        "Everything available to line staff.",
        "Print the daily room and breakfast report.",
        "Lead overnight handover and reporting.",
      ],
    },
  },
];

export const departmentsByKey = Object.fromEntries(
  departments.map((department) => [department.key, department]),
);

export const departmentOptions = departments.map((department) => ({
  value: department.key,
  label: department.name,
}));
