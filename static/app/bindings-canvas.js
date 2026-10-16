var bindings_canvas_default = {
  name: 'bindCanvas',
  dependencies: [
    '$',
    'cancelConnection',
    'canvasPointerDown',
    'canvasPointerUp',
    'dropPalette',
    'removeSelectionFrame',
    'render',
    'resizablePanel',
    'textEditing',
    'toast',
    'touchGestureEvent',
    'updateDrag',
    'uploadNodeFile',
    'zoomAt'
  ],
  create({
    canvasState,
    workspaceState,
    uploadsState,
    $,
    cancelConnection,
    canvasPointerDown,
    canvasPointerUp,
    dropPalette,
    removeSelectionFrame,
    render,
    resizablePanel,
    textEditing,
    toast,
    touchGestureEvent,
    updateDrag,
    uploadNodeFile,
    zoomAt
  }) {
    function bindCanvas() {
      $('graph').addEventListener('pointerdown', canvasPointerDown);
      $('graph').addEventListener('pointermove', updateDrag);
      $('graph').addEventListener('pointerup', canvasPointerUp);
      $('graph').addEventListener('pointercancel', () => {
        cancelConnection();
        canvasState.drag = null;
        removeSelectionFrame();
      });
      $('graph').addEventListener('contextmenu', (event) => event.preventDefault());
      $('graph').addEventListener(
        'wheel',
        (event) => {
          event.preventDefault();
          const box = $('graph').getBoundingClientRect();
          if (event.ctrlKey || event.metaKey)
            zoomAt(
              event.clientX - box.left,
              event.clientY - box.top,
              canvasState.pan.scale * Math.exp(-event.deltaY * 0.01)
            );
          else {
            const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? box.height : 1;
            if (event.shiftKey) {
              canvasState.pan.x -= event.deltaY * unit;
              canvasState.pan.y -= event.deltaX * unit;
            } else {
              canvasState.pan.x -= event.deltaX * unit;
              canvasState.pan.y -= event.deltaY * unit;
            }
            render();
          }
        },
        {
          passive: false
        }
      );
      for (const name of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'])
        $('graph').addEventListener(name, touchGestureEvent, true);
      window.addEventListener('keydown', (event) => {
        if (
          event.code === 'Space' &&
          !textEditing(event.target) &&
          workspaceState.project &&
          !$('workspace').hidden &&
          !document.querySelector('dialog[open]')
        ) {
          event.preventDefault();
          canvasState.spacePressed = true;
          $('graph').classList.add('panning');
        }
      });
      window.addEventListener('keyup', (event) => {
        if (event.code === 'Space') {
          canvasState.spacePressed = false;
          $('graph').classList.remove('panning');
        }
      });
      window.addEventListener('blur', () => {
        cancelConnection();
        canvasState.spacePressed = false;
        canvasState.touchPointers.clear();
        canvasState.pinchGesture = null;
        canvasState.gestureBlocked = false;
        canvasState.drag = null;
        removeSelectionFrame();
      });
      $('fileInput').addEventListener('change', async (e) => {
        try {
          for (const file of e.target.files)
            await uploadNodeFile(
              file,
              uploadsState.pendingUploadType,
              uploadsState.pendingImagePosition?.x,
              uploadsState.pendingImagePosition?.y
            );
        } catch (error) {
          toast(error.message);
        } finally {
          uploadsState.pendingImagePosition = null;
          e.target.value = '';
        }
      });
      resizablePanel($('leftResize'), $('palette'), 'left');
      resizablePanel($('rightResize'), $('inspector'), 'right');
      $('graph').addEventListener('dragover', (event) => {
        if (
          !Array.from(event.dataTransfer.types).some((t2) =>
            ['application/x-argus-palette', 'Files'].includes(t2)
          )
        )
          return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        for (const element of document.querySelectorAll('.drop-target'))
          element.classList.remove('drop-target');
        event.target.closest('.node')?.classList.add('drop-target');
      });
      $('graph').addEventListener('drop', dropPalette);
    }
    return { bindCanvas };
  }
};
export { bindings_canvas_default };
export default bindings_canvas_default;
