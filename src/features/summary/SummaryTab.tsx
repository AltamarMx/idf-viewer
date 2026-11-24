import { lazy, Suspense, useState } from 'react';
import type { FileSummary } from '../../core/session';
import { FileOverview } from './FileOverview';
import { OutputsPanel } from './OutputsPanel';

// The site panel carries the world map outlines; load it only when opened.
const SitePanel = lazy(() => import('./SitePanel'));

type Section = 'overview' | 'site' | 'outputs';

/** Summary (D1, D2), site and design days (D5) and requested outputs (D6). */
export function SummaryTab({
  summary,
  onSelect,
}: {
  summary: FileSummary;
  onSelect: (id: number) => void;
}) {
  const [section, setSection] = useState<Section>('overview');
  const tab = (id: Section, label: string) => (
    <button
      type="button"
      role="tab"
      className="subtab"
      aria-selected={section === id}
      onClick={() => setSection(id)}
    >
      {label}
    </button>
  );
  return (
    <div className="summary">
      <div className="subtabs" role="tablist">
        {tab('overview', 'Overview')}
        {tab('site', 'Site and design days')}
        {tab('outputs', 'Outputs')}
      </div>
      {section === 'overview' && <FileOverview summary={summary} />}
      {section === 'site' && (
        <Suspense fallback={<div className="content count">Loading…</div>}>
          <SitePanel onSelect={onSelect} />
        </Suspense>
      )}
      {section === 'outputs' && <OutputsPanel onSelect={onSelect} />}
    </div>
  );
}
