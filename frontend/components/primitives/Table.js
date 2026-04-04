import { forwardRef } from 'react'
import clsx from 'clsx'

export const Table = forwardRef(function Table({ className, children, ...props }, ref) {
  return (
    <div className={clsx('w-full overflow-auto', className)}>
      <table ref={ref} className="w-full border-collapse text-13" {...props}>
        {children}
      </table>
    </div>
  )
})

export const TableHeader = forwardRef(function TableHeader({ className, children, ...props }, ref) {
  return (
    <thead ref={ref} className={className} {...props}>
      {children}
    </thead>
  )
})

export const TableBody = forwardRef(function TableBody({ className, children, ...props }, ref) {
  return (
    <tbody ref={ref} className={className} {...props}>
      {children}
    </tbody>
  )
})

export const TableRow = forwardRef(function TableRow(
  { className, hover = false, selected = false, children, ...props },
  ref
) {
  return (
    <tr
      ref={ref}
      className={clsx(
        'border-b border-border-subtle',
        hover && 'sig-transition hover:bg-base-elevated cursor-pointer',
        selected && 'bg-base-elevated',
        className
      )}
      {...props}
    >
      {children}
    </tr>
  )
})

export const TableHead = forwardRef(function TableHead(
  { className, align = 'left', children, ...props },
  ref
) {
  return (
    <th
      ref={ref}
      className={clsx(
        'h-8 px-3 text-11 font-medium text-content-muted uppercase tracking-wider',
        'bg-base-surface border-b border-border',
        'sticky top-0 z-10',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        className
      )}
      {...props}
    >
      {children}
    </th>
  )
})

export const TableCell = forwardRef(function TableCell(
  { className, mono = false, align = 'left', children, ...props },
  ref
) {
  return (
    <td
      ref={ref}
      className={clsx(
        'h-10 px-3 text-content-primary',
        mono && 'font-mono tabular-nums',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        className
      )}
      {...props}
    >
      {children}
    </td>
  )
})
