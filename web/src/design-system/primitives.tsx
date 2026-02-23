import React from 'react';

type ClassValue = string | false | null | undefined;

function cx(...parts: ClassValue[]): string {
  return parts.filter(Boolean).join(' ');
}

type BaseProps = {
  className?: string;
  children?: React.ReactNode;
};

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & BaseProps & {
  variant?: 'primary' | 'ghost' | 'danger' | 'success' | 'warning' | 'info';
  size?: 'sm' | 'md' | 'lg';
};

export function Button({ variant = 'primary', size = 'md', className, children, ...props }: ButtonProps) {
  return (
    <button
      className={cx('sb-btn', `sb-btn--${variant}`, `sb-btn--${size}`, className)}
      {...props}
    >
      {children}
    </button>
  );
}

type CardProps = React.HTMLAttributes<HTMLDivElement> & BaseProps;
export function Card({ className, children, ...props }: CardProps) {
  return (
    <div className={cx('sb-card', className)} {...props}>
      {children}
    </div>
  );
}

type PanelProps = React.HTMLAttributes<HTMLDivElement> & BaseProps & {
  tone?: 'default' | 'success' | 'danger' | 'warning' | 'info';
};

export function Panel({ tone = 'default', className, children, ...props }: PanelProps) {
  return (
    <div className={cx('sb-panel', `sb-panel--${tone}`, className)} {...props}>
      {children}
    </div>
  );
}

type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & BaseProps & {
  tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
};

export function Badge({ tone = 'neutral', className, children, ...props }: BadgeProps) {
  return (
    <span className={cx('sb-badge', `sb-badge--${tone}`, className)} {...props}>
      {children}
    </span>
  );
}

type FieldProps = React.InputHTMLAttributes<HTMLInputElement> & BaseProps;
export function Input({ className, ...props }: FieldProps) {
  return <input className={cx('sb-input', className)} {...props} />;
}

type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & BaseProps;
export function Select({ className, children, ...props }: SelectProps) {
  return (
    <select className={cx('sb-select', className)} {...props}>
      {children}
    </select>
  );
}

type CheckboxProps = React.InputHTMLAttributes<HTMLInputElement> & BaseProps;
export function Checkbox({ className, ...props }: CheckboxProps) {
  return <input type="checkbox" className={cx('sb-checkbox', className)} {...props} />;
}

type ProgressProps = {
  value: number;
  className?: string;
};

export function Progress({ value, className }: ProgressProps) {
  const width = `${Math.max(0, Math.min(100, value))}%`;
  return (
    <div className={cx('sb-progress', className)} aria-hidden>
      <div className="sb-progress__bar" style={{ width }} />
    </div>
  );
}

type AlertProps = React.HTMLAttributes<HTMLDivElement> & BaseProps & {
  tone?: 'danger' | 'warning' | 'success' | 'info';
};

export function Alert({ tone = 'info', className, children, ...props }: AlertProps) {
  return (
    <div className={cx('sb-alert', `sb-alert--${tone}`, className)} role="alert" {...props}>
      {children}
    </div>
  );
}

