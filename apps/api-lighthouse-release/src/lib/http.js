export function fail(reply, status, code, message, details) {
  const error = { code, message };
  if (details) error.details = details;
  return reply.code(status).send({ error });
}

// 校验请求体，失败时直接回复 400 并返回 null
export function parseBody(schema, body, reply) {
  const result = schema.safeParse(body ?? {});
  if (result.success) return result.data;

  const details = result.error.issues.map((issue) => ({
    field: issue.path.join('.'),
    message: issue.message,
  }));
  fail(reply, 400, 'INVALID_INPUT', '请求参数不正确', details);
  return null;
}
