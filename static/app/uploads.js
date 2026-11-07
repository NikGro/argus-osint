import { authorizedFetch } from '../auth.js';
var uploads_default = {
  name: 'uploads',
  dependencies: ['$', 'modalChoice', 'newNode'],
  create({ workspaceState, canvasState, $, modalChoice, newNode }) {
    async function uploadNodeFile(file, type, x, y, pid = workspaceState.project?.id) {
      if (!pid) return;
      const response = await authorizedFetch('/api/files', {
        method: 'POST',
        headers: {
          'X-File-Name': encodeURIComponent(file.name),
          'X-Project-Id': pid
        },
        body: file
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error?.detail || data.error?.code || 'Upload failed');
      if (type === 'file' && data.is_image) {
        const choice = await modalChoice('Photo detected', file.name, [
          {
            label: 'Use image node',
            value: 'image'
          },
          {
            label: 'Use file node',
            value: 'file'
          }
        ]);
        if (choice === null) return;
        type = choice;
      }
      if (type === 'file' && data.is_video) type = 'video';
      if (type === 'file' && data.is_audio) type = 'audio';
      if (type === 'audio' && !data.is_audio)
        throw Error('This file is not a supported audio file (MP3, WAV, FLAC, OGG, M4A).');
      if (type === 'video' && !data.is_video) throw Error('Unsupported video file.');
      if (type === 'image' && !data.is_image) type = 'file';
      if (workspaceState.project?.id !== pid)
        throw Error('Open the original project to add the file.');
      newNode(
        type,
        file.name,
        type === 'image'
          ? {
              file_id: data.file_id,
              filename: file.name
            }
          : {
              file_id: data.file_id,
              filename: file.name,
              mime: data.mime,
              size: data.size,
              ...(['video', 'audio'].includes(type) ? { duration: data.duration } : {})
            },
        x,
        y
      );
    }
    async function dropFiles(event) {
      if (!event.dataTransfer?.files?.length) return false;
      event.preventDefault();
      const box = $('graph').getBoundingClientRect(),
        x = (event.clientX - box.left - canvasState.pan.x) / canvasState.pan.scale,
        y = (event.clientY - box.top - canvasState.pan.y) / canvasState.pan.scale,
        pid = workspaceState.project?.id;
      for (const [index, file] of [...event.dataTransfer.files].entries())
        await uploadNodeFile(file, 'file', x, y + index * 110, pid);
      return true;
    }
    return { uploadNodeFile, dropFiles };
  }
};
export { uploads_default };
export default uploads_default;
