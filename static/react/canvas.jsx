import React, { memo, useEffect, useMemo, useState } from 'react';
import { language } from '../i18n.js';
import { t, diagnostic } from '../i18n.js';
import { Icon, MediaFrame, MapPreview } from './ui/index.jsx';

export function Canvas({ app }) {
  const { commands: c, state: s } = app;
  const doc = s.workspaceState.project?.document;
  // Gesture handling operates on the viewport transform only; graph elements remain keyed.
  useEffect(() => {
    const graph = document.getElementById('graph');
    let previousSize = null,
      resizeView = null,
      lastResizePan = null;
    const resize = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (!width || !height || app.ui.view !== 'workspace') {
        previousSize = null;
        return;
      }
      if (previousSize) {
        const pan = s.canvasState.pan;
        if (
          !resizeView ||
          !lastResizePan ||
          ['x', 'y', 'scale'].some((key) => Math.abs(pan[key] - lastResizePan[key]) > 0.00001)
        )
          resizeView = { ...previousSize, pan: { ...pan } };
        const base = resizeView;
        const scale = Math.max(
          0.15,
          base.pan.scale * Math.min(1, width / base.width, height / base.height)
        );
        const factor = scale / base.pan.scale;
        s.canvasState.pan = {
          scale,
          x: width / 2 - (base.width / 2 - base.pan.x) * factor,
          y: height / 2 - (base.height / 2 - base.pan.y) * factor
        };
        c.renderViewport();
        lastResizePan = { ...s.canvasState.pan };
      }
      previousSize = { width, height };
    });
    resize.observe(graph);
    const wheel = (event) => {
      if (!s.workspaceState.project) return;
      event.preventDefault();
      resizeView = null;
      const box = graph.getBoundingClientRect();
      if (event.ctrlKey || event.metaKey)
        c.zoomAt(
          event.clientX - box.left,
          event.clientY - box.top,
          s.canvasState.pan.scale * Math.exp(-event.deltaY * 0.01)
        );
      else {
        const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? box.height : 1;
        s.canvasState.pan.x -= (event.shiftKey ? event.deltaY : event.deltaX) * unit;
        s.canvasState.pan.y -= (event.shiftKey ? event.deltaX : event.deltaY) * unit;
        c.renderViewport();
      }
    };
    const key = (event) => {
      if (event.code === 'Space' && !c.textEditing(event.target) && app.ui.view === 'workspace') {
        event.preventDefault();
        s.canvasState.spacePressed = event.type === 'keydown';
      }
    };
    const blur = () => {
      s.canvasState.spacePressed = false;
      s.canvasState.drag = null;
      c.cancelConnection();
    };
    const guardPageZoom = (event) => {
      if (
        app.ui.view === 'workspace' &&
        (event.ctrlKey || event.metaKey) &&
        !graph.contains(event.target)
      )
        event.preventDefault();
    };
    document.addEventListener('wheel', guardPageZoom, { passive: false, capture: true });
    graph.addEventListener('wheel', wheel, { passive: false });
    const touchEvents = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'];
    for (const name of touchEvents) graph.addEventListener(name, c.touchGestureEvent, true);
    const releaseEditor = (event) => {
      if (
        !event.target.closest('textarea,input,[contenteditable=true]') &&
        graph.contains(document.activeElement)
      )
        document.activeElement.blur();
    };
    graph.addEventListener('pointerdown', releaseEditor, true);
    window.addEventListener('keydown', key);
    window.addEventListener('keyup', key);
    window.addEventListener('blur', blur);
    return () => {
      resize.disconnect();
      document.removeEventListener('wheel', guardPageZoom, true);
      graph.removeEventListener('wheel', wheel);
      for (const name of touchEvents) graph.removeEventListener(name, c.touchGestureEvent, true);
      graph.removeEventListener('pointerdown', releaseEditor, true);
      window.removeEventListener('keydown', key);
      window.removeEventListener('keyup', key);
      window.removeEventListener('blur', blur);
    };
  }, [app]);
  const pan = s.canvasState.pan;
  const { model, bounds, edges } = useMemo(() => {
    const model = doc ? c.graphGroupModel() : null;
    const bounds = new Map((doc?.nodes || []).map((node) => [node.id, c.nodeRect(node)]));
    const incomingByTarget = new Map();
    for (const edge of doc?.edges || []) {
      if (!incomingByTarget.has(edge.target)) incomingByTarget.set(edge.target, []);
      incomingByTarget.get(edge.target).push(edge);
    }
    const nodeObstacles = (doc?.nodes || [])
      .filter((node) => node.type !== 'marker' && !model.hidden.has(node.id))
      .map((node) => bounds.get(node.id));
    const contextObstacles = new Map();
    const edges = [],
      seen = new Set(),
      occupied = [];
    if (doc)
      for (const edge of doc.edges) {
        const visual = model.connection(edge);
        if (!visual || seen.has(visual.key)) continue;
        seen.add(visual.key);
        const incoming = incomingByTarget.get(edge.target);
        const count = visual.b.rect.inputCount || 1;
        const ancestors = visual.context
          ? (model.nodePaths.get(edge.source) || []).slice(
              0,
              (model.nodePaths.get(edge.source) || []).indexOf(visual.context) + 1
            )
          : [];
        if (!contextObstacles.has(visual.context))
          contextObstacles.set(visual.context, [
            ...nodeObstacles,
            ...model.groups
              .filter((group) => !ancestors.includes(group.id))
              .map((group) => model.rects.get(group.id))
          ]);
        const obstacles = contextObstacles.get(visual.context);
        const label = t(edge.label || '');
        const route = c.routeConnection(
          visual.a.rect,
          visual.b.rect,
          label,
          obstacles,
          occupied,
          {
            ...edge,
            label_clipping: 'mask',
            source_port: 'right',
            target_port:
              count > 1 && visual.b.key.startsWith('node:')
                ? `left:${
                    Math.max(
                      0,
                      incoming.findIndex((item) => item.id === edge.id)
                    ) % count
                  }:${count}`
                : 'left'
          },
          c.measureEdgeText(label)
        );
        edges.push({ edge, route, label });
      }

    return { model, bounds, edges };
  }, [
    doc,
    s.persistenceState.changeVersion,
    s.workspaceState.project?.revision,
    s.pluginsState.catalog,
    s.preferencesState.appSettings.tags,
    language
  ]);
  const selectedNodeIds = new Set(s.selectionState.selected);
  for (const group of doc?.groups || [])
    if (
      s.selectionState.selectedGroups.has(group.id) ||
      s.selectionState.selectedGroup === group.id
    )
      for (const id of c.groupNodeIds(group)) selectedNodeIds.add(id);
  const highlightedConnections = new Set();
  for (const edge of doc?.edges || [])
    if (
      s.selectionState.selectedEdges.has(edge.id) ||
      selectedNodeIds.has(edge.source) ||
      selectedNodeIds.has(edge.target)
    ) {
      const connection = model.connection(edge);
      if (connection) highlightedConnections.add(connection.key);
    }
  const linkedIds = new Set();
  for (const edge of doc?.edges || [])
    if (s.selectionState.selectedEdges.has(edge.id)) {
      linkedIds.add(edge.source);
      linkedIds.add(edge.target);
    }
  return (
    <svg
      id="graph"
      tabIndex={0}
      role="application"
      aria-label={t('Graph-Arbeitsfläche')}
      onPointerDown={(event) => {
        if (!event.target.closest('video,textarea,input')) c.canvasPointerDown(event.nativeEvent);
      }}
      onPointerMove={(event) => c.updateDrag(event.nativeEvent)}
      onPointerUp={(event) => c.canvasPointerUp(event.nativeEvent)}
      onPointerCancel={() => {
        c.cancelConnection();
        s.canvasState.drag = null;
        c.removeSelectionFrame();
      }}
      onContextMenu={(event) => event.preventDefault()}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      }}
      onDrop={(event) => app.safely(() => c.dropPalette(event.nativeEvent))}
    >
      <defs>
        <pattern
          id="grid"
          width="24"
          height="24"
          patternUnits="userSpaceOnUse"
          patternTransform={`translate(${pan.x} ${pan.y}) scale(${pan.scale})`}
        >
          <circle cx="1" cy="1" r="1" fill="#273447" />
        </pattern>
        <marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
          <path d="M0 0L8 4L0 8Z" fill="#7f91aa" />
        </marker>
        <marker id="arrowSelected" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
          <path d="M0 0L8 4L0 8Z" fill="var(--selection)" />
        </marker>
      </defs>
      <rect width="100%" height="100%" fill="url(#grid)" />
      <g id="scene" transform={`translate(${pan.x} ${pan.y}) scale(${pan.scale})`}>
        {model?.groups.map((group) => (
          <Group key={group.id} app={app} group={group} bounds={model.rects.get(group.id)} />
        ))}
        {edges.map(({ edge, route, label }) => (
          <Edge
            key={edge.id}
            app={app}
            edge={edge}
            route={route}
            label={label}
            highlighted={highlightedConnections.has(model.connection(edge)?.key)}
          />
        ))}
        {[...(doc?.nodes || [])]
          .sort((a, b) => Number(b.type === 'marker') - Number(a.type === 'marker'))
          .filter((node) => !model.hidden.has(node.id))
          .map((node) => (
            <GraphNode
              key={node.id}
              app={app}
              node={node}
              bounds={bounds.get(node.id)}
              selected={s.selectionState.selected.has(node.id)}
              linked={linkedIds.has(node.id)}
              execution={
                s.executionState.activeActors.has(node.id)
                  ? 'running'
                  : s.executionState.actorQueue.some((job) => job.id === node.id)
                    ? 'queued'
                    : 'idle'
              }
            />
          ))}
      </g>
    </svg>
  );
}

