'use strict';
// Compatibility API: concision belongs in generation, never deletion here.
function compactResponse(answer) { return String(answer == null ? '' : answer).replace(/\r\n/g, '\n').trim(); }
module.exports = { compactResponse };
