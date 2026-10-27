/**
 * The shelf's shape before the books arrive (styles: `.book-grid.is-skeleton`).
 *
 * Same grid, same density as the real one, so the first paint is filled in rather
 * than replaced: a skeleton in a different grid makes the reader watch the layout
 * move twice. Hidden from assistive tech — the FloatingNotice beside it announces
 * the load.
 */
export function BookGridSkeleton({ count = 12, density, className }: { count?: number; density?: string; className?: string }) {
  return <div className={`book-grid is-skeleton${className ? ` ${className}` : ''}`} data-density={density} aria-hidden="true">
    {Array.from({ length: count }, (_, index) => <div className="book-card" key={index}>
      <div className="cover" />
      <span className="skeleton-line" />
      <span className="skeleton-line short" />
    </div>)}
  </div>;
}
