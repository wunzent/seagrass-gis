import * as React from 'react';
import { ChevronLeftIcon, ChevronRightIcon, MoreHorizontalIcon } from 'lucide-react';
import { Button } from './button';
import { cn } from './utils';

// shadcn Base pagination; native buttons preserve command semantics for in-place API paging.
function Pagination({ className, ...props }: React.ComponentProps<'nav'>) {
  return (
    <nav
      role="navigation"
      aria-label="pagination"
      data-slot="pagination"
      className={cn('mx-auto flex w-full justify-center', className)}
      {...props}
    />
  );
}
function PaginationContent({ className, ...props }: React.ComponentProps<'ul'>) {
  return <ul data-slot="pagination-content" className={cn('flex items-center gap-0.5', className)} {...props} />;
}
function PaginationItem(props: React.ComponentProps<'li'>) {
  return <li data-slot="pagination-item" {...props} />;
}
function PaginationLink({
  className,
  isActive,
  ...props
}: React.ComponentProps<typeof Button> & { isActive?: boolean }) {
  return (
    <Button
      aria-current={isActive ? 'page' : undefined}
      data-slot="pagination-link"
      data-active={isActive}
      variant="outline"
      className={cn('min-w-11 px-2 [&_svg]:size-4', className)}
      {...props}
    />
  );
}
function PaginationPrevious({ children, ...props }: React.ComponentProps<typeof PaginationLink>) {
  return (
    <PaginationLink aria-label="หน้าก่อนหน้า" {...props}>
      <ChevronLeftIcon aria-hidden="true" />
      {children}
    </PaginationLink>
  );
}
function PaginationNext({ children, ...props }: React.ComponentProps<typeof PaginationLink>) {
  return (
    <PaginationLink aria-label="หน้าถัดไป" {...props}>
      <ChevronRightIcon aria-hidden="true" />
      {children}
    </PaginationLink>
  );
}
function PaginationEllipsis({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      aria-hidden
      data-slot="pagination-ellipsis"
      className={cn('flex size-11 items-center justify-center [&_svg]:size-4', className)}
      {...props}
    >
      <MoreHorizontalIcon />
      <span className="sr-only">หน้าอื่น</span>
    </span>
  );
}
export {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationPrevious,
  PaginationNext,
  PaginationEllipsis,
};
