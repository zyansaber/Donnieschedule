import React from 'react';

const classNames = (...classes) => classes.filter(Boolean).join(' ');

const Card = ({ className, ...props }) => (
  <div
    className={classNames(
      'rounded-xl border border-slate-200 bg-white text-slate-950 shadow-sm',
      className
    )}
    {...props}
  />
);

const CardHeader = ({ className, ...props }) => (
  <div className={classNames('flex flex-col space-y-1.5 p-6', className)} {...props} />
);

const CardTitle = ({ className, ...props }) => (
  <h3
    className={classNames('text-2xl font-semibold leading-none tracking-tight', className)}
    {...props}
  />
);

const CardContent = ({ className, ...props }) => (
  <div className={classNames('p-6 pt-0', className)} {...props} />
);

export { Card, CardContent, CardHeader, CardTitle };
