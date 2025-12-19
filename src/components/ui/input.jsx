import React from 'react';

const classNames = (...classes) => classes.filter(Boolean).join(' ');

const Input = ({ className, ...props }) => (
  <input
    className={classNames(
      'flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:cursor-not-allowed disabled:opacity-50',
      className
    )}
    {...props}
  />
);

export { Input };
