import React, { useEffect, useRef, useState } from 'react';
import { t } from '../../i18n.js';

export function DetailSection({ children, className = '', ...props }) {
  return (
    <section className={'detail-section ' + className} {...props}>
      {children}
    </section>
  );
}

/** Decode failures (e.g. HEVC) request a cached H.264 working copy. */
export function BrowserVideo({ src, ref, onError, onLoadedData, onPlay, onPause, ...props }) {
  const resume = useRef(false);
  const [fallback, setFallback] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    resume.current = false;
    setFallback(false);
    setPreparing(false);
    setFailed(false);
  }, [src]);
  return (
    <>
      <video
        {...props}
        ref={ref}
        src={fallback ? src + '/playback' : src}
        onPlay={(event) => {
          resume.current = true;
          onPlay?.(event);
        }}
        onPause={(event) => {
          if (!preparing && !event.currentTarget.error) resume.current = false;
          onPause?.(event);
        }}
        onLoadedData={(event) => {
          if (fallback && resume.current) event.currentTarget.play().catch(() => {});
          setPreparing(false);
          onLoadedData?.(event);
        }}
        onError={(event) => {
          if (
            !fallback &&
            [3, 4].includes(event.currentTarget.error?.code) &&
            /^\/api\/files\/[a-f0-9]{32}$/.test(src)
          ) {
            setFallback(true);
            setPreparing(true);
          } else {
            setPreparing(false);
            setFailed(true);
            onError?.(event);
          }
        }}
      />
      {(preparing || failed) && (
        <span className="media-playback-status" role="status">
          {t(
            preparing
              ? 'Browserkompatible Videokopie wird vorbereitet …'
              : 'Video kann nicht wiedergegeben werden. Original in neuem Tab öffnen.'
          )}
        </span>
      )}
    </>
  );
}

export function MediaFrame({ src, video = false, alt = '', ...props }) {
  return (
    <div className="media-frame" {...props}>
      {video ? (
        <BrowserVideo src={src} controls playsInline preload="metadata" />
      ) : (
        <img src={src} alt={alt} />
      )}
    </div>
  );
}

/** Only trusted, server-generated map HTML. Same-origin keeps tile authentication. */
export function MapPreview({ src, title, className = '' }) {
  const [ready, setReady] = useState(null);
  useEffect(() => {
    const timer = setTimeout(() => setReady(src), 650);
    return () => clearTimeout(timer);
  }, [src]);
  return (
    <div className={'map-preview ' + className}>
      {ready ? (
        <iframe
          src={ready}
          title={title}
          sandbox="allow-scripts allow-same-origin"
          loading="lazy"
        />
      ) : (
        <p role="status">{t('ui.loading')}</p>
      )}
    </div>
  );
}
