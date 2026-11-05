import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import Decimal from 'decimal.js';
const { transformSync } = createRequire(new URL('../../frontend/package.json', import.meta.url))('esbuild');

for (const [name, path, api] of [
  ['commission','commission/StaffCommissionPage.tsx','recordCommissionPayment'],
  ['salary','payroll/PayrollPage.tsx','recordPayrollPayment'],
]) {
  const source=readFileSync(new URL(`../../frontend/src/features/${path}`,import.meta.url),'utf8');
  describe(`${name} decimal payment form`,()=>{
    it.each([0.01,0.50,1000,1000.50,1234.56])('accepts and sends Rs. %s without changing the amount',async amount=>{
      const target={id:'staff-pay',staffName:'Staff',outstandingAmount:1234.56};
      const paymentForm={amount,method:'CASH',reference:'test'};
      // Evaluate the actual JSX input attributes, including browser min/step/max constraints.
      const label=source.indexOf('Payment Amount (Rs.)');
      const inputStart=source.indexOf('<input',label),inputEnd=source.indexOf('/>',inputStart)+2;
      const inputCode=transformSync('const input = '+source.slice(inputStart,inputEnd)+';',{loader:'tsx',jsx:'transform'}).code;
      const attrs=new Function('React','paymentForm','paymentTargetStatement','paymentTargetPayslip','setPaymentForm',inputCode+'return input;')(
        {createElement:(_tag,props)=>props},paymentForm,target,target,vi.fn());
      expect(amount).toBeGreaterThanOrEqual(Number(attrs.min));
      expect(amount).toBeLessThanOrEqual(attrs.max);
      if(attrs.step!=='any') expect(new Decimal(amount).minus(attrs.min).mod(attrs.step||1).isZero()).toBe(true);

      const start=source.indexOf('  const handleRecordPayment =');
      const end=source.indexOf('\n  };',start)+6;
      const paid=vi.fn().mockResolvedValue({});
      const toast={error:vi.fn(),success:vi.fn()};
      const context={paymentForm,paymentTargetRun:{id:'run'},paymentTargetStatement:target,paymentTargetPayslip:target,
        salonService:{[api]:paid},user:{id:'admin'},setActionLoading:vi.fn(),setFeedback:vi.fn(),toast,
        setShowPaymentModal:vi.fn(),loadData:vi.fn(),formatSalaryNumber:String};
      const code=transformSync(source.slice(start,end),{loader:'ts'}).code;
      await new Function(...Object.keys(context),code+'return handleRecordPayment({preventDefault(){}});')(...Object.values(context));
      expect(toast.error).not.toHaveBeenCalled();
      expect(paid).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({amount}),context.user);
    });
  });
}
