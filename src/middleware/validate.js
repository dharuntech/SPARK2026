'use strict';
const { ApiError } = require('../lib/http');

/**
 * Validates req.body / req.query / req.params with a Zod schema and replaces the
 * raw values with the parsed ones. Field errors are returned as a flat map so the
 * existing frontend can render them next to the form.
 */
function validate(schema, source = 'body') {
  return (req, _res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const details = {};
      for (const issue of result.error.issues) {
        const key = issue.path.join('.') || '_';
        if (!details[key]) details[key] = issue.message;
      }
      return next(ApiError.validation(details));
    }
    if (source === 'query') req.validatedQuery = result.data;
    else req[source] = result.data;
    return next();
  };
}

module.exports = { validate };
