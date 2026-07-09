import type { SemanticEntity } from '@memory-soda/types';

const CHIP_CLASSES =
  'inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2.5 py-1';

/** Entity name + type pill; interactive when onClick is given. */
export function EntityChip({
  entity,
  onClick,
  size = 'sm',
}: {
  entity: SemanticEntity;
  onClick?: () => void;
  size?: 'sm' | 'xs';
}) {
  const text = size === 'sm' ? 'text-xs' : 'text-[10px]';
  const body = (
    <>
      <span className="font-medium">{entity.name}</span>
      <span className="text-muted-foreground">{entity.type}</span>
    </>
  );
  if (onClick) {
    return (
      <button
        onClick={onClick}
        className={`${CHIP_CLASSES} ${text} hover:bg-muted transition-colors`}
        title={`View facts anchored to ${entity.name}`}
      >
        {body}
      </button>
    );
  }
  return <span className={`${CHIP_CLASSES} ${text}`}>{body}</span>;
}
