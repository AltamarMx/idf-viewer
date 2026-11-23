import { useEffect, useMemo, useState } from 'react';
import type {
  FlowNetwork,
  NetworkLink,
  NetworkLinkType,
  NetworkNode,
} from '../../core/airflow/network';
import { formatNumber } from '../../ui/format';
import { idf } from '../../worker/client';
import { Chart, type ChartClick, type ChartOption } from '../charts/Chart';
import { AFN_COLORS } from '../viewer3d/colors';
import { networkLayout } from './networkLayout';

interface Props {
  onSelect: (id: number) => void;
  onOpenCard: (surface: string) => void;
  dark: boolean;
}

/** Link colors: the 3D view's AirflowNetwork colors, plus zone mixing. */
const LINK_COLORS: Record<NetworkLinkType, string> = {
  ...(Object.fromEntries(AFN_COLORS.map((c) => [c.key, c.color])) as Record<string, string>),
  mixing: '#8c6d31',
  crossmixing: '#8c6d31',
} as Record<NetworkLinkType, string>;

const LEGEND_ORDER: NetworkLinkType[] = [
  'detailedopening',
  'simpleopening',
  'horizontalopening',
  'crack',
  'ela',
  'exhaustfan',
  'specifiedflow',
  'missing',
  'mixing',
  'crossmixing',
];

const THEME = {
  light: {
    text: '#1c2530',
    zone: '#e3eef8',
    zoneBorder: '#1f6fb2',
    outdoor: '#eef1f4',
    outdoorBorder: '#7d8893',
    level: '#56616d',
  },
  dark: {
    text: '#e3e8ee',
    zone: '#1d3346',
    zoneBorder: '#6cb4ee',
    outdoor: '#232b34',
    outdoorBorder: '#9aa6b2',
    level: '#9aa6b2',
  },
};

const MAX_LISTED = 8;

const escapeHtml = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

function arrowOf(link: NetworkLink) {
  return link.direction === 'forward' ? '→' : link.direction === 'both' ? '↔' : '—';
}

/** Cd of the surfaces of a link: one value or a range. */
function cdText(link: NetworkLink): string {
  const values = link.surfaces.map((s) => s.cd).filter((v): v is number => v !== undefined);
  if (values.length === 0) return '—';
  const min = Math.min(...values);
  const max = Math.max(...values);
  return min === max ? formatNumber(min) : `${formatNumber(min)}–${formatNumber(max)}`;
}

function designText(link: NetworkLink): string {
  const values = link.objects.map((o) => o.design).filter((v): v is number => v !== undefined);
  if (values.length === 0) return '';
  return `${formatNumber(values.reduce((a, b) => a + b, 0))} m³/s`;
}

