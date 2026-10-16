import graph_routing_default from '../graph-routing.js';
var geometry_default = {
  name: 'geometry',
  dependencies: [],
  create() {
    function automaticBoundary(...args) {
      return graph_routing_default.automaticBoundary(...args);
    }
    function connectionGeometry(...args) {
      return graph_routing_default.connectionGeometry(...args);
    }
    function intersects(...args) {
      return graph_routing_default.intersects(...args);
    }
    function cubicPoint(...args) {
      return graph_routing_default.cubicPoint(...args);
    }
    function splitCubic(...args) {
      return graph_routing_default.splitCubic(...args);
    }
    function cubicSlice(...args) {
      return graph_routing_default.cubicSlice(...args);
    }
    function curvePath(...args) {
      return graph_routing_default.curvePath(...args);
    }
    function curveLabelGap(...args) {
      return graph_routing_default.curveLabelGap(...args);
    }
    function routeConnection(...args) {
      return graph_routing_default.routeConnection(...args);
    }
    function portPosition(...args) {
      return graph_routing_default.portPosition(...args);
    }
    return {
      automaticBoundary,
      connectionGeometry,
      intersects,
      cubicPoint,
      splitCubic,
      cubicSlice,
      curvePath,
      curveLabelGap,
      routeConnection,
      portPosition
    };
  }
};
export { geometry_default };
export default geometry_default;
