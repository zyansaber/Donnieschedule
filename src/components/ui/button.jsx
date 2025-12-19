import React from 'react';

const classNames = (...classes) => classes.filter(Boolean).join(' ');

const Button = ({ className, type = 'button', ...props }) => (
  <button
    type={type}
    className={classNames(
      'inline-flex items-center justify-center rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white shadow transition hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:cursor-not-allowed disabled:opacity-50',
      className
    )}
    {...props}
  />
);

export { Button };
