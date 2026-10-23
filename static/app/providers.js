var providers_default = {
  name: 'providers',
  dependencies: [],
  create({ pluginsState }) {
    function providerSearchKey(value) {
      const normalized = String(value || '')
        .normalize('NFKC')
        .trim()
        .toLowerCase();
      return normalized.replace(/[^\p{L}\p{N}]/gu, '') || normalized;
    }
    function providerName(value) {
      return (
        pluginsState.providerIndex.get(providerSearchKey(value))?.name ||
        String(value || '').replace(/^custom:/, '')
      );
    }
    return { providerSearchKey, providerName };
  }
};
export { providers_default };
export default providers_default;
