import { Role } from '../types/auth';

export interface NavItem {
  id: string;
  label: string;
  href: string;
  iconName: string;
  allowedRoles: Role[];
  badge?: string;
  description?: string;
  children?: {
    id: string;
    label: string;
    href: string;
    allowedRoles: Role[];
    badge?: string;
  }[];
}

export interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
  allowedRoles: Role[];
}

export const NAVIGATION_GROUPS: NavGroup[] = [
  // ── 1. Workspace ────────────────────────────────────────────────────────────
  {
    id: 'workspace',
    label: 'Workspace',
    allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT'],
    items: [
      {
        id: 'dashboard',
        label: 'Dashboard Overview',
        href: '/dashboard',
        iconName: 'LayoutDashboard',
        allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT'],
        description: 'Multi-branch operations, real-time metrics & financial pulse',
      },
      {
        id: 'pos-billing-direct',
        label: 'Point of Sale (POS)',
        href: '/pos',
        iconName: 'Receipt',
        allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT'],
        badge: 'Counter',
        description: 'Instant billing, payments & outstanding receivables collection',
      },
    ],
  },

  // ── 2. Staff Workspace (Staff Portal Only) ──────────────────────────────────
  {
    id: 'staff-personal',
    label: 'My Workspace',
    allowedRoles: ['STAFF'],
    items: [
      {
        id: 'staff-portal-group',
        label: 'Staff Portal',
        href: '/my-performance',
        iconName: 'UserCheck',
        allowedRoles: ['STAFF'],
        description: 'Personal services, commissions, punches & reports',
        children: [
          {
            id: 'my-performance',
            label: 'My Performance & Tips',
            href: '/my-performance',
            allowedRoles: ['STAFF'],
          },
          {
            id: 'my-attendance',
            label: 'My Attendance & Shifts',
            href: '/my-attendance',
            allowedRoles: ['STAFF'],
          },
          {
            id: 'my-reports',
            label: 'My Payout Reports',
            href: '/my-reports',
            allowedRoles: ['STAFF'],
          },
        ],
      },
    ],
  },

  // ── 3. Salon Operations ─────────────────────────────────────────────────────
  {
    id: 'operations',
    label: 'Salon Operations',
    allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT', 'STAFF'],
    items: [
      {
        id: 'salon-bookings',
        label: 'Salon & Bookings',
        href: '/operations/bookings',
        iconName: 'Calendar',
        allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT', 'STAFF'],
        description: 'Multi-chair calendar, CRM client directory & service catalogue',
        children: [
          {
            id: 'event-bookings',
            label: 'Bridal / Groom Bookings',
            href: '/operations/bookings',
            allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT', 'STAFF'],
          },
          {
            id: 'appointments',
            label: 'Appointments Calendar',
            href: '/operations/appointments',
            allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT', 'STAFF'],
          },
          {
            id: 'clients',
            label: 'Clients & CRM Directory',
            href: '/operations/clients',
            allowedRoles: ['SUPER_ADMIN', 'ADMIN'],
          },
          {
            id: 'services-packages',
            label: 'Services & Packages Master',
            href: '/operations/services-packages',
            allowedRoles: ['SUPER_ADMIN', 'ADMIN'],
          },
        ],
      },
      {
        id: 'staff-attendance-group',
        label: 'Staff & Attendance',
        href: '/operations/staff',
        iconName: 'Users',
        allowedRoles: ['SUPER_ADMIN', 'ADMIN'],
        description: 'Stylists directory, biometric punches, leaves & overtime approvals',
        children: [
          {
            id: 'staff-directory',
            label: 'Staff Directory & Contracts',
            href: '/operations/staff',
            allowedRoles: ['SUPER_ADMIN', 'ADMIN'],
          },
          {
            id: 'attendance-punches',
            label: 'Attendance & Punches',
            href: '/operations/attendance',
            allowedRoles: ['SUPER_ADMIN', 'ADMIN'],
          },
          {
            id: 'leave-management',
            label: 'Leave Management',
            href: '/operations/leaves',
            allowedRoles: ['SUPER_ADMIN', 'ADMIN'],
          },
          {
            id: 'manual-overtime',
            label: 'Manual Overtime Approvals',
            href: '/operations/manual-overtime',
            allowedRoles: ['SUPER_ADMIN', 'ADMIN'],
          },
        ],
      },
      {
        id: 'inventory-management',
        label: 'Inventory Management',
        href: '/operations/inventory',
        iconName: 'Boxes',
        allowedRoles: ['SUPER_ADMIN', 'ADMIN'],
        description: 'Product master, stock purchases, vendor directory, supplier khata & audits',
        children: [
          {
            id: 'inventory-stocks',
            label: 'Inventory & Stocks',
            href: '/operations/inventory',
            allowedRoles: ['SUPER_ADMIN', 'ADMIN'],
          },
          {
            id: 'stock-in',
            label: 'Stock In (Purchases)',
            href: '/operations/stock-in',
            allowedRoles: ['SUPER_ADMIN', 'ADMIN'],
          },
          {
            id: 'suppliers',
            label: 'Suppliers & Vendors',
            href: '/operations/suppliers',
            allowedRoles: ['SUPER_ADMIN', 'ADMIN'],
          },
          {
            id: 'supplier-ledger',
            label: 'Supplier Ledger (Khata)',
            href: '/operations/supplier-ledger',
            allowedRoles: ['SUPER_ADMIN', 'ADMIN'],
          },
          {
            id: 'stock-adjustments',
            label: 'Stock Adjustments',
            href: '/operations/stock-adjustments',
            allowedRoles: ['SUPER_ADMIN', 'ADMIN'],
          },
        ],
      },
    ],
  },

  // ── 4. Accounts & Finance ───────────────────────────────────────────────────
  {
    id: 'accounts',
    label: 'Accounts & Finance',
    allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT'],
    items: [
      {
        id: 'sales-billing-group',
        label: 'Sales & Billing',
        href: '/pos',
        iconName: 'Receipt',
        allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT'],
        description: 'POS counter, invoice ledger & customer debt recovery',
        children: [
          {
            id: 'pos-counter',
            label: 'POS Billing Counter',
            href: '/pos',
            allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT'],
          },
          {
            id: 'sales-invoices-log',
            label: 'Sales Invoices Log',
            href: '/reports/sales-invoices',
            allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT'],
          },
          {
            id: 'unpaid-invoices',
            label: 'Unpaid Invoices & Receivables',
            href: '/reports/unpaid-invoices',
            allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT'],
          },
        ],
      },
      {
        id: 'expense-management-group',
        label: 'Expense Management',
        href: '/accounts/expenses',
        iconName: 'CreditCard',
        allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT'],
        description: 'Cash drawer disbursements & itemized expenses',
        children: [
          {
            id: 'expense-vouchers',
            label: 'Operating Expenses',
            href: '/accounts/expenses',
            allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT'],
          },
          {
            id: 'detailed-expenses',
            label: 'Detailed Expenses Drilldown',
            href: '/reports/detailed-expenses',
            allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT'],
          },
        ],
      },
      {
        id: 'salary-and-loan',
        label: 'Salary and Loan Management',
        href: '/accounts/salary/generate',
        iconName: 'Banknote',
        allowedRoles: ['SUPER_ADMIN', 'ADMIN'], // Accountant excluded
        description: 'Salary generation, disbursements, allowances, commission & loans',
        children: [
          {
            id: 'generate-salary',
            label: 'Generate Salary',
            href: '/accounts/salary/generate',
            allowedRoles: ['SUPER_ADMIN', 'ADMIN'],
          },
          {
            id: 'manage-salaries',
            label: 'Manage Salaries',
            href: '/accounts/salary/manage',
            allowedRoles: ['SUPER_ADMIN', 'ADMIN'],
          },
          {
            id: 'loan-management',
            label: 'Loan Management',
            href: '/accounts/salary/loans',
            allowedRoles: ['SUPER_ADMIN', 'ADMIN'],
          },
          {
            id: 'allowances-adjustments',
            label: 'Allowances & Adjustments',
            href: '/accounts/salary/allowances',
            allowedRoles: ['SUPER_ADMIN', 'ADMIN'],
          },
          {
            id: 'staff-commission',
            label: 'Staff Commission',
            href: '/accounts/salary/commission',
            allowedRoles: ['SUPER_ADMIN', 'ADMIN'],
          },
        ],
      },
      {
        id: 'cash-custody-group',
        label: 'Cash Custody & Settlement',
        href: '/accounts/my-balance-sheet',
        iconName: 'Scale',
        allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT'],
        description: 'Till balance, safe transfers, tips gratuity & account settlement',
        children: [
          {
            id: 'my-balance-sheet',
            label: 'My Balance Sheet (Till)',
            href: '/accounts/my-balance-sheet',
            allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT'],
          },
          {
            id: 'account-settlement',
            label: 'Account Settlement (Safe)',
            href: '/accounts/account-settlement',
            allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT'],
          },
          {
            id: 'tips-management',
            label: 'Tips Management & Gratuity',
            href: '/accounts/tips-management',
            allowedRoles: ['SUPER_ADMIN', 'ADMIN'],
          },
        ],
      },
      {
        id: 'ledger-group',
        label: 'Financial Ledgers & Statements',
        href: '/accounts/ledger',
        iconName: 'BookOpen',
        allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT'],
        description: 'Double-entry general ledger & debit / credit statement',
        children: [
          {
            id: 'general-ledger-item',
            label: 'General Ledger',
            href: '/accounts/ledger',
            allowedRoles: ['SUPER_ADMIN', 'ADMIN'],
          },
          {
            id: 'debit-credit-movements',
            label: 'Debit / Credit Statement',
            href: '/reports/debit-credit',
            allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT'],
          },
        ],
      },
    ],
  },

  // ── 5. Reporting & Analytics (Unified All-in-One Reporting Hub) ─────────────
  {
    id: 'reporting',
    label: 'Reporting & Analytics',
    allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT'],
    items: [
      {
        id: 'unified-reports-hub',
        label: 'Reports & Analytics',
        href: '/reports/income-expense',
        iconName: 'BarChart3',
        allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT'],
        description: 'Unified reporting center: Financials, Sales, HR, Attendance, Tax & Inventory',
        children: [
          {
            id: 'rep-inc-exp',
            label: 'Income & Expense Statement',
            href: '/reports/income-expense',
            allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT'],
          },
          {
            id: 'rep-op-profit',
            label: 'Operating Profit (P&L)',
            href: '/reports/operating-profit',
            allowedRoles: ['SUPER_ADMIN', 'ADMIN'],
          },
          {
            id: 'rep-detailed-inc',
            label: 'Detailed Income Statement',
            href: '/reports/detailed-income',
            allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT'],
          },
          {
            id: 'rep-detailed-exp',
            label: 'Detailed Expenses Report',
            href: '/reports/detailed-expenses',
            allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT'],
          },
          {
            id: 'rep-tax-mgmt',
            label: 'Tax Management Report',
            href: '/reports/tax',
            allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT'],
          },
          {
            id: 'rep-deb-cred',
            label: 'Debit / Credit Statement',
            href: '/reports/debit-credit',
            allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT'],
          },
          {
            id: 'rep-sales-inv',
            label: 'Sales & Invoices Audit',
            href: '/reports/sales-invoices',
            allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT'],
          },
          {
            id: 'rep-unpaid-inv',
            label: 'Unpaid Invoices & Receivables',
            href: '/reports/unpaid-invoices',
            allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT'],
          },
          {
            id: 'rep-appts-audit',
            label: 'Appointments Report',
            href: '/reports/appointments',
            allowedRoles: ['SUPER_ADMIN', 'ADMIN'],
          },
          {
            id: 'rep-st-perf',
            label: 'Staff Performance Report',
            href: '/reports/staff-performance',
            allowedRoles: ['SUPER_ADMIN', 'ADMIN'],
          },
          {
            id: 'rep-st-sal',
            label: 'Staff Salary Report',
            href: '/reports/staff-salary',
            allowedRoles: ['SUPER_ADMIN', 'ADMIN'],
          },
          {
            id: 'rep-st-comm',
            label: 'Staff Commission Report',
            href: '/reports/staff-commission',
            allowedRoles: ['SUPER_ADMIN', 'ADMIN'],
          },
          {
            id: 'rep-st-att',
            label: 'Attendance & Overtime Report',
            href: '/reports/attendance',
            allowedRoles: ['SUPER_ADMIN', 'ADMIN'],
          },
          {
            id: 'rep-st-tips',
            label: 'Tips Statement Report',
            href: '/reports/tips-statement',
            allowedRoles: ['SUPER_ADMIN', 'ADMIN'],
          },
          {
            id: 'rep-inv-mov',
            label: 'Stock Movement & Valuation',
            href: '/reports/inventory-movement',
            allowedRoles: ['SUPER_ADMIN', 'ADMIN'],
          },
        ],
      },
    ],
  },

  // ── 6. Administration ───────────────────────────────────────────────────────
  {
    id: 'administration',
    label: 'Administration',
    allowedRoles: ['SUPER_ADMIN', 'ADMIN'],
    items: [
      {
        id: 'system-settings-group',
        label: 'System & Branch Settings',
        href: '/admin/branch-settings',
        iconName: 'Sliders',
        allowedRoles: ['SUPER_ADMIN', 'ADMIN'],
        description: 'Branch profile, hours, default tax rules and attendance shift timings',
        children: [
          {
            id: 'salon-profile-child',
            label: 'Salon Profile & Branding',
            href: '/admin/branch-settings',
            allowedRoles: ['SUPER_ADMIN', 'ADMIN'],
          },
          {
            id: 'payment-accounts-child',
            label: 'Payment Accounts',
            href: '/admin/payment-accounts',
            allowedRoles: ['SUPER_ADMIN'],
          },
          {
            id: 'tax-settings-child',
            label: 'Branch Tax Settings',
            href: '/admin/tax-settings',
            allowedRoles: ['SUPER_ADMIN'],
          },
          {
            id: 'attendance-settings-child',
            label: 'Attendance & Shift Rules',
            href: '/admin/attendance-settings',
            allowedRoles: ['SUPER_ADMIN', 'ADMIN'],
          },
          {
            id: 'device-settings-child',
            label: 'Hardware & Device Integration',
            href: '/admin/devices',
            allowedRoles: ['SUPER_ADMIN', 'ADMIN'],
            badge: 'Devices',
          },
          {
            id: 'branches-child',
            label: 'Multi-Branch Management',
            href: '/admin/branches',
            allowedRoles: ['SUPER_ADMIN'], // Only Super Admin
          },
        ],
      },
      {
        id: 'security-audit-group',
        label: 'Security & Access Control',
        href: '/admin/users',
        iconName: 'ShieldCheck',
        allowedRoles: ['SUPER_ADMIN', 'ADMIN'],
        description: 'User access credentials, immutable audit logs & test data reset',
        children: [
          {
            id: 'users-access-child',
            label: 'Users & Permissions',
            href: '/admin/users',
            allowedRoles: ['SUPER_ADMIN', 'ADMIN'],
          },
          {
            id: 'activity-log-child',
            label: 'Audit & Activity Log',
            href: '/admin/activity-log',
            allowedRoles: ['SUPER_ADMIN', 'ADMIN'],
          },
          {
            id: 'data-reset-child',
            label: 'Reset Test Data (Zero Registers)',
            href: '/admin/data-reset',
            allowedRoles: ['SUPER_ADMIN', 'ADMIN'],
          },
        ],
      },
    ],
  },
];
