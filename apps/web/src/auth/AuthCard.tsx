import type { ReactNode } from 'react';

import { BrandMark } from '../components/Brand';
import { Card } from '../components/ui/card';

export function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-background px-4 py-10 text-foreground">
      <div className="flex items-center gap-2.5">
        <BrandMark />
        <p className="text-base font-semibold tracking-tight">GSS</p>
      </div>
      <Card asChild>
        <main className="w-full max-w-sm p-6 shadow-sm">
          <h1 className="mb-5 text-xl font-semibold tracking-tight">{title}</h1>
          {children}
        </main>
      </Card>
    </div>
  );
}

export function FieldError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-sm text-danger">
      {message}
    </p>
  );
}

/** A form field: its label above the control. */
export const fieldClass = 'flex flex-col gap-1.5 text-sm font-medium';
