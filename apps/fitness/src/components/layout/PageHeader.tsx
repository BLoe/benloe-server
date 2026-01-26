import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}

export function PageHeader({ title, subtitle, action }: PageHeaderProps) {
  return (
    <header className="px-4 lg:px-8 pt-6 lg:pt-8 pb-4">
      <div className="flex items-start justify-between gap-4">
        <div className="animate-slide-up">
          <h1 className="text-2xl lg:text-3xl font-semibold text-white tracking-tight">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-1 text-sm lg:text-base text-slate-400">
              {subtitle}
            </p>
          )}
        </div>
        {action && (
          <div className="animate-fade-in">{action}</div>
        )}
      </div>
    </header>
  );
}
