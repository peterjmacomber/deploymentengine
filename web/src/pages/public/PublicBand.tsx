import logoWhite from '../../assets/fortis-logo-white.png';

/** Shared dark Fortis brand band for all public (customer-facing) pages. */
export function PublicBand({ title, meta }: { title: string; meta?: string }) {
  return (
    <div className="co-band">
      <div className="co-band-inner">
        <img src={logoWhite} alt="Fortis" />
        <div className="co-band-div" />
        <div className="co-band-title">{title}</div>
        {meta && <div className="co-band-meta">{meta}</div>}
      </div>
    </div>
  );
}
