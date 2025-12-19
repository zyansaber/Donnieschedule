import React from 'react';

const classNames = (...classes) => classes.filter(Boolean).join(' ');

const Badge = ({ className, ...props }) => (
  <span
    className={classNames(
      'inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-semibold text-slate-700',
      className
    )}
    {...props}
  />
);

export { Badge };
