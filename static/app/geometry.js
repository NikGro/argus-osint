import graph_routing_default from '../graph-routing.js';
var geometry_default = {
  name: 'geometry',
  dependencies: [],
  create() {
    function intersects(...args) {
      return graph_routing_default.intersects(...args);
    }
    function routeConnection(...args) {
      return graph_routing_default.routeConnection(...args);
    }
    function portPosition(...args) {
      return graph_routing_default.portPosition(...args);
    }
    return { intersects, routeConnection, portPosition };
  }
};
export { geometry_default };
export default geometry_default;
