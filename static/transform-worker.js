/* Dedicated worker. Response CSP prohibits network access; main UI terminates it after 2s. */
self.onmessage = function (event) {
  try {
    const fn = new Function('inputs', '"use strict";\n' + event.data.code);
    const output = fn(event.data.inputs);
    if (!Array.isArray(output))
      throw new Error('Code muss ein Array von {type,label,data} zurückgeben.');
    self.postMessage({ outputs: JSON.parse(JSON.stringify(output)) });
  } catch (error) {
    self.postMessage({ error: String(error.message || error) });
  }
};