/** Flow network between zones: AirflowNetwork links and zone mixing (L11). */
export function NetworkPanel({ onSelect, onOpenCard, dark }: Props) {
  const [network, setNetwork] = useState<FlowNetwork | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    idf.network().then(setNetwork);
  }, []);

  const nodeByKey = useMemo(
    () => new Map((network?.nodes ?? []).map((n) => [n.key, n])),
    [network],
  );

  const option = useMemo(
    () => (network ? networkOption(network, nodeByKey, selected, dark) : null),
    [network, nodeByKey, selected, dark],
  );

  if (!network) return <div className="content count">Reading the flow network…</div>;

  const zones = network.nodes.filter((n) => n.kind === 'zone');
  const outdoor = network.nodes.filter((n) => n.kind === 'outdoor');
  const present = new Set(network.links.map((l) => l.type));
  const shown = selected ? network.links.filter((l) => l.key === selected) : network.links;

  const onClick = (params: ChartClick) => {
    const data = params.data as { key?: string; linkKey?: string } | undefined;
    if (params.dataType === 'edge' && data?.linkKey) {
      setSelected((current) => (current === data.linkKey ? null : (data.linkKey as string)));
      return;
    }
    if (params.dataType === 'node' && data?.key) {
      const node = nodeByKey.get(data.key);
      if (node?.id !== undefined) onSelect(node.id);
    }
  };

  const nodeName = (key: string) => {
    const node = nodeByKey.get(key);
    if (!node) return key;
    return node.id !== undefined ? (
      <button type="button" className="ref" onClick={() => onSelect(node.id as number)}>
        {node.name}
      </button>
    ) : (
      node.name
    );
  };

  return (
    <div className="content network">
      <h3>Flow network</h3>
      {!network.afn.present && (
        <p className="count">
          This file has no AirflowNetwork: only ZoneMixing and ZoneCrossMixing are drawn.
        </p>
      )}
      {network.afn.present && !network.afn.active && (
        <div className="notice warn">
          AirflowNetwork Control is {network.afn.control}: EnergyPlus does not run this network.
        </div>
      )}
      {zones.length === 0 ? (
        <p className="count">
          There is nothing to draw: no AirflowNetwork surfaces and no ZoneMixing or ZoneCrossMixing.
        </p>
      ) : (
        <>
          <p className="count">
            {zones.length} {zones.length === 1 ? 'zone' : 'zones'}, {outdoor.length} outdoor{' '}
            {outdoor.length === 1 ? 'node' : 'nodes'} and {network.links.length}{' '}
            {network.links.length === 1 ? 'connection' : 'connections'}.{' '}
            {network.afn.present &&
              (network.afn.cpInput
                ? 'Outdoor nodes are the external nodes of the surfaces.'
                : 'The outdoors is grouped by facade, because EnergyPlus computes the Cp (SurfaceAverageCalculation).')}
          </p>
          {network.warnings.map((w) => (
            <div key={`${w.objectId}-${w.message}`} className="notice warn">
              {w.message}
              {w.objectId !== undefined && (
                <>
                  {' '}
                  <button
                    type="button"
                    className="ref"
                    onClick={() => onSelect(w.objectId as number)}
                  >
                    Show object
                  </button>
                </>
              )}
            </div>
          ))}
          {network.zonesOutside.length > 0 && (
            <p className="count">
              Not in the network: {network.zonesOutside.slice(0, MAX_LISTED).join(', ')}
              {network.zonesOutside.length > MAX_LISTED &&
                ` and ${network.zonesOutside.length - MAX_LISTED} more`}
              .
            </p>
          )}

          <div className="network-chart">
            {option && <Chart option={option} height={520} dark={dark} onClick={onClick} />}
            <ul className="network-legend">
              {LEGEND_ORDER.filter((t) => present.has(t)).map((t) => (
                <li key={t}>
                  <span
                    className={`network-line${t === 'mixing' || t === 'crossmixing' ? ' dashed' : ''}`}
                    style={{ borderColor: LINK_COLORS[t] }}
                  />
                  {network.links.find((l) => l.type === t)?.label}
                  {t === 'mixing' ? ' →' : t === 'crossmixing' ? ' ↔' : ''}
                </li>
              ))}
              <li>
                <span className="network-node zone" /> Zone
              </li>
              {outdoor.length > 0 && (
                <li>
                  <span className="network-node outdoor" /> Outdoors
                </li>
              )}
            </ul>
            <p className="count">
              North is up. Arrows: air goes one way (exhaust fan, ZoneMixing) or both ways
              (ZoneCrossMixing). Drag to move, scroll to zoom. Click a zone to inspect it, or a
              connection to see it in the table.
            </p>
          </div>

          <h3>Connections</h3>
          {selected && (
            <p className="count">
              Showing one connection.{' '}
              <button type="button" className="ref" onClick={() => setSelected(null)}>
                Show all
              </button>
            </p>
          )}
          <div className="table-wrap">
            <table className="grid network-links">
              <thead>
                <tr>
                  <th>From</th>
                  <th />
                  <th>To</th>
                  <th>Type</th>
                  <th>Through</th>
                  <th className="num">Cd</th>
                  <th className="num">Design flow</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((link) => (
                  <tr key={link.key} className={link.key === selected ? 'selected' : undefined}>
                    <td>{nodeName(link.from)}</td>
                    <td>{arrowOf(link)}</td>
                    <td>{nodeName(link.to)}</td>
                    <td>
                      <span className="swatch" style={{ background: LINK_COLORS[link.type] }} />{' '}
                      {link.label}
                    </td>
                    <td className="wrap">
                      {link.surfaces.map((s, i) => (
                        <span key={s.afnId}>
                          {i > 0 && ', '}
                          <button
                            type="button"
                            className="ref"
                            title="Open its AirflowNetwork card"
                            onClick={() => onOpenCard(s.name)}
                          >
                            {s.name}
                          </button>
                        </span>
                      ))}
                      {link.objects.map((o, i) => (
                        <span key={o.id}>
                          {i > 0 && ', '}
                          <button type="button" className="ref" onClick={() => onSelect(o.id)}>
                            {o.name}
                          </button>
                        </span>
                      ))}
                    </td>
                    <td className="num">{cdText(link)}</td>
                    <td className="num">{designText(link)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="count">
            Cd is the discharge coefficient at the surface's opening factor (openings and effective
            leakage areas). Design flow is before the schedule.
          </p>
        </>
      )}
    </div>
  );
}

function networkOption(
  network: FlowNetwork,
  nodeByKey: Map<string, NetworkNode>,
  selected: string | null,
  dark: boolean,
): ChartOption {
  const theme = dark ? THEME.dark : THEME.light;
  const { positions, levels } = networkLayout(network.nodes);
  const linkCount = new Map<string, number>();
  for (const l of network.links) {
    linkCount.set(l.from, (linkCount.get(l.from) ?? 0) + 1);
    linkCount.set(l.to, (linkCount.get(l.to) ?? 0) + 1);
  }

  const nodes = network.nodes.map((n) => {
    const [x, y] = positions.get(n.key) ?? [0, 0];
    const zone = n.kind === 'zone';
    return {
      key: n.key,
      name: n.key,
      x,
      y,
      symbol: zone ? 'circle' : 'roundRect',
      symbolSize: zone ? 30 : [26, 20],
      itemStyle: {
        color: zone ? theme.zone : theme.outdoor,
        borderColor: zone ? theme.zoneBorder : theme.outdoorBorder,
        borderWidth: 1.5,
        borderType: zone && network.afn.present && !n.inAfn ? 'dashed' : 'solid',
      },
      label: {
        show: true,
        position: zone ? 'bottom' : 'top',
        formatter: n.name,
        color: theme.text,
        fontSize: 11,
      },
      tooltip: {
        formatter: () => {
          const lines = [`<b>${escapeHtml(n.name)}</b>`];
          if (zone) {
            if (n.level !== undefined) lines.push(`Zone · floor at ${formatNumber(n.level)} m`);
            if (network.afn.present)
              lines.push(n.inAfn ? 'In the AirflowNetwork' : 'Not in the AirflowNetwork');
          } else {
            lines.push(`Outdoors${n.facing ? ` · ${n.facing}` : ''}`);
          }
          lines.push(`${linkCount.get(n.key) ?? 0} connections`);
          return lines.join('<br/>');
        },
      },
    };
  });
  // Level labels: invisible nodes with a label.
  const levelLabels = levels.map((l, i) => ({
    key: '',
    name: `level-${i}`,
    x: l.x,
    y: l.y,
    symbol: 'circle',
    symbolSize: 1,
    itemStyle: { color: 'transparent', borderWidth: 0 },
    label: {
      show: true,
      position: 'right',
      formatter: l.label,
      color: theme.level,
      fontSize: 12,
    },
    tooltip: { show: false },
  }));

  const links = network.links.map((l) => {
    const items = l.surfaces.length + l.objects.length;
    const faded = selected !== null && selected !== l.key;
    return {
      source: l.from,
      target: l.to,
      linkKey: l.key,
      symbol:
        l.direction === 'forward'
          ? ['none', 'arrow']
          : l.direction === 'both'
            ? ['arrow', 'arrow']
            : ['none', 'none'],
      symbolSize: 9,
      lineStyle: {
        color: LINK_COLORS[l.type],
        width: (1.6 + Math.min(3, items - 1) * 0.8) * (selected === l.key ? 1.8 : 1),
        type: l.type === 'mixing' || l.type === 'crossmixing' ? 'dashed' : 'solid',
        opacity: faded ? 0.2 : 0.9,
      },
      tooltip: {
        formatter: () => {
          const from = nodeByKey.get(l.from)?.name ?? l.from;
          const to = nodeByKey.get(l.to)?.name ?? l.to;
          const lines = [
            `<b>${escapeHtml(from)} ${arrowOf(l)} ${escapeHtml(to)}</b>`,
            escapeHtml(l.label),
          ];
          for (const s of l.surfaces.slice(0, MAX_LISTED)) {
            const cd = s.cd !== undefined ? `, Cd ${formatNumber(s.cd)}` : '';
            lines.push(`${escapeHtml(s.name)} (factor ${formatNumber(s.factor)}${cd})`);
          }
          for (const o of l.objects.slice(0, MAX_LISTED)) {
            const design = o.design !== undefined ? ` · ${formatNumber(o.design)} m³/s` : '';
            lines.push(`${escapeHtml(o.name)}${design}`);
          }
          if (items > MAX_LISTED * 2 || l.surfaces.length > MAX_LISTED)
            lines.push(`${l.surfaces.length} surfaces in all`);
          return lines.join('<br/>');
        },
      },
    };
  });

  return {
    tooltip: { trigger: 'item', confine: true },
    animation: false,
    series: [
      {
        type: 'graph',
        layout: 'none',
        roam: true,
        data: [...nodes, ...levelLabels],
        links,
        autoCurveness: true,
        emphasis: { focus: 'adjacency', lineStyle: { width: 4 } },
        labelLayout: { hideOverlap: true },
        left: 40,
        right: 40,
        top: 40,
        bottom: 40,
      },
    ],
  };
}
