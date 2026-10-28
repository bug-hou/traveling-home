import argon2 from 'argon2';

// OWASP 推荐的 argon2id 最低参数之一（19 MiB / t=2 / p=1），适合内存较小的服务器
const OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

export function hashPassword(password) {
  return argon2.hash(password, OPTIONS);
}

export async function verifyPassword(hash, password) {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

let dummyHashPromise;

// 账号不存在时也做一次等价耗时的校验，避免通过响应时间判断邮箱是否注册
export async function dummyVerify(password) {
  dummyHashPromise ??= hashPassword('movehome-dummy-password');
  await verifyPassword(await dummyHashPromise, password);
}
