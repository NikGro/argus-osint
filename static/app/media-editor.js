import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { t } from '../i18n.js';
import { BrowserVideo } from '../react/ui/layout.jsx';
import { Icon } from '../react/ui/controls.jsx';

const h = React.createElement;
export const cropKeys = ['crop_enabled', 'crop_x', 'crop_y', 'crop_width', 'crop_height'];
export function hasMediaEditor(node) {
  return (
    node.type === 'actor' &&
    ((node.data.plugin === 'video' && node.data.action === 'trim') ||
      node.data.plugin === 'image_crop')
  );
}
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const clock = (value) => `${Math.floor(value / 60)}:${(value % 60).toFixed(2).padStart(5, '0')}`;

export function MediaEditor({ node, source, onChange }) {
  const video = node.data.plugin === 'video';
  const [params, setParams] = useState({
    crop_enabled: !video,
    crop_x: 0,
    crop_y: 0,
    crop_width: 1,
    crop_height: 1,
    start_seconds: 0,
    end_seconds: 2,
    ...node.data.params
  });
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState('');
  const media = useRef(null),
    drag = useRef(null);
  function update(values) {
    setParams((previous) => {
      const next = { ...previous, ...values };
      return next;
    });
    onChange(values);
  }
  function setStart(value) {
    const start = clamp(value, 0, Math.max(0, duration - 0.01));
    const end =
      params.end_seconds <= start
        ? Math.min(duration, start + 2)
        : Math.min(params.end_seconds, start + 600);
    update({ start_seconds: start, end_seconds: end });
    media.current.currentTime = start;
  }
  function setEnd(value) {
    const end = clamp(value, 0.01, duration);
    const start =
      params.start_seconds >= end
        ? Math.max(0, end - 2)
        : Math.max(params.start_seconds, end - 600);
    update({ start_seconds: start, end_seconds: end });
    media.current.currentTime = end;
  }
  function loaded(event) {
    if (!video) return;
    const length = event.currentTarget.duration;
    if (!Number.isFinite(length) || length <= 0) return;
    setDuration(length);
    if (params.end_seconds > length || params.start_seconds >= length)
      update({ start_seconds: 0, end_seconds: Math.min(2, length) });
  }
  function pointerDown(event, mode) {
    event.preventDefault();
    event.stopPropagation();
    const bounds = event.currentTarget.closest('.media-crop-stage').getBoundingClientRect();
    drag.current = { mode, bounds, x: event.clientX, y: event.clientY, params: { ...params } };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function pointerMove(event) {
    if (!drag.current) return;
    const { mode, bounds, x, y, params: start } = drag.current;
    const dx = (event.clientX - x) / bounds.width,
      dy = (event.clientY - y) / bounds.height;
    if (mode === 'move')
      update({
        crop_x: clamp(start.crop_x + dx, 0, 1 - start.crop_width),
        crop_y: clamp(start.crop_y + dy, 0, 1 - start.crop_height)
      });
    else
      update({
        crop_width: clamp(start.crop_width + dx, 0.01, 1 - start.crop_x),
        crop_height: clamp(start.crop_height + dy, 0.01, 1 - start.crop_y)
      });
  }
  function pointerUp() {
    drag.current = null;
  }
  if (!source?.data?.file_id)
    return h(
      'section',
      { className: 'media-editor' },
      h(
        'p',
        null,
        t(
          video
            ? 'Connect a video to select its time range and crop.'
            : 'Connect an image to select its crop.'
        )
      )
    );
  const url = '/api/files/' + source.data.file_id;
  const rectangle = params.crop_enabled
    ? h(
        'div',
        {
          className: 'media-crop-rectangle',
          style: {
            left: params.crop_x * 100 + '%',
            top: params.crop_y * 100 + '%',
            width: params.crop_width * 100 + '%',
            height: params.crop_height * 100 + '%'
          },
          onPointerDown: (event) => pointerDown(event, 'move'),
          onPointerMove: pointerMove,
          onPointerUp: pointerUp,
          onPointerCancel: pointerUp
        },
        h('span', { className: 'media-crop-guide horizontal' }),
        h('span', { className: 'media-crop-guide vertical' }),
        h('button', {
          type: 'button',
          className: 'media-crop-handle',
          'aria-label': t('ui.resize_crop'),
          onPointerDown: (event) => pointerDown(event, 'resize'),
          onPointerMove: pointerMove,
          onPointerUp: pointerUp,
          onPointerCancel: pointerUp
        })
      )
    : null;
  return h(
    'section',
    { className: 'media-editor', 'aria-label': t('ui.media_crop_editor') },
    h('h3', null, t(video ? 'Time range & crop' : 'Photo crop')),
    h(
      'div',
      { className: 'media-crop-stage' },
      h(video ? BrowserVideo : 'img', {
        ref: media,
        src: url,
        alt: video ? undefined : source.label,
        controls: false,
        preload: video ? 'metadata' : undefined,
        onLoadedMetadata: loaded,
        onLoadedData: () => setError(''),
        onPlay: () => setPlaying(true),
        onPause: () => setPlaying(false),
        playsInline: video ? true : undefined,
        onError: () => setError(t('ui.media_preview_unavailable_open_the_original_file'))
      }),
      rectangle
    ),
    error && h('p', { role: 'alert' }, error),
    video &&
      h(
        React.Fragment,
        null,
        h(
          'div',
          { className: 'media-editor-actions' },
          h(
            'button',
            {
              type: 'button',
              className: 'icon-only',
              'aria-label': t(playing ? 'Pause' : 'Play'),
              onClick: () => {
                const player = media.current;
                if (player.paused)
                  player
                    .play()
                    .catch(() =>
                      setError(t('ui.media_preview_unavailable_open_the_original_file'))
                    );
                else player.pause();
              }
            },
            h(Icon, { name: playing ? 'pause' : 'play' })
          ),
          h('a', { href: url, target: '_blank', rel: 'noopener' }, t('ui.open_in_new_tab'))
        ),
        h(
          'div',
          { className: 'media-time-range' },
          h('output', null, clock(params.start_seconds) + ' – ' + clock(params.end_seconds)),
          h(
            'div',
            { className: 'media-time-track' },
            h('span', {
              className: 'media-time-selection',
              style: {
                left: `calc(8px + (100% - 16px) * ${params.start_seconds / (duration || params.end_seconds || 1)})`,
                width: `calc((100% - 16px) * ${(params.end_seconds - params.start_seconds) / (duration || params.end_seconds || 1)})`
              }
            }),
            h('input', {
              type: 'range',
              min: 0,
              max: duration || params.end_seconds,
              step: 0.01,
              value: params.start_seconds,
              disabled: !duration,
              'aria-label': t('ui.start'),
              onChange: (event) => setStart(Number(event.target.value))
            }),
            h('input', {
              type: 'range',
              min: 0,
              max: duration || params.end_seconds,
              step: 0.01,
              value: params.end_seconds,
              disabled: !duration,
              'aria-label': t('ui.end'),
              onChange: (event) => setEnd(Number(event.target.value))
            })
          ),
          h(
            'div',
            { className: 'media-editor-actions' },
            h(
              'button',
              {
                type: 'button',
                disabled: !duration,
                onClick: () => setStart(media.current.currentTime)
              },
              t('ui.set_start_here')
            ),
            h(
              'button',
              {
                type: 'button',
                disabled: !duration,
                onClick: () => setEnd(media.current.currentTime)
              },
              t('ui.set_end_here')
            )
          )
        )
      ),
    h(
      'section',
      { className: 'media-crop-settings' },
      h(
        'label',
        { className: 'checkbox-label' },
        h('input', {
          type: 'checkbox',
          checked: params.crop_enabled,
          onChange: (event) => update({ crop_enabled: event.target.checked })
        }),
        t('ui.crop_image_area')
      ),
      params.crop_enabled &&
        h(
          React.Fragment,
          null,
          h(
            'p',
            { className: 'help' },
            t('ui.move_the_crop_with_the_mouse_or_resize_its_lower_right_corner')
          ),
          h(
            'button',
            {
              type: 'button',
              onClick: () => update({ crop_x: 0, crop_y: 0, crop_width: 1, crop_height: 1 })
            },
            t('ui.reset_crop')
          )
        )
    )
  );
}

export function mountMediaEditor(container, props) {
  const root = createRoot(container);
  root.render(h(MediaEditor, props));
  return () => root.unmount();
}
