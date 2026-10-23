var inspector_default = {
  name: 'inspector',
  dependencies: [],
  create({ selectionState, workspaceState, pluginsState, executionState, canvasState }) {
    function noteInk(color) {
      const rgb = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
      return rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114 > 140 ? '#30271b' : '#f7f7f7';
    }
    return { noteInk };
  }
};
export { inspector_default };
export default inspector_default;
