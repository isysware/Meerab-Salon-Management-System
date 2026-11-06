import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock prisma
vi.mock('../src/config/prisma.js', () => ({
  default: {
    branch: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    appointment: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    booking: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    staff: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    client: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    auditEvent: {
      create: vi.fn(),
    },
    $executeRaw: vi.fn().mockResolvedValue(1),
    $transaction: vi.fn((cb) => cb({
      branch: {
        findUnique: vi.fn().mockResolvedValue({ id: 'branch-1', name: 'Karachi Branch', code: 'KHI', isActive: true }),
        findMany: vi.fn().mockResolvedValue([{ id: 'branch-1', name: 'Karachi Branch' }]),
      },
      appointment: {
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      booking: {
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      staff: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      $executeRaw: vi.fn().mockResolvedValue(1),
    })),
  },
}));

import prisma from '../src/config/prisma.js';
import * as appointmentService from '../src/modules/appointments/appointments.service.js';
import * as bookingService from '../src/modules/bookings/bookings.service.js';
import * as staffService from '../src/modules/staff/staff.service.js';

describe('Booking & Appointments Portal Access for Staff & Accountant', () => {
  const staffActor = {
    id: 'staff-user-1',
    name: 'Sara Khan',
    role: 'STAFF',
    branchId: 'branch-1',
  };

  const accountantActor = {
    id: 'acct-user-1',
    name: 'Bilal Ahmed',
    role: 'ACCOUNTANT',
    branchId: 'branch-1',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows STAFF to list appointments scoped to their assigned branch', async () => {
    prisma.branch.findMany.mockResolvedValue([{ id: 'branch-1', name: 'Karachi Branch' }]);
    prisma.appointment.findMany.mockResolvedValue([
      {
        id: 'apt-1',
        appointmentNumber: 'APT-0001',
        branchId: 'branch-1',
        clientName: 'Ayesha',
        date: new Date('2026-11-06'),
        startTime: '10:00',
        endTime: '11:00',
        durationMinutes: 60,
        price: 1500,
        status: 'CONFIRMED',
        items: [],
      },
    ]);

    const result = await appointmentService.listAppointments(staffActor, { branchId: 'branch-1' });
    expect(result).toHaveLength(1);
    expect(result[0].appointmentNumber).toBe('APT-0001');
    expect(result[0].branchName).toBe('Karachi Branch');
  });

  it('allows ACCOUNTANT to list appointments scoped to their assigned branch', async () => {
    prisma.branch.findMany.mockResolvedValue([{ id: 'branch-1', name: 'Karachi Branch' }]);
    prisma.appointment.findMany.mockResolvedValue([]);

    const result = await appointmentService.listAppointments(accountantActor, { branchId: 'branch-1' });
    expect(Array.isArray(result)).toBe(true);
  });

  it('allows STAFF to view POS appointments queue for their assigned branch', async () => {
    prisma.branch.findMany.mockResolvedValue([{ id: 'branch-1', name: 'Karachi Branch' }]);
    prisma.appointment.findMany.mockResolvedValue([]);

    const result = await appointmentService.getQueue(staffActor, { branchId: 'branch-1', date: '2026-11-06' });
    expect(Array.isArray(result)).toBe(true);
  });

  it('prevents STAFF from viewing appointments belonging to a different branch', async () => {
    prisma.appointment.findUnique.mockResolvedValue({
      id: 'apt-2',
      branchId: 'branch-other',
      date: new Date('2026-11-06'),
      startTime: '12:00',
      items: [],
    });

    await expect(appointmentService.getAppointment(staffActor, 'apt-2'))
      .rejects.toThrow(/Access Denied/i);
  });

  it('allows STAFF and ACCOUNTANT to view staff directory with salary redacted', async () => {
    prisma.staff.findMany.mockResolvedValue([
      {
        id: 'st-1',
        name: 'Stylist Zara',
        employeeCode: 'EMP-001',
        designation: 'Senior Stylist',
        baseSalary: 50000,
        commissionRate: 10,
        branchId: 'branch-1',
        isActive: true,
      },
    ]);

    const staffList = await staffService.listStaff(staffActor, { branchId: 'branch-1' });
    expect(staffList).toHaveLength(1);
    expect(staffList[0].name).toBe('Stylist Zara');
    // baseSalary must be redacted for staff/accountant
    expect(staffList[0].compensationRedacted).toBe(true);
    expect(staffList[0].baseSalary).toBe(0);
  });
});
