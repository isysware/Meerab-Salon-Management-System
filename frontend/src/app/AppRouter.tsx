import React, { useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useRouter } from '../context/RouterContext';
import { canAccessRoute, getDefaultRouteForRole } from '../lib/permissions';
import { NAVIGATION_GROUPS } from '../config/navigation';
import { LoginPage } from '../features/auth/LoginPage';
import { AppShell } from '../components/layout/AppShell';
import { SuperAdminDashboard } from '../features/dashboard/SuperAdminDashboard';
import { AdminDashboard } from '../features/dashboard/AdminDashboard';
import { AccountantDashboard } from '../features/dashboard/AccountantDashboard';
import { StaffDashboard } from '../features/dashboard/StaffDashboard';
import { BranchManagementPage } from '../features/branches/BranchManagementPage';
import { UsersAccessPage } from '../features/users/UsersAccessPage';
import { StaffDirectoryPage } from '../features/staff/StaffDirectoryPage';
import { ServicesPackagesPage } from '../features/catalogue/ServicesPackagesPage';
import { BranchSettingsPage } from '../features/branches/BranchSettingsPage';
import { DeviceIntegrationPage } from '../features/devices/DeviceIntegrationPage';
import { POSBillingPage } from '../features/pos/POSBillingPage';
import { SalesInvoicesPage } from '../features/invoices/SalesInvoicesPage';
import { DetailedIncomeReportPage } from '../features/reports/DetailedIncomeReportPage';
import { UnpaidInvoicesPage } from '../features/invoices/UnpaidInvoicesPage';
import { ExpenseManagementPage } from '../features/expenses/ExpenseManagementPage';
import { MyBalanceSheetPage } from '../features/custody/MyBalanceSheetPage';
import { AccountSettlementPage } from '../features/custody/AccountSettlementPage';
import { StaffAttendancePage } from '../features/attendance/StaffAttendancePage';
import { AttendanceSettingsPage } from '../features/attendance/AttendanceSettingsPage';
import { LeaveManagementPage } from '../features/attendance/LeaveManagementPage';
import { ManualOvertimePage } from '../features/overtime/ManualOvertimePage';
import { PayrollPage } from '../features/payroll/PayrollPage';
import { StaffLoansPage } from '../features/payroll/StaffLoansPage';
import { StaffCommissionPage } from '../features/commission/StaffCommissionPage';
import { StaffPersonalAttendancePage } from '../features/portal/StaffPersonalAttendancePage';
import { StaffPersonalReportsPage } from '../features/portal/StaffPersonalReportsPage';
import { TipsManagementPage } from '../features/tips/TipsManagementPage';
import { TipsStatementPage } from '../features/reports/TipsStatementPage';
import { StaffPerformancePage } from '../features/reports/StaffPerformancePage';
import { AppointmentsPage } from '../features/appointments/AppointmentsPage';
import { BookingsPage } from '../features/bookings/BookingsPage';
import { ClientsPage } from '../features/clients/ClientsPage';
import { AppointmentReportPage } from '../features/reports/AppointmentReportPage';
import { InventoryPage } from '../features/inventory/InventoryPage';
import { InventoryItemsPage } from '../features/inventory/InventoryItemsPage';
import { StockInPurchasesPage } from '../features/inventory/StockInPurchasesPage';
import { SuppliersVendorsPage } from '../features/inventory/SuppliersVendorsPage';
import { StockAdjustmentsPage } from '../features/inventory/StockAdjustmentsPage';
import { InventoryReportsPage } from '../features/reports/InventoryReportsPage';
import { COGSReportPage } from '../features/reports/COGSReportPage';
import { GeneralLedgerPage } from '../features/ledger/GeneralLedgerPage';
import { ActivityLogPage } from '../features/audit/ActivityLogPage';
import { IncomeExpenseReportPage } from '../features/reports/IncomeExpenseReportPage';
import { TaxReportPage } from '../features/reports/TaxReportPage';
import { DebitCreditStatementPage } from '../features/reports/DebitCreditStatementPage';
import { DetailedExpensesReportPage } from '../features/reports/DetailedExpensesReportPage';
import { StaffSalaryReportPage } from '../features/reports/StaffSalaryReportPage';
import { StaffCommissionReportPage } from '../features/reports/StaffCommissionReportPage';
import { AttendanceOvertimeReportPage } from '../features/reports/AttendanceOvertimeReportPage';
import { ScheduledModuleView } from '../features/scaffold/ScheduledModuleView';
import { AccessDeniedView } from '../features/scaffold/AccessDeniedView';
import { ScissorLoader } from '../components/ui/ScissorLoader';
import { PublicReceiptPage } from '../features/receipt/PublicReceiptPage';

