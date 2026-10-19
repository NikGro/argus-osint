import { authorizedFetch } from '../auth.js';
import { t } from '../i18n.js';
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
        const choice = await modalChoice(t('ui.photo_detected'), file.name, [
          {
            label: t('ui.use_image_node'),
            value: 'image'
          },
          {
            label: t('ui.use_file_node'),
            value: 'file'
          }
        ]);
        if (choice === null) return;
        type = choice;
      }
      if (type === 'file' && data.is_video) type = 'video';
      if (type === 'video' && !data.is_video) throw Error(t('ui.unsupported_video_file'));
      if (type === 'image' && !data.is_image) type = 'file';
      if (workspaceState.project?.id !== pid)
        throw Error(t('ui.open_the_original_project_to_add_the_file'));
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
              ...(type === 'video' ? { duration: data.duration } : {})
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