function Edge({ app, edge, route, label, highlighted }) {
  const { commands: c, state: s } = app;
  const [hovered, setHovered] = useState(false);
  const selected = highlighted || s.selectionState.selectedEdges.has(edge.id);
  const maskId = React.useId().replaceAll(':', '');
  const mask = route.maskBounds;
  const width = c.measureEdgeText(label);
  function select(event) {
    event.stopPropagation();
    c.selectEdge(edge.id, event.shiftKey);
  }
  const edit = () =>
    app.safely(async () => {
      const next = await c.askText(t('Verbindung bearbeiten'), t('Bezeichnung'), edge.label || '');
      if (next !== null) {
        edge.label = next;
        c.change();
        c.render();
      }
    });
  return (
    <g className={selected ? 'connection selected' : 'connection'}>
      <defs>
        <mask
          id={maskId}
          maskUnits="userSpaceOnUse"
          x={mask.x}
          y={mask.y}
          width={mask.w}
          height={mask.h}
          style={{ maskType: 'luminance' }}
        >
          <rect x={mask.x} y={mask.y} width={mask.w} height={mask.h} fill="white" />
          <rect
            x={route.labelX - width / 2 - 8}
            y={route.labelY - 14}
            width={width + 16}
            height="28"
            fill="black"
          />
          {hovered && (
            <rect
              x={route.labelX + width / 2 + 5}
              y={route.labelY - 13}
              width="50"
              height="26"
              fill="black"
            />
          )}
        </mask>
      </defs>
      <path
        className={'edge' + (selected ? ' selected' : '')}
        d={route.path}
        mask={`url(#${maskId})`}
        data-edge-path={edge.id}
        data-has-arrow="true"
        markerEnd={`url(#${selected ? 'arrowSelected' : 'arrow'})`}
      />
      <path
        className="edge-hit"
        d={route.path}
        data-edge-hit={edge.id}
        tabIndex={0}
        role="button"
        aria-label={t('Verbindung auswählen')}
        onPointerDown={select}
        onKeyDown={(event) => {
          if (event.key === 'Enter') select(event);
        }}
      />
      <g
        className="connection-label"
        data-edge-label={edge.id}
        onPointerDown={(event) => event.stopPropagation()}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
      >
        <rect
          className="edge-label-backdrop"
          x={route.labelX - width / 2 - 10}
          y={route.labelY - 14}
          width={width + 70}
          height="28"
          fill="transparent"
          onClick={select}
        />
        <text
          className="edgeLabel"
          x={route.labelX}
          y={route.labelY}
          textAnchor="middle"
          dominantBaseline="central"
        >
          {label}
        </text>
        <g
          className="edge-edit"
          role="button"
          tabIndex={0}
          aria-label={t('Verbindung bearbeiten')}
          onClick={edit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') edit();
          }}
        >
          <rect
            className="edge-edit-hit"
            x={route.labelX + width / 2 + 7}
            y={route.labelY - 11}
            width="22"
            height="22"
          />
          <Icon
            name="edit"
            x={route.labelX + width / 2 + 11}
            y={route.labelY - 7}
            width="14"
            height="14"
          />
        </g>
        <g
          className="edge-delete"
          role="button"
          tabIndex={0}
          aria-label={t('Verbindung löschen')}
          onClick={() => c.deleteEdges(c.edgeBundleIds(edge.id))}
          onKeyDown={(event) => {
            if (event.key === 'Enter') c.deleteEdges(c.edgeBundleIds(edge.id));
          }}
        >
          <rect
            x={route.labelX + width / 2 + 31}
            y={route.labelY - 11}
            width="22"
            height="22"
            fill="transparent"
          />
          <Icon
            name="trash"
            x={route.labelX + width / 2 + 35}
            y={route.labelY - 7}
            width="14"
            height="14"
          />
        </g>
      </g>
    </g>
  );
}

