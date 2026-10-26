'use strict';

// Validates req[source] ('body' | 'query' | 'params') against a zod schema.
// Parsed, typed values are stored in req.validated[source]. Raw input is never used.
function validate(schema, source = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[source] ?? {});
    if (!result.success) {
      return res.status(400).json({
        error: {
          code: 'validation_error',
          message: 'Invalid request',
          details: result.error.issues.map((i) => ({
            path: i.path.join('.'),
            message: i.message,
          })),
        },
      });
    }
    req.validated = req.validated || {};
    req.validated[source] = result.data;
    next();
  };
}

module.exports = { validate };
