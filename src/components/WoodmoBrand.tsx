import type { ReactNode } from 'react';

type BrandStatus = 'ok' | 'pending' | 'error';

interface Props {
  status: BrandStatus;
  size?: 'small' | 'large';
  children?: ReactNode;
}

/** WOODMO's user-approved Version 3.0 image, with a status glow. */
export function WoodmoBrand({ status, size = 'small', children }: Props) {
  const glow = status === 'ok' ? 'woodmo-brand-ok'
    : status === 'error' ? 'woodmo-brand-error' : 'woodmo-brand-pending';
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <div className={`relative shrink-0 overflow-visible rounded-[24%] ${glow}`}>
        <img
          src={`${import.meta.env?.BASE_URL ?? '/'}woodmo-v3-logo.png`}
          alt="WOODMO Version 3.0"
          className={`rounded-[24%] object-cover ${size === 'large' ? 'h-24 w-24 sm:h-28 sm:w-28' : 'h-11 w-11 sm:h-12 sm:w-12'}`}
        />
      </div>
      {children}
    </div>
  );
}
