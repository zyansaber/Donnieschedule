import React from 'react';

const classNames = (...classes) => classes.filter(Boolean).join(' ');

const TooltipProvider = ({ children }) => <>{children}</>;

const Tooltip = ({ className, ...props }) => (
  <span className={classNames('relative inline-flex group', className)} {...props} />
);

const TooltipTrigger = ({ className, ...props }) => (
  <span className={classNames('inline-flex items-center', className)} {...props} />
);

const TooltipContent = ({ className, ...props }) => (
  <span
    className={classNames(
      'pointer-events-none absolute left-1/2 top-full z-50 mt-2 -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-xs text-white opacity-0 transition group-hover:opacity-100',
      className
    )}
    {...props}
  />
);

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
