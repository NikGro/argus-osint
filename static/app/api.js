import { authorizedFetch } from '../auth.js';
import { t } from '../i18n.js';
import { diagnostic } from '../i18n.js';
var api_default = {
  name: 'api',
  dependencies: ['updateStatus'],
  create({ shellState, updateStatus }) {
    async function api(path, body) {
      let response;
      try {
        response = await authorizedFetch(
          path,
          body === void 0
            ? {}
            : {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
              }
        );
      } catch (error) {
        shellState.backendOnline = false;
        updateStatus();
        throw error;
      }
      shellState.backendOnline = response.status < 500;
      const data = await response.json();
      updateStatus();
      if (!response.ok) {
        const problem = data.error || {};
        const error = new Error(
          t('errors.' + (problem.code || 'internal_error'), {
            ...problem.params,
            detail: diagnostic(problem.detail || '')
          })
        );
        error.code = problem.code;
        error.status = response.status;
        throw error;
      }
      return data;
    }
    return { api };
  }
};
export { api_default };
export default api_default;