export const AppRouter: React.FC = () => {
  const { user, session, isLoading } = useAuth();
  const { pathname, currentRoute, navigate } = useRouter();

  useEffect(() => {
    if (!user || isLoading || !canAccessRoute(user, pathname)) return;
    if (pathname === '/reports/payment-accounts' || pathname === '/reports/cash-drawer') {
      navigate(pathname === '/reports/cash-drawer' ? '/reports/debit-credit?tab=cash' : '/reports/debit-credit', { replace: true });
    }
  }, [user, isLoading, pathname, navigate]);

  // Redirect root '/' to role's default dashboard when authenticated
  useEffect(() => {
    if (!isLoading && user && (pathname === '/' || pathname === '')) {
      navigate(getDefaultRouteForRole(user.role));
    }
  }, [user, pathname, isLoading, navigate]);

  // Public Receipt & Invoice Page (accessible immediately without staff login or auth wait)
  if (pathname.startsWith('/receipt') || pathname.startsWith('/public/receipt') || pathname.startsWith('/r/')) {
    const searchParams = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
    const token = searchParams.get('token');
    const keyParam = searchParams.get('k') || searchParams.get('key');
    const reference = pathname.replace(/^\/(public\/)?(receipt|r)(\/download)?\/?/, '');
    return <PublicReceiptPage reference={reference} token={token} keyParam={keyParam} />;
  }

  // Loading state with Scissors Loader
  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#F5F7FB] flex items-center justify-center font-sans">
        <ScissorLoader size="lg" />
      </div>
    );
  }

  // If not logged in, render the login page
  if (!user || !session) {
    return <LoginPage />;
  }

  // Helper to render the main content according to current pathname
  const renderContent = () => {
    if (canAccessRoute(user, pathname) && (pathname === '/operations/bookings' || pathname === '/bookings')) return <BookingsPage />;
    // 1. Check authorization
    const isAuthorized = canAccessRoute(user, pathname);
    if (!isAuthorized) {
      return <AccessDeniedView attemptedPath={pathname} />;
    }

    // 2. Dashboard routing
    if (pathname === '/dashboard') {
      switch (user.role) {
        case 'SUPER_ADMIN':
          return <SuperAdminDashboard />;
        case 'ADMIN':
          return <AdminDashboard />;
        case 'ACCOUNTANT':
          return <AccountantDashboard />;
        case 'STAFF':
          return <StaffDashboard />;
      }
    }

    // 3. Phase 2A Operational & Administration Modules
    if (pathname === '/admin/branches') {
      return <BranchManagementPage />;
    }
    if (pathname === '/admin/users' || pathname === '/admin/users-access') {
      return <UsersAccessPage />;
    }
    if (pathname === '/operations/staff') {
      return <StaffDirectoryPage />;
    }

    // 4. Phase 2B Modules: Service & Package Catalogue, Payment Accounts, and Tax Settings
    if (pathname === '/operations/services-packages') {
      return <ServicesPackagesPage />;
    }
    if (
      pathname === '/admin/branch-settings' ||
      pathname === '/admin/tax-settings' ||
      pathname === '/admin/payment-accounts' ||
      pathname === '/admin/data-reset' ||
      pathname === '/admin/reset-data'
    ) {
      return <BranchSettingsPage />;
    }
    if (pathname === '/admin/devices' || pathname === '/admin/device-settings') {
      return <DeviceIntegrationPage />;
    }
    if (pathname === '/admin/attendance-settings') {
      return <AttendanceSettingsPage />;
    }

    // 5. Phase 3A: POS Billing and Invoice Management
    if (pathname === '/pos' || pathname === '/operations/pos') {
      return <POSBillingPage />;
    }
    if (pathname === '/reports/sales-invoices' || pathname === '/invoices/sales') {
      return <SalesInvoicesPage />;
    }
    if (pathname === '/reports/detailed-income' || pathname === '/reports/income-drilldown') {
      return <DetailedIncomeReportPage />;
    }
    if (pathname === '/reports/unpaid-invoices' || pathname === '/invoices/unpaid') {
      return <UnpaidInvoicesPage />;
    }

    // 6. Phase 3B: Expense Management
    if (pathname === '/accounts/expenses' || pathname === '/expenses') {
      return <ExpenseManagementPage />;
    }
    if (pathname === '/reports/detailed-expenses') {
      return <DetailedExpensesReportPage />;
    }

    // 7. Phase 3C: Balance Sheet, Account Settlement & Cash Drawers
    if (pathname === '/accounts/my-balance-sheet') {
      return <MyBalanceSheetPage />;
    }
    if (
      pathname === '/accounts/account-settlement' ||
      pathname === '/reports/settlement-history'
    ) {
      return <AccountSettlementPage />;
    }
    if (pathname === '/reports/debit-credit' || pathname === '/reports/debit-credit-statement') {
      const tab = new URLSearchParams(currentRoute.split('?')[1] || '').get('tab');
      return <DebitCreditStatementPage key={tab || 'accounts'} initialTab={tab === 'cash' ? 'CASH_DRAWER' : 'PAYMENT_ACCOUNTS'} />;
    }
    if (pathname === '/reports/payment-accounts') {
      return <DebitCreditStatementPage />;
    }
    if (pathname === '/reports/cash-drawer') {
      return <DebitCreditStatementPage initialTab="CASH_DRAWER" />;
    }

    // 7B. Phase 3D: General Ledger
    if (pathname === '/accounts/ledger') {
      return <GeneralLedgerPage />;
    }

    // 7C. Phase 3E: Security & Activity Log
    if (pathname === '/admin/activity-log') {
      return <ActivityLogPage />;
    }

    // 7D. Phase 3F: Income & Operating Expense Report
    if (pathname === '/reports/income-expense') {
      return <IncomeExpenseReportPage />;
    }

    // 7E. Tax Management & Summary Report
    if (pathname === '/reports/tax' || pathname === '/reports/tax-management') {
      return <TaxReportPage />;
    }

    // 8. Staff Attendance & Punches (Operational)
    if (pathname === '/operations/attendance') {
      return <StaffAttendancePage />;
    }
    if (pathname === '/operations/leaves') {
      return <LeaveManagementPage />;
    }

    // 9. Manual Overtime (Operational)
    if (pathname === '/operations/manual-overtime' || pathname === '/operations/overtime') {
      return <ManualOvertimePage />;
    }

    // Dedicated Attendance & Overtime Report
    if (
      pathname === '/reports/attendance' ||
      pathname === '/reports/attendance-overtime' ||
      pathname === '/reports/overtime'
    ) {
      return <AttendanceOvertimeReportPage />;
    }

    // 10. Salary and Loan Management
    if (pathname === '/accounts/salary/generate' || pathname === '/accounts/payroll') {
      return <PayrollPage mode="GENERATE" />;
    }
    if (pathname === '/accounts/salary/manage') {
      return <PayrollPage mode="MANAGE" />;
    }
    if (pathname === '/accounts/salary/allowances') {
      return <PayrollPage mode="ALLOWANCES" />;
    }
    if (pathname === '/accounts/salary/loans' || pathname === '/accounts/staff-loans') {
      return <StaffLoansPage />;
    }
    if (pathname === '/reports/staff-salary') {
      return <StaffSalaryReportPage />;
    }

    // 11. Staff Commission & Commission Reports
    if (pathname === '/accounts/salary/commission' || pathname === '/accounts/commission') {
      return <StaffCommissionPage />;
    }
    if (pathname === '/reports/staff-commission') {
      return <StaffCommissionReportPage />;
    }

    // 12. Staff Personal Workspace
    if (pathname === '/my-performance') {
      return <StaffDashboard />;
    }
    if (pathname === '/my-attendance') {
      return <StaffPersonalAttendancePage />;
    }
    if (pathname === '/my-reports') {
      return <StaffPersonalReportsPage />;
    }

    // 13. Tips Collection & Distribution (Operational)
    if (pathname === '/accounts/tips-management' || pathname === '/accounts/tips') {
      return <TipsManagementPage />;
    }

    // 14. Tips Statement Report (Dedicated Reporting)
    if (pathname === '/accounts/tips-statement' || pathname === '/reports/tips-statement' || pathname === '/reports/tips') {
      return <TipsStatementPage />;
    }

    // 15. Staff Performance Report (Dedicated Reporting)
    if (pathname === '/reports/staff-performance' || pathname === '/operations/staff-performance') {
      return <StaffPerformancePage />;
    }

    // 16. Phase 3G: Appointment Calendar & Booking
    if (pathname === '/operations/appointments' || pathname === '/appointments') {
      return <AppointmentsPage />;
    }

    // 17. Phase 3G: Customer Directory & History (CRM)
    if (pathname === '/operations/clients' || pathname === '/clients') {
      return <ClientsPage />;
    }

    // 18. Phase 3G: Dedicated Appointment Reporting
    if (pathname === '/reports/appointments' || pathname === '/reports/appointment-audit') {
      return <AppointmentReportPage />;
    }

    // 19. Inventory Management Modules
    if (
      pathname === '/operations/inventory' ||
      pathname === '/inventory' ||
      pathname === '/operations/inventory-suppliers'
    ) {
      return <InventoryItemsPage />;
    }
    if (
      pathname === '/operations/stock-in' ||
      pathname === '/operations/purchases' ||
      pathname === '/purchases'
    ) {
      return <StockInPurchasesPage />;
    }
    if (
      pathname === '/operations/suppliers' ||
      pathname === '/suppliers' ||
      pathname === '/operations/vendors' ||
      pathname === '/operations/supplier-ledger' ||
      pathname === '/operations/supplier-khata'
    ) {
      return <SuppliersVendorsPage />;
    }
    if (
      pathname === '/operations/stock-adjustments' ||
      pathname === '/operations/adjustments'
    ) {
      return <StockAdjustmentsPage />;
    }

    // 20. Phase 3H: Inventory Valuation, Batches & Movement Reporting
    if (
      pathname === '/reports/inventory-movement' ||
      pathname === '/reports/inventory' ||
      pathname === '/reports/stock-movement' ||
      pathname === '/reports/batches'
    ) {
      return <InventoryReportsPage />;
    }

    // 21. Phase 3H: COGS & Material Consumption Reporting
    if (
      pathname === '/reports/operating-profit' ||
      pathname === '/reports/cogs' ||
      pathname === '/reports/cogs-report'
    ) {
      return <COGSReportPage />;
    }

    // 4. Find metadata from NAVIGATION_GROUPS for scheduled operational modules
    let matchedItem: any = null;
    let matchedGroup: any = null;

    for (const group of NAVIGATION_GROUPS) {
      for (const item of group.items) {
        if (item.href === pathname) {
          matchedItem = item;
          matchedGroup = group;
          break;
        }
        if (item.children) {
          for (const child of item.children) {
            if (child.href === pathname) {
              matchedItem = child;
              matchedGroup = group;
              break;
            }
          }
          if (matchedItem) break;
        }
      }
      if (matchedItem) break;
    }

    const title = matchedItem ? matchedItem.label : 'Operational Module';
    const category = matchedGroup ? matchedGroup.label : 'Operations';
    const description = matchedItem?.description || `Operational management view for ${title}.`;

    return (
      <ScheduledModuleView
        title={title}
        category={category}
        description={description}
      />
    );
  };

  return <AppShell>{renderContent()}</AppShell>;
};
