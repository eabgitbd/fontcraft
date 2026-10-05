<script module lang="ts">
  export type IconName = 'folder' | 'grid' | 'pen' | 'camera' | 'link' | 'kern' | 'eye' | 'export' | 'settings' | 'keyboard' | 'plus' | 'close' | 'check' | 'back' | 'nib' | 'eraser' | 'cursor' | 'zoomin' | 'zoomout' | 'fit' | 'trash' | 'image';

  const PATHS: Record<IconName, string> = {
    folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
    grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
    pen: 'M4 20l4-1 11-11a2.1 2.1 0 0 0-3-3L5 16zM14 7l3 3',
    camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
    link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1',
    kern: 'M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4',
    eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    export: 'M12 3v12M7 10l5 5 5-5M4 20h16',
    settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
    keyboard: 'M3 6h18v12H3zM7 10h.01M11 10h.01M15 10h.01M7 14h10',
    plus: 'M12 5v14M5 12h14',
    close: 'M6 6l12 12M18 6L6 18',
    check: 'M5 12l5 5 9-10',
    back: 'M15 5l-7 7 7 7',
    nib: 'M12 3l6 8-3 9H9l-3-9zM12 11v4M10 20h4',
    eraser: 'M4 16l9-9a2 2 0 0 1 3 0l3 3a2 2 0 0 1 0 3l-6 6H8zM9 20h11',
    cursor: 'M5 3l14 7-6 2-2 6z',
    zoomin: 'M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5M7 10h6M10 7v6',
    zoomout: 'M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5M7 10h6',
    fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
    trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
    image: 'M4 5h16v14H4zM4 15l4-4 4 4 3-3 5 5M9 9h.01',
  };
</script>

<script lang="ts">
  let { name, size = 22 }: { name: IconName; size?: number } = $props();
</script>

<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <path d={PATHS[name]} />
</svg>