function Group({ app, group, bounds: b }) {
  const { commands: c, state: s } = app;
  return (
    <g
      className={`group ${s.selectionState.selectedGroups.has(group.id) ? 'selected' : ''}`}
      data-group={group.id}
      transform={`translate(${b.x} ${b.y})`}
      onPointerDown={(event) => c.startGroupDrag(group, event.nativeEvent)}
    >
      <rect width={b.w} height={b.h} rx="12" />
      <circle className="group-dock" cx="0" cy={b.h / 2} r="5" />
      <circle className="group-dock" cx={b.w} cy={b.h / 2} r="5" />
      <text className="group-title" x="38" y="26">
        {c.fitNodeText(c.groupTitle(group), b.w - 52, 13)}
      </text>
      <g
        className="group-toggle"
        role="button"
        tabIndex={0}
        aria-label={t(group.collapsed ? 'Aufklappen' : 'Einklappen')}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          c.toggleGroup(group);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            c.toggleGroup(group);
          }
        }}
      >
        <rect className="group-toggle-hit" x="4" y="2" width="36" height="36" fill="transparent" />
        <Icon
          name={group.collapsed ? 'chevron-right' : 'chevron-down'}
          x="10"
          y="8"
          width="24"
          height="24"
          style={{ color: '#ff9d45' }}
        />
      </g>
      {group.collapsed && (
        <text x="12" y="55" fill="#95a9c1" fontSize="11">
          {c.groupNodeIds(group).size} {t('Knoten')}
        </text>
      )}
    </g>
  );
}

