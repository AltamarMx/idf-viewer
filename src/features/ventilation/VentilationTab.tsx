import { useEffect, useState } from 'react';
import type { AfnOverview } from '../../core/airflow/card';
import { idf } from '../../worker/client';
import { AfnPanel } from './AfnPanel';
import { NetworkPanel } from './NetworkPanel';
import { WindowsTable } from './WindowsTable';
import { WindPanel } from './WindPanel';
import { ZoneFlowsPanel } from './ZoneFlowsPanel';

interface Props {
  selectedId: number | null;
  onSelect: (id: number) => void;
  onShow3D: (id: number) => void;
  dark: boolean;
}

type Section = 'windows' | 'afn' | 'network' | 'flows' | 'wind';

/** Windows, natural ventilation, the AirflowNetwork, the flow network and wind (L1–L11). */
export default function VentilationTab({ selectedId, onSelect, onShow3D, dark }: Props) {
  const [section, setSection] = useState<Section>('windows');
  const [overview, setOverview] = useState<AfnOverview | null>(null);
  const [card, setCard] = useState<string | null>(null);

  useEffect(() => {
    idf.afnOverview().then(setOverview);
  }, []);

  const hasAfn = Boolean(overview && (overview.present || overview.surfaces.length > 0));
  const openCard = (surface: string) => {
    setCard(surface);
    setSection('afn');
  };

  return (
    <div className="ventilation">
      <div className="subtabs" role="tablist">
        <button
          type="button"
          role="tab"
          className="subtab"
          aria-selected={section === 'windows'}
          onClick={() => setSection('windows')}
        >
          Windows and doors
        </button>
        <button
          type="button"
          role="tab"
          className="subtab"
          aria-selected={section === 'afn'}
          onClick={() => setSection('afn')}
        >
          Airflow network
          {overview && !hasAfn && <span className="count"> · none</span>}
        </button>
        <button
          type="button"
          role="tab"
          className="subtab"
          aria-selected={section === 'network'}
          onClick={() => setSection('network')}
        >
          Network
        </button>
        <button
          type="button"
          role="tab"
          className="subtab"
          aria-selected={section === 'flows'}
          onClick={() => setSection('flows')}
        >
          Infiltration and ventilation
        </button>
        <button
          type="button"
          role="tab"
          className="subtab"
          aria-selected={section === 'wind'}
          onClick={() => setSection('wind')}
        >
          Wind
        </button>
      </div>
      <div className="ventilation-body">
        {section === 'wind' ? (
          <WindPanel onSelect={onSelect} dark={dark} />
        ) : section === 'network' ? (
          <NetworkPanel onSelect={onSelect} onOpenCard={openCard} dark={dark} />
        ) : section === 'flows' ? (
          <ZoneFlowsPanel onSelect={onSelect} />
        ) : section === 'windows' ? (
          <WindowsTable
            selectedId={selectedId}
            onSelect={onSelect}
            onShow3D={onShow3D}
            onOpenCard={openCard}
          />
        ) : !overview ? (
          <div className="content count">Reading the airflow network…</div>
        ) : hasAfn ? (
          <AfnPanel
            overview={overview}
            card={card}
            onOpenCard={setCard}
            onSelect={onSelect}
            onShow3D={onShow3D}
            dark={dark}
          />
        ) : (
          <div className="content">
            This file has no AirflowNetwork (no AirflowNetwork:SimulationControl and no
            AirflowNetwork:MultiZone:Surface).
          </div>
        )}
      </div>
    </div>
  );
}
