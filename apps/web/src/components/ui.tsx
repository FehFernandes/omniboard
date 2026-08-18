import { forwardRef, useId } from 'react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

// Minimal components built with Tailwind. Replace with your design system.

// Accessible TextField: ties label ↔ input (htmlFor/id), sets aria-invalid and
// wires the error message through aria-describedby. Use with react-hook-form:
//   <TextField label="Email" type="email" {...register('email')} error={errors.email?.message} />
export const TextField = forwardRef<
  HTMLInputElement,
  { label: string; error?: string } & InputHTMLAttributes<HTMLInputElement>
>(function TextField({ label, error, ...props }, ref) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-gray-700">
        {label}
      </label>
      <input
        id={id}
        ref={ref}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-900 aria-[invalid=true]:border-red-500"
        {...props}
      />
      {error && (
        <p id={errorId} className="mt-1 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
});

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input(props, ref) {
    return (
      <input
        ref={ref}
        className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-900"
        {...props}
      />
    );
  },
);

export function Button({ className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-700 disabled:opacity-50 ${className}`}
      {...props}
    />
  );
}

export function Label({ children }: { children: ReactNode }) {
  return <label className="block text-sm font-medium text-gray-700">{children}</label>;
}

export function FieldError({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return <p className="mt-1 text-xs text-red-600">{children}</p>;
}

export function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mx-auto mt-16 w-full max-w-sm rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      <h1 className="mb-4 text-xl font-semibold text-gray-900">{title}</h1>
      {children}
    </div>
  );
}

// Badge: compact status label. `tone` sets the color (green=ok, amber=warning,
// gray=neutral). Use it to signal states such as "email verified".
export function Badge({
  children,
  tone = 'gray',
}: {
  children: ReactNode;
  tone?: 'green' | 'amber' | 'gray';
}) {
  const tones = {
    green: 'bg-green-100 text-green-800',
    amber: 'bg-amber-100 text-amber-800',
    gray: 'bg-gray-100 text-gray-700',
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function Alert({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return <div className="mb-3 rounded bg-red-50 p-2 text-sm text-red-700">{children}</div>;
}