const GraphNode = memo(function GraphNode({ app, node, bounds: b, selected, linked }) {
  const { commands: c, state: s } = app;
  const sel = s.selectionState;
  const note = ['note', 'marker'].includes(node.type);
  const color = node.appearance?.color || '#ffcc70';
  const badges = c.nodeBadgeRows(node, b.w);
  const actions = c.resourceActions(node).filter((action) => node.display?.[action.key]);
  const badgeTop = b.h - actions.length * 48 - c.nodeBadgeHeight(node, b.w);
  const count = Math.min(32, b.inputCount || 1);
  const mediaHeight = Math.max(0, badgeTop - 88);
  const nodeAccent =
    node.type === 'actor'
      ? 'var(--actor-accent)'
      : node.type === 'error'
        ? 'var(--danger)'
        : 'var(--accent)';
  function down(event) {
    if (
      event.button > 0 ||
      s.canvasState.spacePressed ||
      event.target.closest('.dock,.node-open,foreignObject,.note-resize')
    )
      return;
    document.activeElement?.blur();
    event.currentTarget.focus({ preventScroll: true });
    event.preventDefault();
    event.stopPropagation();
    if (event.shiftKey) selected ? sel.selected.delete(node.id) : sel.selected.add(node.id);
    else if (!selected) sel.selected = new Set([node.id]);
    sel.selectedEdges.clear();
    s.canvasState.drag = {
      kind: 'nodes',
      startX: event.clientX,
      startY: event.clientY,
      positions: s.workspaceState.project.document.nodes
        .filter((item) => sel.selected.has(item.id))
        .map((item) => ({ id: item.id, x: item.x, y: item.y })),
      moved: false
    };
    document.getElementById('graph').setPointerCapture(event.pointerId);
    c.inspect();
    c.render();
  }
  const imageURL = node.data.file_id
    ? '/api/files/' + node.data.file_id
    : node.data.url
      ? '/api/media?url=' + encodeURIComponent(node.data.url)
      : '';
  return (
    <g
      className={`node ${node.type === 'actor' ? 'actor' : node.type} ${selected ? 'selected' : ''} ${linked ? 'linked' : ''}`}
      data-id={node.id}
      data-type={node.type}
      transform={`translate(${node.x} ${node.y})`}
      tabIndex={0}
      role="group"
      aria-label={c.dataLabel(node.type) + ': ' + c.nodeTitle(node)}
      onPointerDown={down}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          sel.selected = new Set([node.id]);
          c.inspect();
          c.render();
        }
      }}
    >
      <rect
        width={b.w}
        height={b.h}
        rx="10"
        style={
          note
            ? { fill: color, stroke: selected || linked ? 'var(--selection)' : color }
            : undefined
        }
      />
      <rect
        className="node-hover-area"
        x="-10"
        y="-10"
        width={b.w + 20}
        height={b.h + 20}
        rx="20"
      />
      {note ? (
        <>
          <text
            x={node.type === 'marker' ? b.w / 2 : 12}
            y="25"
            textAnchor={node.type === 'marker' ? 'middle' : 'start'}
            fill={node.type === 'marker' ? color : c.noteInk(color)}
            fontSize="13"
          >
            {c.fitNodeText(c.nodeTitle(node), b.w - 24, 13)}
          </text>
          {node.type === 'note' && (
            <foreignObject
              x="10"
              y="38"
              width={b.w - 20}
              height={b.h - 52 - c.nodeBadgeHeight(node, b.w)}
            >
              <textarea
                className="note-editor"
                style={{ color: c.noteInk(color) }}
                value={node.data.text || ''}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  sel.selected = new Set([node.id]);
                  c.inspect();
                  c.render();
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.currentTarget.blur();
                    document.getElementById('graph').focus();
                  }
                }}
                onChange={(event) => {
                  node.data.text = event.target.value;
                  c.change(node.id);
                }}
              />
            </foreignObject>
          )}
          <g
            className="note-resize"
            role="button"
            tabIndex={0}
            aria-label={t('Notizgröße ändern')}
            onPointerDown={(event) => {
              event.stopPropagation();
              event.preventDefault();
              s.canvasState.drag = {
                kind: 'note-resize',
                id: node.id,
                startX: event.clientX,
                startY: event.clientY,
                width: b.w,
                height: node.appearance?.height || 180,
                moved: false
              };
              document.getElementById('graph').setPointerCapture(event.pointerId);
            }}
          >
            <rect x={b.w - 24} y={b.h - 24} width="24" height="24" fill="transparent" />
            <path
              d={`M${b.w - 16} ${b.h - 4}L${b.w - 4} ${b.h - 16}`}
              stroke={c.noteInk(color)}
              strokeWidth="2"
            />
          </g>
        </>
      ) : (
        <>
          <Icon
            name={
              node.type === 'actor'
                ? c.actorIcon(node.data.plugin, node.data.action)
                : c.dataIcon(node.type)
            }
            x="11"
            y="10"
            width="16"
            height="16"
            style={{ color: nodeAccent }}
          />
          <text x="34" y="23" fill={nodeAccent} fontSize="10" letterSpacing="1">
            {c.fitNodeText(
              (node.type === 'actor' ? c.actorTitle(node) : c.dataLabel(node.type)).toUpperCase(),
              b.w - 46,
              10,
              1
            )}
          </text>
          <text x="12" y="40" fill="#e4ecf7" fontSize="13">
            {c.fitNodeText(c.nodeTitle(node), b.w - 24, 13)}
          </text>
          <text x="12" y="60" fill="#95a9c1" fontSize="10">
            {c.short(node.type === 'error' ? diagnostic(node.data.message) : c.summary(node), 42)}
          </text>
          {node.type === 'location' &&
            c
              .locationDisplayLines(node.data, b.w)
              .slice(0, 5)
              .map((line, i) => (
                <text key={i} x="12" y={60 + i * 16} fontSize="10" fill="#95a9c1">
                  {line}
                </text>
              ))}
          {node.type === 'image' && node.display?.preview && imageURL && (
            <foreignObject x="12" y="76" width={b.w - 24} height={mediaHeight}>
              <MediaFrame src={imageURL} alt={node.label} />
            </foreignObject>
          )}
          {node.type === 'video' && node.display?.preview && imageURL && (
            <foreignObject x="12" y="76" width={b.w - 24} height={mediaHeight}>
              <MediaFrame
                src={imageURL}
                video
                onPointerDown={(event) => event.stopPropagation()}
                onPointerUp={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
              />
            </foreignObject>
          )}
          {node.type === 'location' && node.display?.map && c.mapsUrl(node, true) && (
            <foreignObject
              x="12"
              y={Math.max(76, 64 + c.locationDisplayLines(node.data, b.w).length * 16)}
              width={b.w - 24}
              height="148"
            >
              <MapPreview className="embedded-map" src={c.mapsUrl(node, true)} title={node.label} />
            </foreignObject>
          )}
        </>
      )}
      <g className="node-badges">
        {badges.flatMap((row, index) =>
          row.map((tag, i) => (
            <g key={index + ':' + i}>
              <rect
                x={tag.x}
                y={badgeTop + index * 22}
                width={tag.w}
                height="18"
                rx="5"
                fill={tag.color + '32'}
                stroke={tag.color}
                strokeWidth=".7"
              />
              <circle cx={tag.x + 7} cy={badgeTop + index * 22 + 9} r="2.5" fill={tag.color} />
              <text x={tag.x + 14} y={badgeTop + index * 22 + 12} fontSize="10" fill="#e4ecf7">
                {c.fitNodeText(tag.name, tag.w - 19, 10)}
              </text>
            </g>
          ))
        )}
      </g>
      {actions.map((action, index) => (
        <g
          key={action.key}
          className="node-open"
          role="button"
          tabIndex={0}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => c.openNodeResource(node, action.provider)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') c.openNodeResource(node, action.provider);
          }}
        >
          <rect
            x="12"
            y={b.h - actions.length * 48 + index * 48}
            width={b.w - 24}
            height="36"
            rx="6"
          />
          <text
            x={b.w / 2}
            y={b.h - actions.length * 48 + index * 48 + 24}
            textAnchor="middle"
            fontSize="11"
          >
            {t(action.label)}
          </text>
        </g>
      ))}
      {node.type !== 'marker' &&
        [...Array.from({ length: count }, (_, index) => `left:${index}:${count}`), 'right'].map(
          (side) => {
            const point = c.portPosition({ x: 0, y: 0, w: b.w, h: b.h }, side);
            return (
              <circle
                key={side}
                className="dock"
                data-node={node.id}
                data-port={side}
                cx={point.x}
                cy={point.y}
                r="5"
                onPointerDown={(event) => {
                  if (event.button > 0) return;
                  event.preventDefault();
                  event.stopPropagation();
                  s.canvasState.connecting = {
                    source: node.id,
                    port: side,
                    pointer: event.pointerId,
                    target: null,
                    targetPort: null
                  };
                  s.canvasState.drag = null;
                  document.getElementById('graph').setPointerCapture(event.pointerId);
                  event.currentTarget.closest('.node').classList.add('connection-source');
                  c.updateConnection(event.nativeEvent);
                }}
              />
            );
          }
        )}
    </g>
  );
});
